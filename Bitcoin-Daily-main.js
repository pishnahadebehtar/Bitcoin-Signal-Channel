import { Client, Databases, ID, Query } from 'node-appwrite';
import axios from 'axios';
import * as math from 'mathjs';

export default async function ({ req, res, log, error }) {
  try {
    const client = new Client()
      .setEndpoint(
        process.env.APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1'
      )
      .setProject(process.env.APPWRITE_PROJECT_ID)
      .setKey(process.env.APPWRITE_API_KEY);

    const databases = new Databases(client);
    const DATABASE_ID = '67c0659400092309e435';
    const COLLECTION_ID = '684b62d8000c99e18b82';

    const cryptoCompareApiKey = process.env.CRYPTOCOMPARE_API_KEY || '';
    const API_HEADERS = cryptoCompareApiKey
      ? { authorization: `Apikey ${cryptoCompareApiKey}` }
      : {};

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const processUntil = new Date(today);
    processUntil.setUTCDate(today.getUTCDate() - 1);
    const processUntilStr = processUntil.toISOString().split('T')[0];

    const latestDoc = await databases.listDocuments(
      DATABASE_ID,
      COLLECTION_ID,
      [Query.orderDesc('date'), Query.limit(1)]
    );
    let lastDate =
      latestDoc.total > 0
        ? new Date(latestDoc.documents[0].date)
        : new Date('2025-06-12');
    lastDate.setUTCHours(0, 0, 0, 0);

    const fetchCandle = async (dateStr) => {
      const targetDate = new Date(dateStr + 'T00:00:00.000Z');
      const endOfDay = new Date(targetDate);
      endOfDay.setUTCDate(targetDate.getUTCDate() + 1);
      const toTs = Math.floor(endOfDay.getTime() / 1000);

      log(
        `Fetching daily candle for ${dateStr} (ending at ${endOfDay.toISOString()})...`
      );
      try {
        const response = await axios.get(
          'https://min-api.cryptocompare.com/data/v2/histoday',
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

        const dailyData = response.data.Data.Data;
        if (!dailyData || dailyData.length === 0) {
          throw new Error(`No daily data found for ${dateStr}`);
        }

        const candle = dailyData[0];
        if (!candle) {
          throw new Error(`No candle data available for ${dateStr}`);
        }

        const candleDate = new Date(candle.time * 1000);
        const candleDateStr = candleDate.toISOString().split('T')[0];

        if (candleDateStr !== dateStr) {
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
        };
      } catch (err) {
        error(`Failed to fetch candle for ${dateStr}: ${err.message}`);

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

    const processCandle = async (dateStr, candle) => {
      const { open, high, low, close, volumeBtc } = candle;
      const existing = await databases.listDocuments(
        DATABASE_ID,
        COLLECTION_ID,
        [Query.equal('date', dateStr), Query.limit(1)]
      );
      if (existing.total > 0) {
        log(`Record for ${dateStr} already exists, skipping`);
        return;
      }
      const historical = await databases.listDocuments(
        DATABASE_ID,
        COLLECTION_ID,
        [Query.orderDesc('date'), Query.limit(150)]
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
      record['Percentage Change from 1 Day Ago'] =
        closes.length >= 2
          ? ((closes[closes.length - 1] - closes[closes.length - 2]) /
              closes[closes.length - 2]) *
            100
          : null;
      record['Percentage Change from 7 Days Ago'] =
        closes.length >= 8
          ? ((closes[closes.length - 1] - closes[closes.length - 8]) /
              closes[closes.length - 8]) *
            100
          : null;
      record['Percentage Change from 30 Days Ago'] =
        closes.length >= 31
          ? ((closes[closes.length - 1] - closes[closes.length - 31]) /
              closes[closes.length - 31]) *
            100
          : null;
      record['Percentage Change from 1 Day from now'] = null;
      record['Percentage Change from 7 Days from now'] = null;
      record['Percentage Change from 30 Days from now'] = null;
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
      record['50EMA'] = ema(closes, 50);
      record['26EMA'] = ema(closes, 26);
      record['12EMA'] = ema(closes, 12);
      record['20SMA(Middle Band)'] = sma(closes, 20);
      record['20-Period SD'] = std(closes, 20);
      record['Upper Band'] = record['20SMA(Middle Band)']
        ? record['20SMA(Middle Band)'] + 2 * record['20-Period SD']
        : null;
      record['Lower Band'] = record['20SMA(Middle Band)']
        ? record['20SMA(Middle Band)'] - 2 * record['20-Period SD']
        : null;
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
          record['MACD line'] = macdLine;
          record['MACD Signal Line'] = signalLine;
          record['MACD histogram'] = macdLine - signalLine;
        }
      }
      for (const [period, prefix] of [
        [20, '20'],
        [40, '40'],
        [60, '60'],
      ]) {
        if (data.length >= period) {
          const highs = data.map((d) => d.High).slice(-period);
          const lows = data.map((d) => d.Low).slice(-period);
          record[`last ${period} day high`] = Math.max(...highs);
          record[`last ${period} day low`] = Math.min(...lows);
          const fibLevels = [0.23, 0.38, 0.5, 0.61, 0.78];
          for (const level of fibLevels)
            record[`${prefix} DAY ${level} FIB`] =
              record[`last ${period} day low`] +
              (record[`last ${period} day high`] -
                record[`last ${period} day low`]) *
                level;
        }
      }
      record['20-Week SMA (bullmarket supportband)'] = sma(closes, 140);
      record['21-Week EMA (bullmarket supportband)'] = ema(closes, 147);
      let obv = 0;
      if (data.length > 1)
        for (let i = 1; i < data.length; i++) {
          if (data[i].Close > data[i - 1].Close) obv += data[i]['Volume BTC'];
          else if (data[i].Close < data[i - 1].Close)
            obv -= data[i]['Volume BTC'];
        }
      record.OBV = obv;
      const typicalPrices = data.map((d) => (d.High + d.Low + d.Close) / 3);
      const volumes = data.map((d) => d['Volume BTC']);
      record.VWAP =
        math.sum(volumes) > 0
          ? math.sum(typicalPrices.map((p, i) => p * volumes[i])) /
            math.sum(volumes)
          : 0;
      const trueRanges = [];
      if (data.length > 1) {
        for (let i = 1; i < data.length; i++)
          trueRanges.push(
            Math.max(
              data[i].High - data[i].Low,
              Math.abs(data[i].High - data[i - 1].Close),
              Math.abs(data[i].Low - data[i - 1].Close)
            )
          );
        record['True Range'] = trueRanges[trueRanges.length - 1];
        record.ATR = sma(trueRanges, 14);
      }
      if (data.length >= 14) {
        const last14Highs = data.map((d) => d.High).slice(-14);
        const last14Lows = data.map((d) => d.Low).slice(-14);
        const highestHigh = Math.max(...last14Highs);
        const lowestLow = Math.min(...last14Lows);
        record['%K'] = (100 * (close - lowestLow)) / (highestHigh - lowestLow);
        const kValues = [];
        for (let i = data.length - 3; i < data.length; i++) {
          if (i >= 14) {
            const h = Math.max(...data.slice(i - 14, i).map((d) => d.High));
            const l = Math.min(...data.slice(i - 14, i).map((d) => d.Low));
            kValues.push((100 * (data[i].Close - l)) / (h - l));
          }
        }
        record['%D'] = sma(kValues, 3);
      }
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
      const columnMapping = {
        date: 'Date',
        open: 'Open',
        high: 'High',
        low: 'Low',
        close: 'Close',
        volume: 'Volume BTC',
        persentage_change_from_1_day_ago: 'Percentage Change from 1 Day Ago',
        persentage_change_from_7_days_ago: 'Percentage Change from 7 Days Ago',
        persentage_change_from_30_days_ago:
          'Percentage Change from 30 Days Ago',
        persentage_change_1_day_from_now:
          'Percentage Change from 1 Day from now',
        persentage_change_7_days_from_now:
          'Percentage Change from 7 Days from now',
        persentage_change_30_days_from_now:
          'Percentage Change from 30 Days from now',
        rsi: 'RSI',
        '50_ema': '50EMA',
        '20_sma_middle_band': '20SMA(Middle Band)',
        '20_period_sd': '20-Period SD',
        upper_band: 'Upper Band',
        lower_band: 'Lower Band',
        '26_ema': '26EMA',
        '12_ema': '12EMA',
        macd_line: 'MACD line',
        macd_signal_line: 'MACD Signal Line',
        macd_histogram: 'MACD histogram',
        last_20_day_high: 'last 20 day high',
        last_20_day_low: 'last 20 day low',
        '20_day_fib_23': '20 DAY 0.23 FIB',
        '20_day_fib_38': '20 DAY 0.38 FIB',
        '20_day_fib_50': '20 DAY 0.5 FIB',
        '20_day_fib_61': '20 DAY 0.61 FIB',
        '20_day_fib_78': '20 DAY 0.78 FIB',
        last_40_day_high: 'last 40 day high',
        last_40_day_low: 'last 40 day low',
        '40_day_fib_23': '40 DAY 0.23 FIB',
        '40_day_fib_38': '40 DAY 0.38 FIB',
        '40_day_fib_50': '40 DAY 0.5 FIB',
        '40_day_fib_61': '40 DAY 0.61 FIB',
        '40_day_fib_78': '40 DAY 0.78 FIB',
        last_60_day_high: 'last 60 day high',
        last_60_day_low: 'last 60 day low',
        '60_day_fib_23': '60 DAY 0.23 FIB',
        '60_day_fib_38': '60 DAY 0.38 FIB',
        '60_day_fib_50': '60 DAY 0.5 FIB',
        '60_day_fib_61': '60 DAY 0.61 FIB',
        '60_day_fib_78': '60 DAY 0.78 FIB',
        '20_week_sma_bullmarketsupportband':
          '20-Week SMA (bullmarket supportband)',
        '21_week_ema_bullmarketsupportband':
          '21-Week EMA (bullmarket supportband)',
        bullish_fvg_exists: 'Bullish FVG Exists',
        bullish_fvg_range: 'Bullish FVG Range',
        bearish_fvg_exists: 'Bearish FVG Exists',
        bearish_fvg_range: 'Bearish FVG Range',
        obv: 'OBV',
        vwap: 'VWAP',
        true_range: 'True Range',
        atr: 'ATR',
        k_persent: '%K',
        d_persent: '%D',
      };
      const appwriteRecord = {};
      for (const [key, value] of Object.entries(columnMapping))
        appwriteRecord[key] =
          record[value] !== undefined && record[value] !== null
            ? record[value]
            : key.includes('exists')
              ? false
              : null;
      await databases.createDocument(
        DATABASE_ID,
        COLLECTION_ID,
        ID.unique(),
        appwriteRecord
      );
      log(`Inserted record for ${dateStr}`);
      for (const [daysAgo, field] of [
        [1, 'persentage_change_1_day_from_now'],
        [7, 'persentage_change_7_days_from_now'],
        [30, 'persentage_change_30_days_from_now'],
      ]) {
        const pastDate = new Date(dateStr);
        pastDate.setUTCDate(pastDate.getUTCDate() - daysAgo);
        const pastDateStr = pastDate.toISOString().split('T')[0];
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
            }
          }
        } catch (err) {
          log(
            `Warning: Failed to update ${field} for ${pastDateStr}: ${err.message}`
          );
        }
      }
    };

    const missingDates = [];
    let currentLoopDate = new Date(lastDate);
    currentLoopDate.setUTCDate(currentLoopDate.getUTCDate() + 1);

    const endDate = new Date(today);
    endDate.setUTCDate(today.getUTCDate() - 1);

    while (currentLoopDate <= endDate) {
      missingDates.push(currentLoopDate.toISOString().split('T')[0]);
      currentLoopDate.setUTCDate(currentLoopDate.getUTCDate() + 1);
    }

    if (missingDates.length > 0) {
      log(
        `Found ${missingDates.length} missing dates to process: from ${missingDates[0]} to ${missingDates[missingDates.length - 1]}`
      );

      for (const dateStr of missingDates) {
        try {
          log(`Processing ${dateStr}...`);
          const candle = await fetchCandle(dateStr);

          if (
            candle.close < candle.low ||
            candle.close > candle.high ||
            candle.volumeBtc <= 0
          ) {
            throw new Error(
              `Invalid candle data for ${dateStr}: Close ${candle.close} not between ${candle.low}-${candle.high} or volume ${candle.volumeBtc} <= 0`
            );
          }

          await processCandle(dateStr, candle);
          await new Promise((resolve) => setTimeout(resolve, 1200));
        } catch (err) {
          error(`Skipping ${dateStr} due to error: ${err.message}`);
          continue;
        }
      }
    } else {
      log('No missing dates to process. Data is up to date.');
    }

    const todayDateStr = today.toISOString().split('T')[0];
    try {
      log(`Checking for latest available candle (${todayDateStr})...`);
      const latestCandle = await fetchCandle(todayDateStr);

      const existing = await databases.listDocuments(
        DATABASE_ID,
        COLLECTION_ID,
        [Query.equal('date', todayDateStr), Query.limit(1)]
      );

      if (existing.total === 0) {
        log(`Processing latest available candle for ${todayDateStr}...`);
        await processCandle(todayDateStr, latestCandle);
      } else {
        log(`Latest candle for ${todayDateStr} already exists, skipping`);
      }
    } catch (err) {
      log(
        `Latest candle not yet available or incomplete for ${todayDateStr}: ${err.message}`
      );
    }

    return res.json({
      status: 'success',
      processed_until: processUntilStr,
      missing_dates_processed: missingDates.length,
      message: `Processed ${missingDates.length} missing dates`,
    });
  } catch (err) {
    error(`Unexpected error: ${err.message}`);
    return res.json({ error: `Unexpected error: ${err.message}` }, 500);
  }
}
