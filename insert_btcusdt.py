from appwrite.client import Client
from appwrite.services.databases import Databases
from appwrite.id import ID
import pandas as pd
import numpy as np
import time

# Appwrite setup
client = Client()
client.set_endpoint('https://cloud.appwrite.io/v1')
client.set_project('67c02889002eb0b57a52')
client.set_key('standard_517750775fee9b52072d2a46c5a5f12cdbdf016ab434ab4c899307b82df5389697d5d5441a840738010840b44358edc0b7d7fa0fb63e47bac478b302d6e1b878b54fe598929ea0a90c6c309c4b526103628e07d55775c19e82557fde02ff8c2a1abb3de698a2b2b6a5a2ec5e19754e332384eff48b36ac47745ea3b83d1a9866')

databases = Databases(client)
DATABASE_ID = '67c0659400092309e435'
COLLECTION_ID = '684b62d8000c99e18b82'
BATCH_SIZE = 100

# Read Excel
try:
    df = pd.read_excel('btcd.xlsx')  # Update to 'btcdsample.xlsx' if needed
    print(f'Loaded {len(df)} records')
except FileNotFoundError:
    print("Error: btcd.xlsx not found. Place it in E:\\btcsignal or update the path.")
    exit()

# Fix ERROR:#REF! and invalid values
df.replace('ERROR:#REF!', np.nan, inplace=True)

# Recalculate OBV
df['OBV'] = 0.0
df.loc[df.index[-1], 'OBV'] = df.loc[df.index[-1], 'Volume BTC']
for i in range(len(df)-2, -1, -1):
    if df.loc[i, 'Close'] > df.loc[i+1, 'Close']:
        df.loc[i, 'OBV'] = df.loc[i+1, 'OBV'] + df.loc[i, 'Volume BTC']
    elif df.loc[i, 'Close'] < df.loc[i+1, 'Close']:
        df.loc[i, 'OBV'] = df.loc[i+1, 'OBV'] - df.loc[i, 'Volume BTC']
    else:
        df.loc[i, 'OBV'] = df.loc[i+1, 'OBV']

# Recalculate ATR
df['True Range'] = np.maximum(
    df['High'] - df['Low'],
    np.maximum(
        abs(df['High'] - df['Close'].shift(1)),
        abs(df['Low'] - df['Close'].shift(1))
    )
)
df['ATR'] = df['True Range'].rolling(14).mean()

# Reverse DataFrame to insert oldest first (row N → row 2)
df = df.iloc[::-1].reset_index(drop=True)
print('DataFrame reversed for insertion')

# Column mapping
column_mapping = {
    'date': 'Date',
    'open': 'Open',
    'high': 'High',
    'low': 'Low',
    'close': 'Close',
    'volume': 'Volume BTC',
    'persentage_change_from_1_day_ago': 'Percentage Change from 1 Day Ago',
    'persentage_change_from_7_days_ago': 'Percentage Change from 7 Days Ago',
    'persentage_change_from_30_days_ago': 'Percentage Change from 30 Days Ago',
    'persentage_change_1_day_from_now': 'Percentage Change from 1 Day from now',
    'persentage_change_7_days_from_now': 'Percentage Change from 7 Days from now',
    'persentage_change_30_days_from_now': 'Percentage Change from 30 Days from now',
    'gains': 'Gains',
    'losses': 'Losses',
    'average_gains': 'Average Gains',
    'average_losses': 'Average Losses',
    'rsi': 'RSI',
    '50_ema': '50EMA',
    '20_sma_middle_band': '20SMA(Middle Band)',
    '20_period_sd': '20-Period SD',
    'upper_band': 'Upper Band',
    'lower_band': 'Lower Band',
    '26_ema': '26EMA',
    '12_ema': '12EMA',
    'macd_line': 'MACD line',
    'macd_signal_line': 'MACD Signal Line',
    'macd_histogram': 'MACD histogram',
    'last_20_day_high': 'last 20 day high',
    'last_20_day_low': 'last 20 day low',
    '20_day_fib_23': '20 DAY 0.23 FIB',
    '20_day_fib_38': '20 DAY 0.38 FIB',
    '20_day_fib_50': '20 DAY 0.5 FIB',
    '20_day_fib_61': '20 DAY 0.61 FIB',
    '20_day_fib_78': '20 DAY 0.78 FIB',
    'last_40_day_high': 'Last 40 day high',
    'last_40_day_low': 'Last 40 day low',
    '40_day_fib_23': '40 DAY 0.23 FIB',
    '40_day_fib_38': '40 DAY 0.38 FIB',
    '40_day_fib_50': '40 DAY 0.5 FIB',
    '40_day_fib_61': '40 DAY 0.61 FIB',
    '40_day_fib_78': '40 DAY 0.78 FIB',
    'last_60_day_high': 'last 60 day high',
    'last_60_day_low': 'last 60 day low',
    '60_day_fib_23': '60 DAY 0.23 FIB',
    '60_day_fib_38': '60 DAY 0.38 FIB',
    '60_day_fib_50': '60 DAY 0.5 FIB',
    '60_day_fib_61': '60 DAY 0.61 FIB',
    '60_day_fib_78': '60 DAY 0.78 FIB',
    '20_week_sma_bullmarketsupportband': '20-Week SMA (bullmarket supportband)',
    '21_week_ema_bullmarketsupportband': '21-Week EMA (bullmarket supportband)',
    'bullish_fvg_exists': 'Bullish FVG Exists',
    'bullish_fvg_range': 'Bullish FVG Range',
    'bearish_fvg_exists': 'Bearish FVG Exists',
    'bearish_fvg_range': 'Bearish FVG Range',
    'obv': 'OBV',
    'vwap': 'VWAP',
    'true_range': 'True Range',
    'atr': 'ATR',
    'k_persent': '%K',
    'd_persent': '%D'
}

# Map columns to attributes
records = []
for _, row in df.iterrows():
    record = {}
    for appwrite_key, excel_col in column_mapping.items():
        if excel_col in row and pd.notna(row[excel_col]):
            if appwrite_key in ['bullish_fvg_exists', 'bearish_fvg_exists']:
                record[appwrite_key] = bool(row[excel_col])
            elif appwrite_key in ['date', 'bullish_fvg_range', 'bearish_fvg_range']:
                record[appwrite_key] = str(row[excel_col])
            else:
                try:
                    record[appwrite_key] = float(row[excel_col])
                except (ValueError, TypeError):
                    print(f"Warning: Invalid float value in {excel_col} at row {row.name}. Setting to None.")
                    record[appwrite_key] = None
        else:
            record[appwrite_key] = None if appwrite_key in [
                'persentage_change_1_day_from_now',
                'persentage_change_7_days_from_now',
                'persentage_change_30_days_from_now',
                'bullish_fvg_range',
                'bearish_fvg_range'
            ] else False if appwrite_key in ['bullish_fvg_exists', 'bearish_fvg_exists'] else None
    records.append(record)

# Insert in batches
for i in range(0, len(records), BATCH_SIZE):
    batch = records[i:i + BATCH_SIZE]
    print(f'Inserting batch {i // BATCH_SIZE + 1} ({len(batch)} records)')
    
    for record in batch:
        try:
            databases.create_document(
                database_id=DATABASE_ID,
                collection_id=COLLECTION_ID,
                document_id=ID.unique(),
                data=record
            )
        except Exception as e:
            print(f'Error inserting record: {e}')
    
    # Delay to avoid rate limits
    time.sleep(1)

print('Insertion complete')

# Verify document count
try:
    response = databases.list_documents(database_id=DATABASE_ID, collection_id=COLLECTION_ID)
    print(f'Total documents in collection: {response["total"]}')
except Exception as e:
    print(f'Error verifying documents: {e}')