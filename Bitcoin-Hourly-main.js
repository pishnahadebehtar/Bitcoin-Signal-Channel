import { Client, Databases, ID, Query } from 'node-appwrite';
import axios from 'axios';
import * as math from 'mathjs';

export default async function ({ req, res, log, error }) {
  try {
    // Initialize Appwrite client
    const client = new Client()
      .setEndpoint(
        process.env.APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1'
      )
      .setProject(process.env.APPWRITE_PROJECT_ID)
      .setKey(process.env.APPWRITE_API_KEY);

    const databases = new Databases(client);
    const DATABASE_ID = '67c0659400092309e435';
    const COLLECTION_ID = '6850a7140011601378cf';

    const cryptoCompareApiKey = process.env.CRYPTOCOMPARE_API_KEY || '';
    const API_HEADERS = cryptoCompareApiKey
      ? { authorization: `Apikey ${cryptoCompareApiKey}` }
      : {};

    // Get current time and align to the most recent complete hour
    const now = new Date();
    now.setUTCMinutes(0, 0, 0, 0);
    const processUntil = new Date(now);
    processUntil.setUTCHours(now.getUTCHours() - 1); // Process until last complete hour

    // Get the latest record from database
    const latestDoc = await databases.listDocuments(
      DATABASE_ID,
      COLLECTION_ID,
      [Query.orderDesc('date'), Query.limit(1)]
    );
    let lastDate =
      latestDoc.total > 0
        ? new Date(latestDoc.documents[0].date)
        : new Date(Date.now() - 24 * 60 * 60 * 1000); // Default to 24 hours ago if no records
    lastDate.setUTCMinutes(0, 0, 0, 0);

    // Fetch hourly candle from CryptoCompare
    const fetchCandle = async (dateStr) => {
      const targetDate = new Date(dateStr);
      const toTs = Math.floor(targetDate.getTime() / 1000) + 3600; // Add 1 hour

      log(`Fetching hourly candle for ${dateStr}...`);
      try {
        const response = await axios.get(
          'https://min-api.cryptocompare.com/data/v2/histohour',
          {
            params: {
              fsym: 'BTC',
              tsym: 'USD',
              limit: 1,
              toTs: toTs,
              aggregate: 1,
            },
            headers: API_HEADERS,
          }
        );

        const hourlyData = response.data.Data.Data;
        if (!hourlyData || hourlyData.length === 0) {
          throw new Error(`No hourly data found for ${dateStr}`);
        }

        const candle = hourlyData[0];
        if (!candle) {
          throw new Error(`No candle data available for ${dateStr}`);
        }

        const candleDate = new Date(candle.time * 1000);
        const candleDateStr = candleDate.toISOString();

        // Validate the candle date matches our request
        if (Math.abs(candleDate - targetDate) > 3600000) {
          // More than 1 hour difference
          throw new Error(
            `Date mismatch: Received data for ${candleDateStr} but expected ${dateStr}`
          );
        }

        return {
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volumeBtc: candle.volumefrom,
          volumeUsd: candle.volumeto,
        };
      } catch (err) {
        error(`Failed to fetch candle for ${dateStr}: ${err.message}`);

        // Retry logic for rate limits or server errors
        if (err.response?.status === 429 || err.response?.status >= 500) {
          const maxRetries = 3;
          for (let i = 1; i <= maxRetries; i++) {
            const delay = Math.pow(2, i) * 1000;
            log(`Retry ${i}/${maxRetries} in ${delay}ms...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
            try {
              return await fetchCandle(dateStr);
            } catch (retryErr) {
              error(`Retry ${i} failed: ${retryErr.message}`);
              if (i === maxRetries) throw retryErr;
            }
          }
        }
        throw err;
      }
    };

    // Process candle and calculate indicators
    const processCandle = async (dateStr, candle) => {
      const { open, high, low, close, volumeBtc } = candle;

      // Check if record already exists
      const existing = await databases.listDocuments(
        DATABASE_ID,
        COLLECTION_ID,
        [Query.equal('date', dateStr), Query.limit(1)]
      );
      if (existing.total > 0) {
        log(`Record for ${dateStr} already exists, skipping`);
        return;
      }

      // Get historical data for calculations
      const historical = await databases.listDocuments(
        DATABASE_ID,
        COLLECTION_ID,
        [Query.orderDesc('date'), Query.limit(500)]
      );

      const data = historical.documents
        .map((doc) => ({
          Date: doc.date,
          Open: doc.open,
          High: doc.high,
          Low: doc.low,
          Close: doc.close,
          'Volume BTC': doc.volume,
        }))
        .reverse()
        .concat([
          {
            Date: dateStr,
            Open: open,
            High: high,
            Low: low,
            Close: close,
            'Volume BTC': volumeBtc,
          },
        ]);

      // Indicator calculation functions
      const sma = (arr, period) =>
        arr.length < period ? null : math.mean(arr.slice(-period));

      const ema = (arr, period) => {
        if (arr.length < period) return null;
        const k = 2 / (period + 1);
        let emaValue = arr.slice(0, period).reduce((s, v) => s + v, 0) / period;
        for (let i = period; i < arr.length; i++)
          emaValue = arr[i] * k + emaValue * (1 - k);
        return emaValue;
      };

      const std = (arr, period) =>
        arr.length < period ? null : math.std(arr.slice(-period));

      const record = {
        Date: dateStr,
        Open: open,
        High: high,
        Low: low,
        Close: close,
        'Volume BTC': volumeBtc,
      };

      const closes = data.map((d) => d.Close);

      // Percentage Changes
      record['Percentage Change from 1 Hour Ago'] =
        closes.length >= 2
          ? ((closes[closes.length - 1] - closes[closes.length - 2]) /
              closes[closes.length - 2]) *
            100
          : null;
      record['Percentage Change from 6 Hours Ago'] =
        closes.length >= 7
          ? ((closes[closes.length - 1] - closes[closes.length - 7]) /
              closes[closes.length - 7]) *
            100
          : null;
      record['Percentage Change from 24 Hours Ago'] =
        closes.length >= 25
          ? ((closes[closes.length - 1] - closes[closes.length - 25]) /
              closes[closes.length - 25]) *
            100
          : null;
      record['Percentage Change from 1 Hour from Now'] = null;
      record['Percentage Change from 6 Hours from Now'] = null;
      record['Percentage Change from 24 Hours from Now'] = null;

      // RSI (14 hours)
      const gains = [],
        losses = [];
      for (let i = 1; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        gains.push(diff > 0 ? diff : 0);
        losses.push(diff < 0 ? -diff : 0);
      }
      const avgGains = sma(gains.slice(-14), 14);
      const avgLosses = sma(losses.slice(-14), 14);
      record.RSI =
        avgLosses === 0
          ? 100
          : avgGains === 0
            ? 0
            : 100 - 100 / (1 + avgGains / avgLosses);

      // EMAs
      record['50 Hour EMA'] = ema(closes, 50);
      record['26 Hour EMA'] = ema(closes, 26);
      record['12 Hour EMA'] = ema(closes, 12);

      // Bollinger Bands
      record['20 Hour SMA'] = sma(closes, 20);
      record['20 Hour SD'] = std(closes, 20);
      record['20 Hour Upper Band'] = record['20 Hour SMA']
        ? record['20 Hour SMA'] + 2 * record['20 Hour SD']
        : null;
      record['20 Hour Lower Band'] = record['20 Hour SMA']
        ? record['20 Hour SMA'] - 2 * record['20 Hour SD']
        : null;

      // MACD
      const calculateFullEma = (series, period) => {
        if (series.length < period) return [];
        const k = 2 / (period + 1);
        const emas = [];
        let emaValue =
          series.slice(0, period).reduce((s, v) => s + v, 0) / period;
        emas.push(emaValue);
        for (let i = period; i < series.length; i++) {
          emaValue = series[i] * k + emaValue * (1 - k);
          emas.push(emaValue);
        }
        return emas;
      };

      const ema12Series = calculateFullEma(closes, 12);
      const ema26Series = calculateFullEma(closes, 26);
      if (ema12Series.length > 0 && ema26Series.length > 0) {
        const macdLineSeries = ema12Series
          .slice(-ema26Series.length)
          .map((val, index) => val - ema26Series[index]);
        if (macdLineSeries.length >= 9) {
          const signalLine = ema(macdLineSeries, 9);
          const macdLine = macdLineSeries[macdLineSeries.length - 1];
          record['MACD Line'] = macdLine;
          record['MACD Signal Line'] = signalLine;
          record['MACD Histogram'] = macdLine - signalLine;
        }
      }

      // Fibonacci Levels
      for (const [period, prefix] of [
        [24, '24 Hour'],
        [48, '48 Hour'],
        [72, '72 Hour'],
      ]) {
        if (data.length >= period) {
          const highs = data.map((d) => d.High).slice(-period);
          const lows = data.map((d) => d.Low).slice(-period);
          record[`${prefix} High`] = Math.max(...highs);
          record[`${prefix} Low`] = Math.min(...lows);
          const fibLevels = [0.23, 0.38, 0.5, 0.61, 0.78];
          for (const level of fibLevels) {
            const levelStr = level.toString().replace('.', '_');
            record[`${prefix} Fib ${levelStr}`] =
              record[`${prefix} Low`] +
              (record[`${prefix} High`] - record[`${prefix} Low`]) * level;
          }
        }
      }

      // Support Bands
      record['20 Week SMA'] = sma(closes, 3360); // 24*7*20 hours
      record['21 Week EMA'] = ema(closes, 3528); // 24*7*21 hours

      // OBV
      let obv = 0;
      if (data.length > 1) {
        for (let i = 1; i < data.length; i++) {
          if (data[i].Close > data[i - 1].Close) obv += data[i]['Volume BTC'];
          else if (data[i].Close < data[i - 1].Close)
            obv -= data[i]['Volume BTC'];
        }
      }
      record.OBV = obv;

      // VWAP
      const typicalPrices = data.map((d) => (d.High + d.Low + d.Close) / 3);
      const volumes = data.map((d) => d['Volume BTC']);
      record.VWAP =
        math.sum(volumes) > 0
          ? math.sum(typicalPrices.map((p, i) => p * volumes[i])) /
            math.sum(volumes)
          : 0;

      // ATR
      const trueRanges = [];
      if (data.length > 1) {
        for (let i = 1; i < data.length; i++) {
          trueRanges.push(
            Math.max(
              data[i].High - data[i].Low,
              Math.abs(data[i].High - data[i - 1].Close),
              Math.abs(data[i].Low - data[i - 1].Close)
            )
          );
        }
        record['True Range'] = trueRanges[trueRanges.length - 1];
        record.ATR = sma(trueRanges, 14);
      }

      // Stochastic Oscillator
      if (data.length >= 14) {
        const last14Highs = data.map((d) => d.High).slice(-14);
        const last14Lows = data.map((d) => d.Low).slice(-14);
        const highestHigh = Math.max(...last14Highs);
        const lowestLow = Math.min(...last14Lows);
        record['Stochastic K'] =
          (100 * (close - lowestLow)) / (highestHigh - lowestLow);
        const kValues = [];
        for (let i = data.length - 3; i < data.length; i++) {
          if (i >= 14) {
            const h = Math.max(...data.slice(i - 14, i).map((d) => d.High));
            const l = Math.min(...data.slice(i - 14, i).map((d) => d.Low));
            kValues.push((100 * (data[i].Close - l)) / (h - l));
          }
        }
        record['Stochastic D'] = sma(kValues, 3);
      }

      // Fair Value Gaps
      record['Bullish FVG Exists'] = false;
      record['Bullish FVG Range'] = null;
      if (data.length >= 3) {
        const c1 = data[data.length - 3],
          c3 = data[data.length - 1];
        if (c3.Low > c1.High) {
          record['Bullish FVG Exists'] = true;
          record['Bullish FVG Range'] =
            `${Math.floor(c1.High)}–${Math.floor(c3.Low)}`;
        }
      }

      record['Bearish FVG Exists'] = false;
      record['Bearish FVG Range'] = null;
      if (data.length >= 3) {
        const c1 = data[data.length - 3],
          c3 = data[data.length - 1];
        if (c3.High < c1.Low) {
          record['Bearish FVG Exists'] = true;
          record['Bearish FVG Range'] =
            `${Math.floor(c3.High)}–${Math.floor(c1.Low)}`;
        }
      }

      // Map to Appwrite attributes
      const columnMapping = {
        date: 'Date',
        open: 'Open',
        high: 'High',
        low: 'Low',
        close: 'Close',
        volume: 'Volume BTC',
        pct_change_1h_ago: 'Percentage Change from 1 Hour Ago',
        pct_change_6h_ago: 'Percentage Change from 6 Hours Ago',
        pct_change_24h_ago: 'Percentage Change from 24 Hours Ago',
        pct_change_1h_future: 'Percentage Change from 1 Hour from Now',
        pct_change_6h_future: 'Percentage Change from 6 Hours from Now',
        pct_change_24h_future: 'Percentage Change from 24 Hours from Now',
        rsi: 'RSI',
        ema_50h: '50 Hour EMA',
        sma_20h: '20 Hour SMA',
        sd_20h: '20 Hour SD',
        upper_band_20h: '20 Hour Upper Band',
        lower_band_20h: '20 Hour Lower Band',
        ema_26h: '26 Hour EMA',
        ema_12h: '12 Hour EMA',
        macd_line: 'MACD Line',
        macd_signal_line: 'MACD Signal Line',
        macd_histogram: 'MACD Histogram',
        high_24h: '24 Hour High',
        low_24h: '24 Hour Low',
        fib_24h_0_23: '24 Hour Fib 0_23',
        fib_24h_0_38: '24 Hour Fib 0_38',
        fib_24h_0_5: '24 Hour Fib 0_5',
        fib_24h_0_61: '24 Hour Fib 0_61',
        fib_24h_0_78: '24 Hour Fib 0_78',
        high_48h: '48 Hour High',
        low_48h: '48 Hour Low',
        fib_48h_0_23: '48 Hour Fib 0_23',
        fib_48h_0_38: '48 Hour Fib 0_38',
        fib_48h_0_5: '48 Hour Fib 0_5',
        fib_48h_0_61: '48 Hour Fib 0_61',
        fib_48h_0_78: '48 Hour Fib 0_78',
        high_72h: '72 Hour High',
        low_72h: '72 Hour Low',
        fib_72h_0_23: '72 Hour Fib 0_23',
        fib_72h_0_38: '72 Hour Fib 0_38',
        fib_72h_0_5: '72 Hour Fib 0_5',
        fib_72h_0_61: '72 Hour Fib 0_61',
        fib_72h_0_78: '72 Hour Fib 0_78',
        sma_20w: '20 Week SMA',
        ema_21w: '21 Week EMA',
        fvg_bullish_exists: 'Bullish FVG Exists',
        fvg_bullish_range: 'Bullish FVG Range',
        fvg_bearish_exists: 'Bearish FVG Exists',
        fvg_bearish_range: 'Bearish FVG Range',
        obv: 'OBV',
        vwap: 'VWAP',
        true_range: 'True Range',
        atr: 'ATR',
        stochastic_k: 'Stochastic K',
        stochastic_d: 'Stochastic D',
      };

      const appwriteRecord = {};
      for (const [key, value] of Object.entries(columnMapping)) {
        appwriteRecord[key] =
          record[value] !== undefined && record[value] !== null
            ? record[value]
            : key.includes('_exists')
              ? false
              : null;
      }

      await databases.createDocument(
        DATABASE_ID,
        COLLECTION_ID,
        ID.unique(),
        appwriteRecord
      );
      log(`Inserted record for ${dateStr}`);

      // Update future percentage changes for past records
      for (const [hoursAgo, field] of [
        [1, 'pct_change_1h_future'],
        [6, 'pct_change_6h_future'],
        [24, 'pct_change_24h_future'],
      ]) {
        const pastDate = new Date(dateStr);
        pastDate.setUTCHours(pastDate.getUTCHours() - hoursAgo);
        const pastDateStr = pastDate.toISOString();
        try {
          const pastDocs = await databases.listDocuments(
            DATABASE_ID,
            COLLECTION_ID,
            [Query.equal('date', pastDateStr), Query.limit(1)]
          );
          if (pastDocs.total > 0) {
            const doc = pastDocs.documents[0];
            const pastClose = doc.close;
            if (pastClose && close) {
              const pctChange = ((close - pastClose) / pastClose) * 100;
              await databases.updateDocument(
                DATABASE_ID,
                COLLECTION_ID,
                doc.$id,
                { [field]: pctChange }
              );
              log(`Updated ${field} for ${pastDateStr}`);
            }
          }
        } catch (err) {
          log(
            `Warning: Failed to update ${field} for ${pastDateStr}: ${err.message}`
          );
        }
      }
    };

    // Find missing hours (up to 24 hours back)
    const missingHours = [];
    let currentHour = new Date(lastDate);
    currentHour.setUTCHours(currentHour.getUTCHours() + 1);

    const endHour = new Date(processUntil);
    endHour.setUTCHours(endHour.getUTCHours());

    while (currentHour <= endHour) {
      missingHours.push(currentHour.toISOString());
      currentHour.setUTCHours(currentHour.getUTCHours() + 1);
    }

    if (missingHours.length > 0) {
      log(
        `Found ${missingHours.length} missing hours to process: from ${missingHours[0]} to ${missingHours[missingHours.length - 1]}`
      );

      // Process missing hours in sequence
      for (const hourStr of missingHours) {
        try {
          log(`Processing ${hourStr}...`);
          const candle = await fetchCandle(hourStr);

          // Validate candle data
          if (
            candle.close < candle.low ||
            candle.close > candle.high ||
            candle.volumeBtc <= 0
          ) {
            throw new Error(
              `Invalid candle data for ${hourStr}: Close ${candle.close} not between ${candle.low}-${candle.high} or volume ${candle.volumeBtc} <= 0`
            );
          }

          await processCandle(hourStr, candle);
          await new Promise((resolve) => setTimeout(resolve, 1200)); // Rate limiting
        } catch (err) {
          error(`Skipping ${hourStr} due to error: ${err.message}`);
          continue;
        }
      }
    } else {
      log('No missing hours to process. Data is up to date.');
    }

    // Try to process the current hour (may be incomplete)
    const currentHourStr = now.toISOString();
    try {
      log(`Checking for latest available candle (${currentHourStr})...`);
      const latestCandle = await fetchCandle(currentHourStr);

      const existing = await databases.listDocuments(
        DATABASE_ID,
        COLLECTION_ID,
        [Query.equal('date', currentHourStr), Query.limit(1)]
      );

      if (existing.total === 0) {
        log(`Processing latest available candle for ${currentHourStr}...`);
        await processCandle(currentHourStr, latestCandle);
      } else {
        log(`Latest candle for ${currentHourStr} already exists, skipping`);
      }
    } catch (err) {
      log(
        `Latest candle not yet available or incomplete for ${currentHourStr}: ${err.message}`
      );
    }

    return res.json({
      status: 'success',
      processed_until: processUntil.toISOString(),
      missing_hours_processed: missingHours.length,
      message: `Processed ${missingHours.length} missing hours`,
    });
  } catch (err) {
    error(`Unexpected error: ${err.message}`);
    return res.json({ error: `Unexpected error: ${err.message}` }, 500);
  }
}
