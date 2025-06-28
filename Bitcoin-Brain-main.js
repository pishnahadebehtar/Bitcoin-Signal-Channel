import { Client, Databases, Query, ID } from 'node-appwrite';
import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} from '@google/generative-ai';
import axios from 'axios';
import { Document, Packer, Paragraph, TextRun, AlignmentType } from 'docx';
import FormData from 'form-data';

// Improved Markdown escaping with regex for better performance
const escapeMarkdownV2 = (text) => {
  if (typeof text !== 'string') return String(text);
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
};

// Filter signals with potential price movement less than $400
const filterSmallSignals = (analysis, log) => {
  const { signal, entry_price_range, take_profit_levels, stop_loss } = analysis;

  if (signal === 'HOLD') {
    return true; // HOLD signals don't have price targets, so skip filtering
  }

  // Parse entry_price_range (e.g., "107000-107500")
  const [entryLow, entryHigh] = entry_price_range
    .split('-')
    .map((num) => parseFloat(num.trim()));
  const entryMid = (entryLow + entryHigh) / 2;

  // Get highest take-profit level
  const highestTP = Math.max(...take_profit_levels.map((tp) => parseFloat(tp)));
  const stopLossPrice = parseFloat(stop_loss);

  // Calculate potential gain and loss
  const potentialGain = Math.abs(highestTP - entryMid);
  const potentialLoss = Math.abs(entryMid - stopLossPrice);

  const minMovement = 400; // $400 minimum price movement
  if (potentialGain < minMovement && potentialLoss < minMovement) {
    log(
      `سیگنال رد شد: حرکت قیمتی (سود: ${potentialGain}, زیان: ${potentialLoss}) کمتر از ${minMovement} دلار است`
    );
    return false;
  }

  log(
    `سیگنال معتبر: حرکت قیمتی (سود: ${potentialGain}, زیان: ${potentialLoss})`
  );
  return true;
};

// Format full response for Word document without truncation
const formatForDocx = (analysis) => {
  const {
    signal,
    confidence,
    timeframe,
    summary,
    entry_price_range,
    take_profit_levels,
    stop_loss,
    technical_analysis,
    fundamental_sentiment_analysis,
    risk_assessment,
    hold_rationale,
    ideal_trade_scenario,
    market_context,
    leverage,
  } = analysis;

  // Round numbers
  const roundedEntryRange = entry_price_range.replace(/\d+\.\d+/g, (match) =>
    Math.round(parseFloat(match)).toString()
  );
  const roundedTakeProfit = take_profit_levels.map((tp) =>
    Math.round(parseFloat(tp)).toString()
  );
  const roundedStopLoss = Math.round(parseFloat(stop_loss)).toString();

  const paragraphs = [
    new Paragraph({
      children: [
        new TextRun({
          text: 'تحلیلگر بازار Aidin AI',
          bold: true,
          size: 28,
          font: 'Arial',
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      bidirectional: true,
    }),
    new Paragraph({
      children: [
        new TextRun({ text: `سیگنال: ${signal}`, size: 24, font: 'Arial' }),
      ],
      alignment: AlignmentType.RIGHT,
      spacing: { after: 100 },
      bidirectional: true,
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `اعتماد به تحلیل: ${confidence}`,
          size: 24,
          font: 'Arial',
        }),
      ],
      alignment: AlignmentType.RIGHT,
      spacing: { after: 100 },
      bidirectional: true,
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `بازه زمانی: ${timeframe}`,
          size: 24,
          font: 'Arial',
        }),
      ],
      alignment: AlignmentType.RIGHT,
      spacing: { after: 100 },
      bidirectional: true,
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `اهرم پیشنهادی: ${leverage}`,
          size: 24,
          font: 'Arial',
        }),
      ],
      alignment: AlignmentType.RIGHT,
      spacing: { after: 200 },
      bidirectional: true,
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: 'وضعیت بازار (زمان نیویورک):',
          bold: true,
          size: 24,
          font: 'Arial',
        }),
      ],
      alignment: AlignmentType.RIGHT,
      spacing: { after: 100 },
      bidirectional: true,
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `- زمان: ${market_context.time}`,
          size: 24,
          font: 'Arial',
        }),
      ],
      alignment: AlignmentType.RIGHT,
      spacing: { after: 100 },
      bidirectional: true,
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `- قیمت: $${market_context.price}`,
          size: 24,
          font: 'Arial',
        }),
      ],
      alignment: AlignmentType.RIGHT,
      spacing: { after: 100 },
      bidirectional: true,
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `- پیش‌بینی نوسان: ${market_context.volatility}`,
          size: 24,
          font: 'Arial',
        }),
      ],
      alignment: AlignmentType.RIGHT,
      spacing: { after: 200 },
      bidirectional: true,
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: 'خلاصه تحلیل:',
          bold: true,
          size: 24,
          font: 'Arial',
        }),
      ],
      alignment: AlignmentType.RIGHT,
      spacing: { after: 100 },
      bidirectional: true,
    }),
    new Paragraph({
      children: [new TextRun({ text: summary, size: 24, font: 'Arial' })],
      alignment: AlignmentType.RIGHT,
      spacing: { after: 200 },
      bidirectional: true,
    }),
  ];

  if (signal !== 'HOLD') {
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: 'پارامترهای معاملاتی:',
            bold: true,
            size: 24,
            font: 'Arial',
          }),
        ],
        alignment: AlignmentType.RIGHT,
        spacing: { after: 100 },
        bidirectional: true,
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `محدوده ورود: ${roundedEntryRange}`,
            size: 24,
            font: 'Arial',
          }),
        ],
        alignment: AlignmentType.RIGHT,
        spacing: { after: 100 },
        bidirectional: true,
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `اهداف سود: ${roundedTakeProfit.join(', ')}`,
            size: 24,
            font: 'Arial',
          }),
        ],
        alignment: AlignmentType.RIGHT,
        spacing: { after: 100 },
        bidirectional: true,
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `حد ضرر: ${roundedStopLoss}`,
            size: 24,
            font: 'Arial',
          }),
        ],
        alignment: AlignmentType.RIGHT,
        spacing: { after: 200 },
        bidirectional: true,
      })
    );
  }

  paragraphs.push(
    new Paragraph({
      children: [
        new TextRun({
          text: 'تحلیل تکنیکال:',
          bold: true,
          size: 24,
          font: 'Arial',
        }),
      ],
      alignment: AlignmentType.RIGHT,
      spacing: { after: 100 },
      bidirectional: true,
    }),
    new Paragraph({
      children: [
        new TextRun({ text: technical_analysis, size: 24, font: 'Arial' }),
      ],
      alignment: AlignmentType.RIGHT,
      spacing: { after: 200 },
      bidirectional: true,
    })
  );

  if (
    fundamental_sentiment_analysis &&
    !fundamental_sentiment_analysis.includes('N/A')
  ) {
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: 'تحلیل بنیادی و احساسات بازار:',
            bold: true,
            size: 24,
            font: 'Arial',
          }),
        ],
        alignment: AlignmentType.RIGHT,
        spacing: { after: 100 },
        bidirectional: true,
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: fundamental_sentiment_analysis,
            size: 24,
            font: 'Arial',
          }),
        ],
        alignment: AlignmentType.RIGHT,
        spacing: { after: 200 },
        bidirectional: true,
      })
    );
  }

  if (signal === 'HOLD' && hold_rationale && hold_rationale !== 'N/A') {
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: 'دلیل نگهداری:',
            bold: true,
            size: 24,
            font: 'Arial',
          }),
        ],
        alignment: AlignmentType.RIGHT,
        spacing: { after: 100 },
        bidirectional: true,
      }),
      new Paragraph({
        children: [
          new TextRun({ text: hold_rationale, size: 24, font: 'Arial' }),
        ],
        alignment: AlignmentType.RIGHT,
        spacing: { after: 200 },
        bidirectional: true,
      })
    );
  }

  paragraphs.push(
    new Paragraph({
      children: [
        new TextRun({
          text: 'ارزیابی ریسک:',
          bold: true,
          size: 24,
          font: 'Arial',
        }),
      ],
      alignment: AlignmentType.RIGHT,
      spacing: { after: 100 },
      bidirectional: true,
    }),
    new Paragraph({
      children: [
        new TextRun({ text: risk_assessment, size: 24, font: 'Arial' }),
      ],
      alignment: AlignmentType.RIGHT,
      spacing: { after: 200 },
      bidirectional: true,
    })
  );

  if (ideal_trade_scenario) {
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: 'سناریوی ایده‌آل معامله:',
            bold: true,
            size: 24,
            font: 'Arial',
          }),
        ],
        alignment: AlignmentType.RIGHT,
        spacing: { after: 100 },
        bidirectional: true,
      }),
      new Paragraph({
        children: [
          new TextRun({ text: ideal_trade_scenario, size: 24, font: 'Arial' }),
        ],
        alignment: AlignmentType.RIGHT,
        spacing: { after: 200 },
        bidirectional: true,
      })
    );
  }

  return paragraphs;
};

// Generate Word document
const generateDocx = async (paragraphs, log) => {
  try {
    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              margin: { top: 720, right: 720, bottom: 720, left: 720 },
            },
          },
          children: paragraphs,
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    log(
      'Word document generated successfully, size: ' + buffer.length + ' bytes'
    );
    return buffer;
  } catch (err) {
    log('خطا در تولید سند Word: ' + err.message);
    throw new Error('خطا در تولید سند Word: ' + err.message);
  }
};

// Enhanced formatting with Persian labels and section prioritization
const formatForTelegram = (analysis, log) => {
  const {
    signal,
    confidence,
    timeframe,
    summary,
    entry_price_range,
    take_profit_levels,
    stop_loss,
    technical_analysis,
    fundamental_sentiment_analysis,
    risk_assessment,
    hold_rationale,
    ideal_trade_scenario,
    market_context,
    leverage,
  } = analysis;

  const emojis = {
    LONG: '📈',
    SHORT: '📉',
    HOLD: '⏳',
    confidence: '🔥',
    timeframe: '⏰',
    entry: '🎯',
    tp: '💰',
    sl: '🛡️',
    summary: '✍️',
    technical: '🔬',
    fundamental: '📰',
    risk: '⚠️',
    scenario: '🔭',
    context: '🌐',
    leverage: '📊',
  };

  // Round numbers
  const roundedEntryRange = entry_price_range.replace(/\d+\.\d+/g, (match) =>
    Math.round(parseFloat(match)).toString()
  );
  const roundedTakeProfit = take_profit_levels.map((tp) =>
    Math.round(parseFloat(tp)).toString()
  );
  const roundedStopLoss = Math.round(parseFloat(stop_loss)).toString();

  let message = `*تحلیلگر بازار Aidin AI* 🤖\n\n`;
  message += `${emojis[signal]} *سیگنال:* ${escapeMarkdownV2(signal)}\n`;
  message += `${emojis.confidence} *اعتماد به تحلیل:* ${escapeMarkdownV2(confidence)}\n`;
  message += `${emojis.timeframe} *بازه زمانی:* ${escapeMarkdownV2(timeframe)}\n`;
  message += `${emojis.leverage} *اهرم پیشنهادی:* ${escapeMarkdownV2(leverage)}\n\n`;

  message += `${emojis.context} *وضعیت بازار (زمان نیویورک):*\n`;
  message += `- زمان: ${escapeMarkdownV2(market_context.time)}\n`;
  message += `- قیمت: \\$${escapeMarkdownV2(market_context.price)}\n`;
  message += `- پیش‌بینی نوسان: ${escapeMarkdownV2(market_context.volatility)}\n\n`;

  message += `${emojis.summary} *خلاصه تحلیل:*\n_${escapeMarkdownV2(summary)}_\n\n`;

  if (signal !== 'HOLD') {
    message += `*پارامترهای معاملاتی:*\n`;
    message += `${emojis.entry} محدوده ورود: \`${escapeMarkdownV2(roundedEntryRange)}\`\n`;
    message += `${emojis.tp} اهداف سود: \`${escapeMarkdownV2(roundedTakeProfit.join(', '))}\`\n`;
    message += `${emojis.sl} حد ضرر: \`${escapeMarkdownV2(roundedStopLoss)}\`\n\n`;
  }

  const techAnalysis = truncateText(escapeMarkdownV2(technical_analysis), 1500);
  message += `${emojis.technical} *تحلیل تکنیکال:*\n${techAnalysis}\n\n`;

  if (
    fundamental_sentiment_analysis &&
    !fundamental_sentiment_analysis.includes('N/A')
  ) {
    const fundamentalAnalysis = truncateText(
      escapeMarkdownV2(fundamental_sentiment_analysis),
      1500
    );
    message += `${emojis.fundamental} *تحلیل بنیادی و احساسات بازار:*\n${fundamentalAnalysis}\n\n`;
  }

  if (signal === 'HOLD' && hold_rationale && hold_rationale !== 'N/A') {
    const holdReason = truncateText(escapeMarkdownV2(hold_rationale), 1000);
    message += `*دلیل نگهداری:*\n${holdReason}\n\n`;
  }

  const riskAssessment = truncateText(escapeMarkdownV2(risk_assessment), 1000);
  message += `${emojis.risk} *ارزیابی ریسک:*\n${riskAssessment}\n\n`;

  if (ideal_trade_scenario) {
    const tradeScenario = truncateText(
      escapeMarkdownV2(ideal_trade_scenario),
      1200
    );
    message += `${emojis.scenario} *سناریوی ایده‌آل معامله:*\n${tradeScenario}`;
  }

  log(`طول پیام تلگرام: ${message.length} کاراکتر`);
  if (message.length > 4096) {
    log('هشدار: پیام تلگرام بیش از 4096 کاراکتر است، کوتاه کردن...');
    message = message.substring(0, 4093) + '...';
  }

  return message;
};

// Helper to truncate long text sections
const truncateText = (text, maxLength) => {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '... [متن کوتاه شده]';
};

// Validate AI response structure
const validateAIResponse = (response) => {
  const requiredKeys = [
    'signal',
    'confidence',
    'timeframe',
    'summary',
    'entry_price_range',
    'take_profit_levels',
    'stop_loss',
    'technical_analysis',
    'fundamental_sentiment_analysis',
    'risk_assessment',
    'hold_rationale',
    'ideal_trade_scenario',
    'market_context',
    'leverage',
  ];

  for (const key of requiredKeys) {
    if (!(key in response)) {
      throw new Error(`پاسخ AI فیلد ضروری را ندارد: ${key}`);
    }
  }

  if (!['LONG', 'SHORT', 'HOLD'].includes(response.signal)) {
    throw new Error(`مقدار سیگنال نامعتبر است: ${response.signal}`);
  }

  if (response.signal === 'HOLD' && !('hold_rationale' in response)) {
    throw new Error('پاسخ AI برای سیگنال HOLD باید شامل hold_rationale باشد');
  }

  if (!response.leverage.match(/^(1:\d+|N\/A)$/)) {
    throw new Error(`مقدار اهرم نامعتبر است: ${response.leverage}`);
  }

  if (response.signal === 'HOLD' && response.leverage !== 'N/A') {
    throw new Error('برای سیگنال HOLD، اهرم باید N/A باشد');
  }

  return true;
};

// Get NY time with formatting
const getNYTime = () => {
  const now = new Date();
  return now.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour12: true,
    hour: '2-digit',
    minute: '2-digit',
  });
};

// Get NY date with day of week
const getNYDate = () => {
  const now = new Date();
  return now.toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

// Check if US market is open
const isUSMarketOpen = () => {
  const now = new Date();
  const nyTime = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
  const nyDate = new Date(nyTime);
  const day = nyDate.getDay();
  const hours = nyDate.getHours();
  const minutes = nyDate.getMinutes();

  if (day === 0 || day === 6) return false;
  const totalMinutes = hours * 60 + minutes;
  return totalMinutes >= 570 && totalMinutes < 960;
};

// Track Gemini API request count
let geminiRequestCount = 0;
const MAX_FREE_REQUESTS = 500;

// Prepare technical data for latest candles (full attributes)
const prepareTechnicalData = (doc) => {
  const {
    date,
    open,
    high,
    low,
    close,
    volume,
    ema_50h,
    ema_26h,
    ema_12h,
    macd_line,
    macd_signal_line,
    macd_histogram,
    upper_band_20h,
    lower_band_20h,
    vwap,
    obv,
    atr,
    stochastic_k,
    stochastic_d,
    last_20_day_high,
    last_20_day_low,
    last_40_day_high,
    last_40_day_low,
    last_60_day_high,
    last_60_day_low,
    '20_week_sma_bullmarketsupportband': weekly_sma_20,
  } = doc;

  return {
    date,
    o: open,
    h: high,
    l: low,
    c: close,
    v: volume,
    ema50: ema_50h,
    ema26: ema_26h,
    ema12: ema_12h,
    macd: macd_line,
    macd_signal: macd_signal_line,
    macd_hist: macd_histogram,
    bb_upper: upper_band_20h,
    bb_lower: lower_band_20h,
    vwap,
    obv,
    atr,
    stoch_k: stochastic_k,
    stoch_d: stochastic_d,
    high_20: last_20_day_high,
    low_20: last_20_day_low,
    high_40: last_40_day_high,
    low_40: last_40_day_low,
    high_60: last_60_day_high,
    low_60: last_60_day_low,
    weekly_high: weekly_sma_20,
  };
};

// Prepare OHLCV data for historical data (limited attributes)
const prepareOHLCVData = (doc) => {
  const { date, open, high, low, close, volume } = doc;
  return {
    date,
    open,
    high,
    low,
    close,
    volume,
  };
};

// --- Main Appwrite function handler ---
export default async ({ req, res, log, error }) => {
  log('شروع اجرای تابع Aidin AI');

  // --- 1. Load Environment Variables & Initialize Clients ---
  const requiredEnv = [
    'APPWRITE_ENDPOINT',
    'APPWRITE_PROJECT_ID',
    'APPWRITE_API_KEY',
    'GEMINI_API_KEY',
    'AVALAI_API_KEY',
    'DATABASE_ID',
    'DAILY_COLLECTION_ID',
    'HOURLY_COLLECTION_ID',
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CHANNEL_ID',
  ];

  const missingEnv = requiredEnv.filter((key) => !process.env[key]);
  if (missingEnv.length > 0) {
    const errorMessage = `متغیرهای محیطی ضروری وجود ندارد: ${missingEnv.join(', ')}`;
    error(errorMessage);
    return res.json({ success: false, error: errorMessage }, 500);
  }

  const {
    APPWRITE_ENDPOINT,
    APPWRITE_PROJECT_ID,
    APPWRITE_API_KEY,
    GEMINI_API_KEY,
    AVALAI_API_KEY,
    DATABASE_ID,
    DAILY_COLLECTION_ID,
    HOURLY_COLLECTION_ID,
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHANNEL_ID,
  } = process.env;

  const appwriteClient = new Client()
    .setEndpoint(APPWRITE_ENDPOINT)
    .setProject(APPWRITE_PROJECT_ID)
    .setKey(APPWRITE_API_KEY);
  const databases = new Databases(appwriteClient);

  try {
    // --- 2. Fetch All Required Data ---
    log('دریافت داده‌ها از منابع...');

    const btcPriceResponse = await axios.get(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_last_updated_at=true',
      { timeout: 5000 }
    );

    if (!btcPriceResponse.data?.bitcoin?.usd) {
      throw new Error('خطا در دریافت قیمت بیت‌کوین از CoinGecko');
    }

    const currentPrice = btcPriceResponse.data.bitcoin.usd;
    const priceTimestamp = btcPriceResponse.data.bitcoin.last_updated_at;

    // Fetch latest daily and hourly data (full attributes)
    const [dailyDocs, hourlyDocs] = await Promise.all([
      databases.listDocuments(DATABASE_ID, DAILY_COLLECTION_ID, [
        Query.orderDesc('date'),
        Query.limit(60),
      ]),
      databases.listDocuments(DATABASE_ID, HOURLY_COLLECTION_ID, [
        Query.orderDesc('date'),
        Query.limit(72),
      ]),
    ]);

    if (dailyDocs.documents.length === 0) {
      throw new Error('داده‌های روزانه یافت نشد');
    }

    if (hourlyDocs.documents.length === 0) {
      throw new Error('داده‌های ساعتی یافت نشد');
    }

    // Fetch last 30 days OHLCV (limited attributes)
    const dailyOHLCVDocs = await databases.listDocuments(
      DATABASE_ID,
      DAILY_COLLECTION_ID,
      [
        Query.orderDesc('date'),
        Query.limit(30),
        Query.select(['date', 'open', 'high', 'low', 'close', 'volume']),
      ]
    );

    if (dailyOHLCVDocs.documents.length === 0) {
      throw new Error('داده‌های OHLCV روزانه برای 30 روز گذشته یافت نشد');
    }

    // Fetch last 24 hours OHLCV (limited attributes)
    const hourlyOHLCVDocs = await databases.listDocuments(
      DATABASE_ID,
      HOURLY_COLLECTION_ID,
      [
        Query.orderDesc('date'),
        Query.limit(24),
        Query.select(['date', 'open', 'high', 'low', 'close', 'volume']),
      ]
    );

    if (hourlyOHLCVDocs.documents.length === 0) {
      throw new Error('داده‌های OHLCV ساعتی برای 24 ساعت گذشته یافت نشد');
    }

    const latestDaily = prepareTechnicalData(dailyDocs.documents[0]);
    const latestHourly = prepareTechnicalData(hourlyDocs.documents[0]);

    // Prepare last 30 days and 24 hours OHLCV data
    const last30DaysOHLCV = dailyOHLCVDocs.documents.map(prepareOHLCVData);
    const last24HoursOHLCV = hourlyOHLCVDocs.documents.map(prepareOHLCVData);

    const getLiquidityLevels = (docs, prefix) => {
      const levels = {
        high_20: null,
        low_20: null,
        high_40: null,
        low_40: null,
        high_60: null,
        low_60: null,
        weekly_high: null,
        weekly_low: null,
      };

      if (docs.length >= 20) {
        const last20 = docs.slice(0, 20);
        levels.high_20 = Math.max(...last20.map((d) => d.high));
        levels.low_20 = Math.min(...last20.map((d) => d.low));
      }

      if (docs.length >= 40) {
        const last40 = docs.slice(0, 40);
        levels.high_40 = Math.max(...last40.map((d) => d.high));
        levels.low_40 = Math.min(...last40.map((d) => d.low));
      }

      if (docs.length >= 60) {
        const last60 = docs.slice(0, 60);
        levels.high_60 = Math.max(...last60.map((d) => d.high));
        levels.low_60 = Math.min(...last60.map((d) => d.low));
      }

      if (docs.length >= 7) {
        const last7 = docs.slice(0, 7);
        levels.weekly_high = Math.max(...last7.map((d) => d.high));
        levels.weekly_low = Math.min(...last7.map((d) => d.low));
      }

      return Object.keys(levels).reduce((acc, key) => {
        acc[`${prefix}_${key}`] = levels[key];
        return acc;
      }, {});
    };

    const dailyLiquidity = getLiquidityLevels(dailyDocs.documents, 'daily');
    const hourlyLiquidity = getLiquidityLevels(hourlyDocs.documents, 'hourly');

    // --- 3. Persian AI Prompt Structure ---
    const prompt = `
      شما 'Aidin' هستید، یک تحلیلگر کمی حرفه‌ای در بازار بیت‌کوین.
      لطفاً داده‌های فنی و بنیادی را تحلیل کنید و یک سیگنال معاملاتی با اطمینان بالا ارائه دهید.

      ## الزامات تحلیل

      **1. وضعیت بازار و زمان (به وقت نیویورک)**
      - تاریخ فعلی: ${getNYDate()}
      - ساعت فعلی: ${getNYTime()}
      - وضعیت بازار آمریکا: ${isUSMarketOpen() ? 'باز' : 'بسته'}
      - امروز ${isUSMarketOpen() ? 'روز معاملاتی است' : 'تعطیل آخر هفته است'} - ${isUSMarketOpen() ? 'انتظار نوسان طبیعی' : 'انتظار نوسان کمتر'}

      **2. تحلیل بنیادی و احساسات بازار (نیاز به جستجوی آنلاین دارد)**
      تمرکز بر:
      - اخبار اقتصادی آمریکا: CPI، تورم، گزارش اشتغال، سخنرانی فدرال رزرو
      - رویدادهای خاص رمزارزها: اخبار قانون‌گذاری، حرکات بزرگ‌ترین سرمایه‌گذاران
      - رویدادهای مهم: تاریخ‌های انقضای فیوچرز، تغییرات جریان ETF
      - در بخش تحلیل بنیادی، لطفاً بر اخبار و رویدادهای مهم بازار در هفته جاری و هفته آینده تمرکز کنید، از جمله گزارش‌های اقتصادی مانند CPI، تورم، و رویدادهای مرتبط با رمزارزها. لطفاً تأثیر مورد انتظار این رویدادها بر بازار را ذکر کنید، به عنوان مثال: "گزارش CPI در روز چهارشنبه منتشر می‌شود و انتظار می‌رود که ..." یا "در هفته آینده، عدم وجود اخبار اقتصادی آمریکا ممکن است بازار را ...".

      **3. تحلیل نقدینگی (بسیار مهم)**
      سطوح کلیدی نقدینگی:
      ${JSON.stringify({ ...dailyLiquidity, ...hourlyLiquidity }, null, 2)}

      اصول معاملاتی:
      - قیمت تمایل دارد به سطوح بالای highs و پایین lows حمله کند
      - EMA 50 روزه ($${latestDaily.ema50}) مانند آهنربا عمل می‌کند

      **4. وضعیت فعلی بازار**
      - قیمت بیت‌کوین: $${currentPrice}

      **5. وضعیت تکنیکال**
      آخرین کندل روزانه (شامل تمام شاخص‌های فنی):
      ${JSON.stringify(latestDaily, null, 2)}

      آخرین کندل ساعتی (شامل تمام شاخص‌های فنی):
      ${JSON.stringify(latestHourly, null, 2)}

      **6. داده‌های OHLCV 30 روز گذشته (روزانه)**
      داده‌های روزانه شامل تاریخ، باز، بالا، پایین، بسته، و حجم:
      ${JSON.stringify(last30DaysOHLCV, null, 2)}

      **7. داده‌های OHLCV 24 ساعت گذشته (ساعتی)**
      داده‌های ساعتی شامل تاریخ، باز، بالا، پایین، بسته، و حجم:
      ${JSON.stringify(last24HoursOHLCV, null, 2)}

      **8. اهرم پیشنهادی**
      - برای سیگنال‌های LONG و SHORT، یک اهرم مناسب (مانند 1:3، 1:5، 1:10) بر اساس نوسانات بازار، ارزیابی ریسک، و بازه زمانی پیشنهاد دهید.
      - اهرم باید با توجه به ریسک و نوسانات معقول باشد (مثلاً اهرم بالاتر برای بازه‌های کوتاه‌مدت با نوسان بالا، اهرم پایین‌تر برای بازه‌های بلندمدت یا نوسان کم).
      - برای سیگنال HOLD، اهرم باید "N/A" باشد.

      **9. حداقل حرکت قیمتی**
      - سیگنال‌های LONG و SHORT باید حداقل 400 دلار حرکت قیمتی بالقوه (بین محدوده ورود و اهداف سود یا حد ضرر) داشته باشند تا برای کاربران عملی باشند.
      - اگر حرکت قیمتی کمتر از 400 دلار باشد، سیگنال را تولید نکنید و به جای آن یک سیگنال HOLD با دلیل مناسب ارائه دهید.

      ## فرمت پاسخ مورد نیاز
      پاسخ شما باید به صورت JSON با این فیلدها باشد:
      {
        "signal": "LONG|SHORT|HOLD",
        "confidence": "کم|متوسط|بالا",
        "timeframe": "کوتاه‌مدت|میان‌مدت|بلندمدت",
        "summary": "خلاصه تحلیل در 1-2 جمله",
        "entry_price_range": "محدوده قیمت ورود",
        "take_profit_levels": ["هدف 1", "هدف 2"],
        "stop_loss": "حد ضرر",
        "technical_analysis": "تحلیل تکنیکال دقیق",
        "fundamental_sentiment_analysis": "تحلیل بنیادی",
        "risk_assessment": "ارزیابی ریسک",
        "hold_rationale": "دلیل نگهداری (در صورت HOLD)",
        "ideal_trade_scenario": "سناریوی ایده‌آل معامله",
        "market_context": {
          "time": "${getNYTime()} NYT",
          "price": "$${currentPrice}",
          "volatility": "سطح پیش‌بینی شده نوسان"
        },
        "leverage": "1:3|1:5|1:10|N/A"
      }

      ## نکات مهم
      1. تمام تحلیل‌ها باید بر اساس داده‌های ارائه شده باشد
      2. تحلیل تکنیکال باید شامل سطوح نقدینگی و داده‌های OHLCV باشد
      3. برای سیگنال HOLD دلیل واضح ارائه شود
      4. اهرم پیشنهادی باید با توجه به ریسک و نوسانات بازار منطقی باشد
      5. سیگنال‌های LONG و SHORT باید حداقل 400 دلار حرکت قیمتی داشته باشند
      6. لطفاً تمام پاسخ‌ها را به زبان فارسی ارائه دهید، بدون هیچ متنی به زبان انگلیسی
      7. در تحلیل خود، لطفاً تمام اعداد را به نزدیک‌ترین عدد صحیح گرد کنید (مثلاً 5.58 به 6 و 107338.5 به 107339)
    `;

    log(`طول پرامپت ارسالی به AI: ${prompt.length} کاراکتر`);

    // --- 4. AI Call with Gemini as Primary ---
    let analysis;
    let aiProvider = 'Gemini';

    try {
      log('استفاده از Gemini API...');
      const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        tools: [{ googleSearch: {} }],
        safetySettings: [
          {
            category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
            threshold: HarmBlockThreshold.BLOCK_NONE,
          },
        ],
      });

      geminiRequestCount++;
      log(`تعداد درخواست‌های Gemini تاکنون: ${geminiRequestCount}`);
      if (geminiRequestCount > MAX_FREE_REQUESTS) {
        throw new Error(
          `محدودیت درخواست روزانه رایگان Gemini (${MAX_FREE_REQUESTS}) فراتر رفت.`
        );
      }

      let attempts = 0;
      let success = false;
      let lastError = null;

      while (attempts < 3 && !success) {
        try {
          log(`تلاش ${attempts + 1} برای دریافت پاسخ از Gemini...`);
          const result = await model.generateContent(prompt);
          const responseText = result.response.text();
          log('پاسخ خام Gemini:', responseText.substring(0, 500) + '...');

          let jsonString = responseText;
          const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/);
          if (jsonMatch) jsonString = jsonMatch[1];

          analysis = JSON.parse(jsonString);
          log('پاسخ JSON Gemini:', JSON.stringify(analysis, null, 2));
          validateAIResponse(analysis);
          success = true;
        } catch (err) {
          lastError = err;
          attempts++;
          log(`خطای Gemini در تلاش ${attempts}: ${err.message}`);
          if (attempts < 3) {
            await new Promise((resolve) =>
              setTimeout(resolve, 2000 * Math.pow(2, attempts))
            );
          }
        }
      }

      if (!success) {
        throw (
          lastError || new Error('خطا در ارتباط با Gemini API پس از 3 تلاش')
        );
      }

      log('تحلیل با موفقیت از Gemini 2.5 Flash دریافت شد');
    } catch (geminiError) {
      error(`خطا در Gemini: ${geminiError.message}. استفاده از AvalAI...`);
      aiProvider = 'AvalAI';

      try {
        log('ارسال درخواست به AvalAI...');
        const avalaiResponse = await axios.post(
          'https://api.avalai.ir/v1/chat/completions',
          {
            model: 'gpt-4o-mini-search-preview',
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'text' },
            store: false,
          },
          {
            headers: {
              Authorization: `Bearer ${AVALAI_API_KEY}`,
              'Content-Type': 'application/json',
            },
            timeout: 30000,
          }
        );

        if (!avalaiResponse.data?.choices?.[0]?.message?.content) {
          throw new Error('پاسخ خالی از AvalAI دریافت شد');
        }

        let responseText = avalaiResponse.data.choices[0].message.content;
        log('پاسخ خام AvalAI:', responseText.substring(0, 500) + '...');

        let jsonString = responseText;
        try {
          analysis = JSON.parse(responseText);
        } catch {
          const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/);
          if (jsonMatch) {
            jsonString = jsonMatch[1];
            analysis = JSON.parse(jsonString);
          } else {
            throw new Error('قالب پاسخ AvalAI نامعتبر است');
          }
        }

        log('پاسخ JSON AvalAI:', JSON.stringify(analysis, null, 2));
        validateAIResponse(analysis);
        log('تحلیل با موفقیت از AvalAI دریافت شد');
      } catch (avalaiError) {
        error(`هر دو سرویس AI با خطا مواجه شدند: ${avalaiError.message}`);
        throw new Error('خطا در تحلیل بازار پس از تلاش با هر دو سرویس');
      }
    }

    // Add metadata to analysis
    analysis.timestamp = new Date().toISOString();
    analysis.current_price = currentPrice;
    analysis.ai_provider = aiProvider;
    analysis.request_count = geminiRequestCount;

    // --- 5. Filter Small Signals ---
    if (!filterSmallSignals(analysis, log)) {
      const errorMessage =
        'هیچ سیگنال معتبری با حرکت قیمتی حداقل 400 دلار تولید نشد';
      log(errorMessage);
      try {
        await axios.post(
          Switzerland`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            chat_id: TELEGRAM_CHANNEL_ID,
            text: escapeMarkdownV2(errorMessage),
            parse_mode: 'MarkdownV2',
          },
          { timeout: 5000 }
        );
        log('پیام خطای سیگنال کوچک به تلگرام ارسال شد');
      } catch (telegramError) {
        error(`خطا در ارسال اخطار به تلگرام: ${telegramError.message}`);
      }
      return res.json(
        {
          success: false,
          error: errorMessage,
          details: 'حرکت قیمتی سیگنال کمتر از 400 دلار است',
          gemini_request_count: geminiRequestCount,
        },
        400
      );
    }

    // --- 6. Send to Telegram ---
    const sendTelegramMessage = async (message) => {
      const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
      const safeMessage = escapeMarkdownV2(message);
      log('پیام تلگرام قبل از ارسال:', safeMessage.substring(0, 500) + '...');

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          log(`تلاش ${attempt} برای ارسال پیام به تلگرام...`);
          const response = await axios.post(
            telegramUrl,
            {
              chat_id: TELEGRAM_CHANNEL_ID,
              text: safeMessage,
              parse_mode: 'MarkdownV2',
            },
            { timeout: 5000 }
          );

          if (response.data.ok) {
            log('پیام با موفقیت به تلگرام ارسال شد');
            return true;
          } else {
            throw new Error(
              `تلگرام پاسخ ناموفق داد: ${response.data.description}`
            );
          }
        } catch (err) {
          const errorMsg = err.response?.data?.description || err.message;
          error(`تلاش ${attempt} برای ارسال به تلگرام ناموفق: ${errorMsg}`);

          if (attempt === 1 && errorMsg.includes('Markdown')) {
            try {
              log('تلاش با فرمت ساده متن...');
              await axios.post(
                telegramUrl,
                {
                  chat_id: TELEGRAM_CHANNEL_ID,
                  text: message,
                },
                { timeout: 5000 }
              );
              log('پیام با فرمت ساده به تلگرام ارسال شد');
              return true;
            } catch (simpleError) {
              error(`ارسال ساده نیز ناموفق بود: ${simpleError.message}`);
            }
          }

          await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
        }
      }
      throw new Error('ارسال پیام به تلگرام پس از 3 تلاش ناموفق بود');
    };

    // Send Word document to Telegram
    const sendTelegramDocument = async (docxBuffer, log) => {
      const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`;
      const formData = new FormData();
      formData.append('chat_id', TELEGRAM_CHANNEL_ID);
      formData.append('document', Buffer.from(docxBuffer), {
        filename: 'Aidin_AI_Analysis.docx',
        contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      formData.append('caption', escapeMarkdownV2('سند کامل تحلیل Aidin AI'));

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          log(`تلاش ${attempt} برای ارسال سند Word به تلگرام...`);
          const response = await axios.post(telegramUrl, formData, {
            headers: formData.getHeaders(),
            timeout: 10000,
          });

          if (response.data.ok) {
            log('سند Word با موفقیت به تلگرام ارسال شد');
            return true;
          } else {
            throw new Error(
              `تلگرام پاسخ ناموفق داد: ${response.data.description}`
            );
          }
        } catch (err) {
          const errorMsg = err.response?.data?.description || err.message;
          error(`تلاش ${attempt} برای ارسال سند Word ناموفق: ${errorMsg}`);
          if (attempt === 3) {
            throw new Error(
              'ارسال سند Word به تلگرام پس از 3 تلاش ناموفق بود: ' + errorMsg
            );
          }
          await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
        }
      }
    };

    try {
      // Send text message
      const telegramMessage = formatForTelegram(analysis, log);
      await sendTelegramMessage(telegramMessage);

      // Generate and send Word document
      const docxParagraphs = formatForDocx(analysis);
      const docxBuffer = await generateDocx(docxParagraphs, log);
      await sendTelegramDocument(docxBuffer, log);
    } catch (telegramError) {
      error(`خطای ارسال به تلگرام: ${telegramError.message}`);
      try {
        const errorMessage = `⚠️ خطا در ارسال سند به تلگرام: ${telegramError.message.substring(0, 200)}`;
        await axios.post(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            chat_id: TELEGRAM_CHANNEL_ID,
            text: escapeMarkdownV2(errorMessage),
            parse_mode: 'MarkdownV2',
          },
          { timeout: 5000 }
        );
        log('پیام خطای تلگرام ارسال شد');
      } catch (telegramError2) {
        error(`خطا در ارسال اخطار به تلگرام: ${telegramError2.message}`);
      }
      throw new Error(`ارسال به تلگرام ناموفق: ${telegramError.message}`);
    }

    // --- 7. Store in Database ---
    try {
      log('ذخیره تحلیل در پایگاه داده...');
      await databases.createDocument(DATABASE_ID, 'ai_signals', ID.unique(), {
        timestamp: analysis.timestamp,
        signal: analysis.signal,
        confidence: analysis.confidence,
        price: currentPrice,
        leverage: analysis.leverage,
        analysis: JSON.stringify(analysis),
        ai_provider: aiProvider,
        success: true,
        gemini_request_count: geminiRequestCount,
      });
      log('تحلیل در پایگاه داده ذخیره شد');
    } catch (dbError) {
      error(`خطا در ذخیره تحلیل در پایگاه داده: ${dbError.message}`);
    }

    return res.json({ success: true, analysis });
  } catch (e) {
    error(`خطای بحرانی: ${e.message}`);

    try {
      const errorMessage = `⚠️ خطا در Aidin AI ⚠️\n${e.message.substring(0, 200)}`;
      await axios.post(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          chat_id: TELEGRAM_CHANNEL_ID,
          text: escapeMarkdownV2(errorMessage),
          parse_mode: 'MarkdownV2',
        },
        { timeout: 5000 }
      );
      log('پیام خطا به تلگرام ارسال شد');
    } catch (telegramError) {
      error(`خطا در ارسال اخطار به تلگرام: ${telegramError.message}`);
    }

    return res.json(
      {
        success: false,
        error: 'تحلیل ناموفق بود',
        details: e.message,
        gemini_request_count: geminiRequestCount,
      },
      500
    );
  }
};
