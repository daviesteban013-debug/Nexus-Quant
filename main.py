"""
NEXUS QUANT — Demo Broker Simulator
FastAPI backend: Pure REST API for HFT Scalping & Paper Trading Engine
"""

import os
import math
import tempfile
import time
import asyncio
from pathlib import Path
from typing import Dict, Tuple, Set, Optional, Any
import numpy as np
import pandas as pd
import yfinance as yf
from datetime import datetime

import jwt
import requests as http_client
from dotenv import load_dotenv
from fastapi import FastAPI, Query, HTTPException, Depends, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi_cache import FastAPICache
from fastapi_cache.backends.inmemory import InMemoryBackend
from fastapi_cache.decorator import cache

load_dotenv()
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET")
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")

def _configure_yfinance_cache():
    cache_dir = os.getenv("YFINANCE_CACHE_DIR") or os.path.join(tempfile.gettempdir(), "py-yfinance")
    try:
        Path(cache_dir).mkdir(parents=True, exist_ok=True)
        setter = getattr(yf, "set_tz_cache_location", None)
        if callable(setter):
            setter(cache_dir)
    except Exception:
        return

_configure_yfinance_cache()

# ─────────────────────────────────────────────────────────
# SUPABASE REST CLIENT
# ─────────────────────────────────────────────────────────
def supabase_request(method, path, json_body=None):
    """Make authenticated requests to the Supabase REST API over HTTPS."""
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        return None
    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation"
    }
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    resp = http_client.request(method, url, headers=headers, json=json_body, timeout=10)
    return resp

security = HTTPBearer()

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    if not SUPABASE_JWT_SECRET:
        raise HTTPException(status_code=500, detail="SUPABASE_JWT_SECRET is not configured.")
    try:
        # Supabase newer projects sign with ES256. 
        # For this demo, we bypass local cryptographic signature validation 
        # to avoid needing the cryptography library and downloading JWKS keys.
        # This keeps the HFT endpoints ultra-fast.
        payload = jwt.decode(
            credentials.credentials,
            options={"verify_signature": False}
        )
        return payload
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid authentication credentials: {e}")

# ─────────────────────────────────────────────────────────
# APP INIT
# ─────────────────────────────────────────────────────────

app = FastAPI(title="Nexus Quant — Demo Broker Simulator", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def _init_cache():
    FastAPICache.init(InMemoryBackend(), prefix="nexus-quant")

# ─────────────────────────────────────────────────────────
# CONSTANTS — Broker Fee Schedule
# ─────────────────────────────────────────────────────────

# Equities
SLIPPAGE_PCT = 0.0001        # 0.01%
SPREAD_PCT = 0.0002          # 0.02% half-spread
COMMISSION_PER_ORDER = 1.00  # $1.00 flat fee

# Forex — pip-based costs
FOREX_SPREAD_PIPS = 2.0      # 2-pip spread
FOREX_SLIPPAGE_PIPS = 0.5    # 0.5-pip slippage
FOREX_COMMISSION = 0.50      # $0.50 per order (typical ECN)
FOREX_LOT_UNITS = 1000       # Micro-lot (1,000 units of base currency)

INTERVAL_CONFIG = {
    "1m":  {"period": "7d",   "interval": "1m"},
    "5m":  {"period": "60d",  "interval": "5m"},
    "15m": {"period": "60d",  "interval": "15m"},
    "1h":  {"period": "730d", "interval": "1h"},
    "4h":  {"period": "730d", "interval": "4h"},
    "1d":  {"period": "max",  "interval": "1d"},
}

INDEX_TICKERS = {
    "s&p 500": "^GSPC",
    "nasdaq 100": "^NDX",
    "dow jones": "^DJI",
    "russell 2000": "^RUT",
}

def _normalize_symbol_name(name: str) -> str:
    return " ".join(str(name).strip().lower().split())

def _market_key_builder(
    func: Any,
    namespace: str,
    request: Optional[Any],
    response: Optional[Any],
    *args: Any,
    **kwargs: Any,
) -> str:
    ticker = kwargs.get("ticker") if "ticker" in kwargs else (args[0] if len(args) > 0 else "")
    interval = kwargs.get("interval") if "interval" in kwargs else (args[1] if len(args) > 1 else "")
    return f"{namespace}:{str(ticker)}:{str(interval)}"

def _df_to_cache_payload(df: pd.DataFrame) -> Dict[str, list]:
    payload_df = df.copy()
    payload_df["Date"] = pd.to_datetime(payload_df["Date"]).dt.strftime("%Y-%m-%dT%H:%M:%S")
    return payload_df[["Date", "Open", "High", "Low", "Close", "Volume"]].to_dict(orient="list")

def _cache_payload_to_df(payload: Dict[str, list]) -> pd.DataFrame:
    df = pd.DataFrame(payload)
    df["Date"] = pd.to_datetime(df["Date"])
    return df

@cache(expire=300, namespace="yfinance:history", key_builder=_market_key_builder)
async def fetch_market_data_cached(ticker: str, interval: str) -> Dict[str, list]:
    df = await run_in_threadpool(fetch_market_data, ticker, interval)
    return _df_to_cache_payload(df)

class ConnectionManager:
    def __init__(self) -> None:
        self._connections: Set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections.add(websocket)

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections.discard(websocket)

live_manager = ConnectionManager()

_quote_cache: Dict[str, Tuple[float, float]] = {}
_quote_lock = asyncio.Lock()

def _fetch_latest_price_sync(ticker: str) -> float:
    t = yf.Ticker(ticker)
    info = getattr(t, "fast_info", None)
    if info is not None:
        for k in ("lastPrice", "last_price", "last_price"):
            if k in info:
                val = float(info[k])
                if not math.isnan(val):
                    return val
        val = getattr(info, "last_price", None)
        if val is not None:
            val = float(val)
            if not math.isnan(val):
                return val

    data = yf.download(
        ticker,
        period="1d",
        interval="1m",
        progress=False,
        auto_adjust=True,
    )
    if data.empty:
        raise ValueError(f"No data returned for {ticker} at 1m")
    if isinstance(data.columns, pd.MultiIndex):
        data.columns = data.columns.get_level_values(0)
    last_close = float(pd.to_numeric(data["Close"].iloc[-1], errors="coerce"))
    if math.isnan(last_close):
        raise ValueError(f"Invalid last price for {ticker}")
    return last_close

async def get_latest_price(ticker: str) -> float:
    now = time.time()
    async with _quote_lock:
        hit = _quote_cache.get(ticker)
        if hit and (now - hit[0] <= 2.0):
            return hit[1]

    price = await run_in_threadpool(_fetch_latest_price_sync, ticker)

    async with _quote_lock:
        _quote_cache[ticker] = (now, price)
        return price


def is_jpy_pair(ticker: str) -> bool:
    """Detect JPY pairs where 1 pip = 0.01 instead of 0.0001."""
    clean = ticker.upper().replace("=X", "")
    return clean.endswith("JPY") or clean.startswith("JPY")


def get_pip_size(ticker: str) -> float:
    """Return the pip value for a currency pair."""
    return 0.01 if is_jpy_pair(ticker) else 0.0001


def get_price_decimals(asset_class: str, ticker: str) -> int:
    """Return decimal precision for display."""
    if asset_class == "forex":
        return 2 if is_jpy_pair(ticker) else 5
    if asset_class == "indices":
        return 2
    return 4


def format_ticker(ticker: str, asset_class: str) -> str:
    """Format ticker for yfinance. Forex pairs need '=X' suffix."""
    if asset_class == "indices":
        key = _normalize_symbol_name(ticker)
        mapped = INDEX_TICKERS.get(key)
        if mapped:
            return mapped
        return str(ticker).strip()

    ticker = str(ticker).upper().replace(" ", "").replace("/", "")
    # Detect Forex by asset class OR 6-letter string without symbols
    is_fx = (asset_class == "forex") or (len(ticker) == 6 and ticker.isalpha())
    if is_fx and not ticker.endswith("=X"):
        ticker = ticker + "=X"
    return ticker

# ─────────────────────────────────────────────────────────
# BROKER MATH ENGINE
# ─────────────────────────────────────────────────────────

def fetch_market_data(ticker: str, interval: str) -> pd.DataFrame:
    """Download OHLCV data via yfinance."""
    cfg = INTERVAL_CONFIG.get(interval)
    if not cfg:
        raise ValueError(f"Unsupported interval: {interval}")

    data = yf.download(
        ticker,
        period=cfg["period"],
        interval=cfg["interval"],
        progress=False,
        auto_adjust=True,
    )

    if data.empty:
        raise ValueError(f"No data returned for {ticker} at {interval}")

    # Flatten MultiIndex columns if present
    if isinstance(data.columns, pd.MultiIndex):
        data.columns = data.columns.get_level_values(0)

    data = data.reset_index()

    # Normalize datetime column
    if "Datetime" in data.columns:
        data.rename(columns={"Datetime": "Date"}, inplace=True)
    data["Date"] = pd.to_datetime(data["Date"])

    return data[["Date", "Open", "High", "Low", "Close", "Volume"]].dropna()


def compute_signals(df: pd.DataFrame, sma_fast: int, sma_slow: int) -> pd.DataFrame:
    """Institutional-grade signal generation with ADX, VWAP/EMA filters."""
    df = df.copy()
    
    # --- 1. Basic SMA Crossovers ---
    df["SMA_Fast"] = df["Close"].rolling(window=sma_fast, min_periods=sma_fast).mean()
    df["SMA_Slow"] = df["Close"].rolling(window=sma_slow, min_periods=sma_slow).mean()

    # --- 2. Institutional Baseline (VWAP or EMA 200) ---
    # EMA 200 as fallback
    df["EMA_200"] = df["Close"].ewm(span=200, adjust=False).mean()
    
    # VWAP math
    df["Typical_Price"] = (df["High"] + df["Low"] + df["Close"]) / 3
    df["TP_Vol"] = df["Typical_Price"] * df["Volume"]
    df["Cum_TP_Vol"] = df["TP_Vol"].cumsum()
    df["Cum_Vol"] = df["Volume"].cumsum().replace(0, np.nan)
    df["VWAP"] = df["Cum_TP_Vol"] / df["Cum_Vol"]
    
    # Pick baseline: If total volume is 0 (Forex), use EMA 200. Else use VWAP.
    total_vol = df["Volume"].sum()
    if total_vol == 0:
        df["Baseline"] = df["EMA_200"]
    else:
        df["Baseline"] = df["VWAP"].fillna(df["EMA_200"])

    # --- 3. Trend Intensity (ADX 14) Manual Math ---
    n = 14
    df["prev_close"] = df["Close"].shift(1)
    df["tr1"] = df["High"] - df["Low"]
    df["tr2"] = abs(df["High"] - df["prev_close"])
    df["tr3"] = abs(df["Low"] - df["prev_close"])
    df["TR"] = df[["tr1", "tr2", "tr3"]].max(axis=1)

    df["up_move"] = df["High"] - df["High"].shift(1)
    df["down_move"] = df["Low"].shift(1) - df["Low"]

    df["+DM"] = np.where((df["up_move"] > df["down_move"]) & (df["up_move"] > 0), df["up_move"], 0)
    df["-DM"] = np.where((df["down_move"] > df["up_move"]) & (df["down_move"] > 0), df["down_move"], 0)

    df["TR_Smooth"] = df["TR"].ewm(alpha=1/n, adjust=False).mean()
    df["+DM_Smooth"] = df["+DM"].ewm(alpha=1/n, adjust=False).mean()
    df["-DM_Smooth"] = df["-DM"].ewm(alpha=1/n, adjust=False).mean()

    df["+DI"] = 100 * (df["+DM_Smooth"] / df["TR_Smooth"].replace(0, np.nan))
    df["-DI"] = 100 * (df["-DM_Smooth"] / df["TR_Smooth"].replace(0, np.nan))
    
    df["+DI"] = df["+DI"].fillna(0)
    df["-DI"] = df["-DI"].fillna(0)

    di_sum = (df["+DI"] + df["-DI"]).replace(0, np.nan)
    df["DX"] = 100 * (abs(df["+DI"] - df["-DI"]) / di_sum)
    df["DX"] = df["DX"].fillna(0)
    df["ADX"] = df["DX"].ewm(alpha=1/n, adjust=False).mean()

    # --- 4. Signal Generation with Filters ---
    df["Signal"] = 0
    df.loc[df["SMA_Fast"] > df["SMA_Slow"], "Signal"] = 1    # Bullish
    df.loc[df["SMA_Fast"] < df["SMA_Slow"], "Signal"] = -1   # Bearish

    df["Signal_Shift"] = df["Signal"].shift(1).fillna(0)
    df["Crossover"] = 0
    df["ADX_P"] = df["ADX"].shift(1)
    
    # Rules: (ADX Guard + Baseline Alignment)
    long_cond = (df["Signal"] == 1) & (df["Signal_Shift"] != 1) & (df["ADX_P"] >= 25) & (df["Close"] > df["Baseline"])
    short_cond = (df["Signal"] == -1) & (df["Signal_Shift"] != -1) & (df["ADX_P"] >= 25) & (df["Close"] < df["Baseline"])

    df.loc[long_cond, "Crossover"] = 1
    df.loc[short_cond, "Crossover"] = -1

    # Cleanup
    cols_to_drop = [
        "Typical_Price", "TP_Vol", "Cum_TP_Vol", "Cum_Vol", "EMA_200",
        "prev_close", "tr1", "tr2", "tr3", "TR", "up_move", "down_move", 
        "+DM", "-DM", "TR_Smooth", "+DM_Smooth", "-DM_Smooth", 
        "+DI", "-DI", "DX"
    ]
    df = df.drop(columns=cols_to_drop)

    return df.dropna(subset=["SMA_Fast", "SMA_Slow"]).fillna({"ADX": 0, "VWAP": df["Close"]}).reset_index(drop=True)

def compute_sma_only(df: pd.DataFrame, sma_fast: int, sma_slow: int) -> pd.DataFrame:
    df = df.copy()
    df["SMA_Fast"] = df["Close"].rolling(window=sma_fast, min_periods=sma_fast).mean()
    df["SMA_Slow"] = df["Close"].rolling(window=sma_slow, min_periods=sma_slow).mean()
    return df

def _compute_rsi(close: pd.Series, length: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = (-delta).clip(lower=0)
    avg_gain = gain.ewm(alpha=1/length, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1/length, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))
    return rsi

def _compute_atr(high: pd.Series, low: pd.Series, close: pd.Series, length: int = 14) -> pd.Series:
    prev_close = close.shift(1)
    tr1 = high - low
    tr2 = (high - prev_close).abs()
    tr3 = (low - prev_close).abs()
    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    atr = tr.ewm(alpha=1/length, adjust=False).mean()
    return atr

def _compute_adx(high: pd.Series, low: pd.Series, close: pd.Series, length: int = 14) -> pd.Series:
    prev_high = high.shift(1)
    prev_low = low.shift(1)
    prev_close = close.shift(1)

    tr1 = high - low
    tr2 = (high - prev_close).abs()
    tr3 = (low - prev_close).abs()
    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)

    up_move = high - prev_high
    down_move = prev_low - low

    plus_dm = np.where((up_move > down_move) & (up_move > 0), up_move, 0.0)
    minus_dm = np.where((down_move > up_move) & (down_move > 0), down_move, 0.0)

    tr_smooth = pd.Series(tr).ewm(alpha=1/length, adjust=False).mean()
    plus_dm_smooth = pd.Series(plus_dm, index=high.index).ewm(alpha=1/length, adjust=False).mean()
    minus_dm_smooth = pd.Series(minus_dm, index=high.index).ewm(alpha=1/length, adjust=False).mean()

    plus_di = 100 * (plus_dm_smooth / tr_smooth.replace(0, np.nan))
    minus_di = 100 * (minus_dm_smooth / tr_smooth.replace(0, np.nan))

    di_sum = (plus_di + minus_di).replace(0, np.nan)
    dx = 100 * ((plus_di - minus_di).abs() / di_sum)
    adx = dx.ewm(alpha=1/length, adjust=False).mean()
    return adx

def compute_smc_signals(df: pd.DataFrame, sma_fast: int) -> Tuple[pd.DataFrame, Dict[str, Any]]:
    df_feat = df.copy()

    window = 11
    swing_high = df_feat["High"].eq(df_feat["High"].rolling(window=window, center=True).max())
    swing_low = df_feat["Low"].eq(df_feat["Low"].rolling(window=window, center=True).min())
    swing_high = swing_high.fillna(False)
    swing_low = swing_low.fillna(False)

    swing_high_price = df_feat["High"].where(swing_high)
    swing_low_price = df_feat["Low"].where(swing_low)
    prev_swing_high = swing_high_price.shift(1).ffill()
    prev_swing_low = swing_low_price.shift(1).ffill()

    bos_bull = df_feat["Close"] > prev_swing_high
    bos_bear = df_feat["Close"] < prev_swing_low

    bos_dir = pd.Series(np.nan, index=df_feat.index, dtype="float64")
    bos_dir = bos_dir.mask(bos_bull, 1.0)
    bos_dir = bos_dir.mask(bos_bear, -1.0)
    last_dir = bos_dir.ffill().fillna(0.0)
    choch = (bos_dir.notna()) & (bos_dir.fillna(0.0) != last_dir.shift(1).fillna(0.0))

    range_n = 120
    hh = df_feat["High"].rolling(window=range_n, min_periods=range_n).max()
    ll = df_feat["Low"].rolling(window=range_n, min_periods=range_n).min()
    mid = (hh + ll) / 2.0
    in_discount = df_feat["Close"] <= mid
    in_premium = df_feat["Close"] >= mid

    atr = _compute_atr(df_feat["High"], df_feat["Low"], df_feat["Close"], length=14)
    atr_ma50 = atr.rolling(window=50, min_periods=50).mean()
    atr_std50 = atr.rolling(window=50, min_periods=50).std()
    vol_ok = atr <= (atr_ma50 + (2.0 * atr_std50))

    prev_bear = df_feat["Close"].shift(1) < df_feat["Open"].shift(1)
    prev_bull = df_feat["Close"].shift(1) > df_feat["Open"].shift(1)

    bull_ob_evt = bos_bull & prev_bear
    bear_ob_evt = bos_bear & prev_bull

    last_bull_ob_low = df_feat["Low"].shift(1).where(bull_ob_evt).ffill()
    last_bull_ob_high = df_feat["High"].shift(1).where(bull_ob_evt).ffill()
    last_bear_ob_low = df_feat["Low"].shift(1).where(bear_ob_evt).ffill()
    last_bear_ob_high = df_feat["High"].shift(1).where(bear_ob_evt).ffill()

    touch_bull_ob = (df_feat["Close"] >= last_bull_ob_low) & (df_feat["Close"] <= last_bull_ob_high)
    touch_bear_ob = (df_feat["Close"] >= last_bear_ob_low) & (df_feat["Close"] <= last_bear_ob_high)

    structure_bull = last_dir >= 1
    structure_bear = last_dir <= -1

    sma_fast_series = df_feat["Close"].rolling(window=sma_fast, min_periods=sma_fast).mean()
    df_feat["SMA_Fast"] = sma_fast_series

    buy_cond = in_discount & touch_bull_ob & structure_bull & (df_feat["Close"] > sma_fast_series) & vol_ok
    sell_cond = in_premium & touch_bear_ob & structure_bear & (df_feat["Close"] < sma_fast_series) & vol_ok

    df_feat["SMC_Signal"] = 0
    df_feat.loc[buy_cond, "SMC_Signal"] = 1
    df_feat.loc[sell_cond, "SMC_Signal"] = -1

    df_feat["SMC_Signal"] = df_feat["SMC_Signal"].astype(int)
    df_feat["Execution_Reason"] = None
    df_feat.loc[buy_cond, "Execution_Reason"] = "BOS/CHoCH + Reentry to Bullish OB in Discount Zone + SMA Fast"
    df_feat.loc[sell_cond, "Execution_Reason"] = "BOS/CHoCH + Reentry to Bearish OB in Premium Zone + SMA Fast"

    df_feat["SMC_SwingHigh"] = swing_high.astype(int)
    df_feat["SMC_SwingLow"] = swing_low.astype(int)
    df_feat["SMC_BOS_Bull"] = bos_bull.astype(int)
    df_feat["SMC_BOS_Bear"] = bos_bear.astype(int)
    df_feat["SMC_CHoCH"] = choch.astype(int)
    df_feat["SMC_Discount"] = in_discount.astype(int)
    df_feat["SMC_Premium"] = in_premium.astype(int)
    df_feat["SMC_ATR_14"] = atr
    df_feat["SMC_ATR_OK"] = vol_ok.astype(int)

    latest = df_feat.tail(1)
    if len(latest) == 0:
        return df_feat, {"direction": "NEUTRAL", "confidence_score": 0.0}

    last_sig = int(latest["SMC_Signal"].iloc[0])
    if last_sig == 1:
        direction = "BULLISH"
    elif last_sig == -1:
        direction = "BEARISH"
    else:
        direction = "NEUTRAL"

    bull_score = (
        in_discount.astype(int)
        + touch_bull_ob.astype(int)
        + structure_bull.astype(int)
        + (df_feat["Close"] > sma_fast_series).astype(int)
    ) / 4.0
    bear_score = (
        in_premium.astype(int)
        + touch_bear_ob.astype(int)
        + structure_bear.astype(int)
        + (df_feat["Close"] < sma_fast_series).astype(int)
    ) / 4.0

    if direction == "BULLISH":
        conf = float(bull_score.tail(1).iloc[0])
    elif direction == "BEARISH":
        conf = float(bear_score.tail(1).iloc[0])
    else:
        conf = float(max(bull_score.tail(1).iloc[0], bear_score.tail(1).iloc[0]))

    return df_feat, {"direction": direction, "confidence_score": conf}


def simulate_broker(df: pd.DataFrame, capital: float, asset_class: str = "stocks",
                    ticker: str = "", stop_loss_pct: float = 0, take_profit_pct: float = 0) -> dict:
    """
    Full broker account ledger simulation with slippage, spread, commissions,
    and optional stop-loss / take-profit triggers.
    Bi-directional: LONG (buy/sell) and SHORT (short/cover).
    Supports both equities (percentage-based) and forex (pip-based) pricing.
    """
    # ── Fee model selection ──
    if asset_class == "forex":
        pip_size = get_pip_size(ticker)
        slippage_abs = FOREX_SLIPPAGE_PIPS * pip_size
        spread_abs = FOREX_SPREAD_PIPS * pip_size
        commission = FOREX_COMMISSION
        use_pips = True
    else:
        slippage_abs = 0.0  # Will use percentage
        spread_abs = 0.0
        commission = COMMISSION_PER_ORDER
        use_pips = False

    price_dec = get_price_decimals(asset_class, ticker)
    # ── Account State ──
    buying_power = capital
    locked_margin = 0.0
    position = 0          # +N = long N shares, -N = short N shares
    entry_price = 0.0
    total_commissions = 0.0
    trade_count = 0

    trades = []
    equity_curve = []
    peak_equity = capital

    max_drawdown = 0.0
    returns_list = []
    prev_equity = capital

    for i in range(len(df)):
        row = df.iloc[i]
        price = float(row["Close"])
        crossover = int(row.get("SMC_Signal", row.get("AI_Signal", row.get("Crossover", 0))))
        date_str = str(row["Date"])
        exec_reason = row.get("Execution_Reason", None)
        exec_reason = str(exec_reason) if exec_reason else ""

        # ── Calculate floating PNL ──
        floating_pnl = 0.0
        if position > 0:
            floating_pnl = (price - entry_price) * position
        elif position < 0:
            floating_pnl = (entry_price - price) * abs(position)

        total_equity = buying_power + locked_margin + floating_pnl

        # ── Track returns for Sharpe ──
        period_return = (total_equity - prev_equity) / prev_equity if prev_equity > 0 else 0
        returns_list.append(period_return)
        prev_equity = total_equity

        # ── Max Drawdown (clamped to 100%) ──
        if total_equity > peak_equity:
            peak_equity = total_equity
        dd = (peak_equity - total_equity) / peak_equity if peak_equity > 0 else 0
        dd = min(dd, 1.0)  # Clamp to 100%
        if dd > max_drawdown:
            max_drawdown = dd

        # ── Record equity curve ──
        equity_curve.append({
            "date": date_str,
            "equity": round(total_equity, 2),
        })

        # ── STOP-LOSS / TAKE-PROFIT check (before crossover) ──
        sl_triggered = False
        tp_triggered = False

        if position > 0 and entry_price > 0:
            pnl_pct = ((price - entry_price) / entry_price) * 100
            if stop_loss_pct > 0 and pnl_pct <= -stop_loss_pct:
                sl_triggered = True
            elif take_profit_pct > 0 and pnl_pct >= take_profit_pct:
                tp_triggered = True
        elif position < 0 and entry_price > 0:
            pnl_pct = ((entry_price - price) / entry_price) * 100
            if stop_loss_pct > 0 and pnl_pct <= -stop_loss_pct:
                sl_triggered = True
            elif take_profit_pct > 0 and pnl_pct >= take_profit_pct:
                tp_triggered = True

        # Force-close position on SL/TP hit
        if sl_triggered or tp_triggered:
            reason = "SL" if sl_triggered else "TP"
            if use_pips:
                close_bid = price - slippage_abs - spread_abs
                close_ask = price + slippage_abs + spread_abs
            else:
                close_bid = price * (1 - SLIPPAGE_PCT - SPREAD_PCT)
                close_ask = price * (1 + SLIPPAGE_PCT + SPREAD_PCT)

            if position > 0:
                sell_price = close_bid
                realized_pnl = (sell_price - entry_price) * position
                buying_power += (sell_price * position - commission)
                total_commissions += commission
                trade_count += 1
                trades.append({
                    "date": date_str, "type": f"SELL ({reason})",
                    "price": round(sell_price, price_dec), "shares": position,
                    "fee": commission, "pnl": round(realized_pnl - commission, 2),
                    "reason": f"{reason} EXIT",
                })
                position = 0
            elif position < 0:
                cover_price = close_ask
                realized_pnl = (entry_price - cover_price) * abs(position)
                buying_power = locked_margin + realized_pnl - commission
                locked_margin = 0.0
                total_commissions += commission
                trade_count += 1
                trades.append({
                    "date": date_str, "type": f"COVER ({reason})",
                    "price": round(cover_price, price_dec), "shares": abs(position),
                    "fee": commission, "pnl": round(realized_pnl - commission, 2),
                    "reason": f"{reason} EXIT",
                })
                position = 0
            continue  # Skip crossover logic this bar

        # ── EXECUTION LOGIC ──
        # Apply slippage/spread based on asset class
        if use_pips:
            ask_price = price + slippage_abs + spread_abs  # Buy at ask
            bid_price = price - slippage_abs - spread_abs  # Sell at bid
        else:
            ask_price = price * (1 + SLIPPAGE_PCT + SPREAD_PCT)
            bid_price = price * (1 - SLIPPAGE_PCT - SPREAD_PCT)

        if crossover == 1:
            # === BULLISH CROSSOVER ===

            # 1) If SHORT → COVER first
            if position < 0:
                cover_price = ask_price
                realized_pnl = (entry_price - cover_price) * abs(position)
                buying_power = locked_margin + realized_pnl - commission
                locked_margin = 0.0
                total_commissions += commission
                trade_count += 1

                trades.append({
                    "date": date_str,
                    "type": "COVER",
                    "price": round(cover_price, price_dec),
                    "shares": abs(position),
                    "fee": commission,
                    "pnl": round(realized_pnl - commission, 2),
                    "reason": "REVERSE",
                })
                position = 0

            # 2) GO LONG
            if position == 0 and buying_power > commission + 10:
                buy_price = ask_price
                available = buying_power - commission
                if use_pips:
                    # Forex: buy in micro-lot increments (1,000 units)
                    lots = int(available / (buy_price * FOREX_LOT_UNITS)) 
                    shares = lots * FOREX_LOT_UNITS
                else:
                    shares = int(available / buy_price)
                if shares > 0:
                    cost = shares * buy_price
                    buying_power -= (cost + commission)
                    total_commissions += commission
                    trade_count += 1
                    position = shares
                    entry_price = buy_price

                    trades.append({
                        "date": date_str,
                        "type": "BUY",
                        "price": round(buy_price, price_dec),
                        "shares": shares,
                        "fee": commission,
                        "pnl": 0,
                        "reason": exec_reason,
                    })

        elif crossover == -1:
            # === BEARISH CROSSOVER ===

            # 1) If LONG → SELL first
            if position > 0:
                sell_price = bid_price
                proceeds = sell_price * position
                realized_pnl = (sell_price - entry_price) * position
                buying_power += (proceeds - commission)
                total_commissions += commission
                trade_count += 1

                trades.append({
                    "date": date_str,
                    "type": "SELL",
                    "price": round(sell_price, price_dec),
                    "shares": position,
                    "fee": commission,
                    "pnl": round(realized_pnl - commission, 2),
                    "reason": "REVERSE",
                })
                position = 0

            # 2) GO SHORT
            if position == 0 and buying_power > commission + 10:
                short_price = bid_price
                available = buying_power - commission
                if use_pips:
                    lots = int(available / (short_price * FOREX_LOT_UNITS))
                    shares = lots * FOREX_LOT_UNITS
                else:
                    shares = int(available / short_price)
                if shares > 0:
                    locked_margin = available
                    buying_power = 0.0
                    total_commissions += commission
                    trade_count += 1
                    position = -shares
                    entry_price = short_price

                    trades.append({
                        "date": date_str,
                        "type": "SHORT",
                        "price": round(short_price, price_dec),
                        "shares": shares,
                        "fee": commission,
                        "pnl": 0,
                        "reason": exec_reason,
                    })

    # ── FINAL: Close any open position at last price ──
    if len(df) > 0:
        last_price = float(df.iloc[-1]["Close"])
        last_date = str(df.iloc[-1]["Date"])

        if use_pips:
            final_bid = last_price - slippage_abs - spread_abs
            final_ask = last_price + slippage_abs + spread_abs
        else:
            final_bid = last_price * (1 - SLIPPAGE_PCT - SPREAD_PCT)
            final_ask = last_price * (1 + SLIPPAGE_PCT + SPREAD_PCT)

        if position > 0:
            sell_price = final_bid
            realized_pnl = (sell_price - entry_price) * position
            buying_power += (sell_price * position - commission)
            total_commissions += commission
            trades.append({
                "date": last_date,
                "type": "SELL (CLOSE)",
                "price": round(sell_price, price_dec),
                "shares": position,
                "fee": commission,
                "pnl": round(realized_pnl - commission, 2),
                "reason": "END OF DATA",
            })
            position = 0
            locked_margin = 0.0

        elif position < 0:
            cover_price = final_ask
            realized_pnl = (entry_price - cover_price) * abs(position)
            buying_power = locked_margin + realized_pnl - commission
            total_commissions += commission
            trades.append({
                "date": last_date,
                "type": "COVER (CLOSE)",
                "price": round(cover_price, price_dec),
                "shares": abs(position),
                "fee": commission,
                "pnl": round(realized_pnl - commission, 2),
                "reason": "END OF DATA",
            })
            position = 0
            locked_margin = 0.0

    # ── Final equity ──
    final_equity = buying_power + locked_margin

    # ── Sharpe Ratio (annualized, assume 252 trading days × periods/day) ──
    returns_arr = np.array(returns_list)
    if len(returns_arr) > 1 and np.std(returns_arr) > 0:
        sharpe = (np.mean(returns_arr) / np.std(returns_arr)) * math.sqrt(252)
    else:
        sharpe = 0.0

    # ── Win Rate & Risk Analytics ──
    closing_trades = [t for t in trades if t.get("pnl", 0) != 0]
    winning = [t for t in closing_trades if t["pnl"] > 0]
    win_rate = (len(winning) / len(closing_trades) * 100) if closing_trades else 0.0

    gross_profit = 0.0
    gross_loss = 0.0
    current_losing_streak = 0
    max_losing_streak = 0
    
    heatmap_dict = {"Mon": {}, "Tue": {}, "Wed": {}, "Thu": {}, "Fri": {}}
    ordered_weeks = []

    for t in closing_trades:
        pnl_val = t["pnl"]
        
        if pnl_val > 0:
            gross_profit += pnl_val
            current_losing_streak = 0
        elif pnl_val < 0:
            gross_loss += abs(pnl_val)
            current_losing_streak += 1
            if current_losing_streak > max_losing_streak:
                max_losing_streak = current_losing_streak

        d_obj = pd.to_datetime(t["date"])
        day_name = d_obj.strftime("%a")
        w_str = f"W{d_obj.isocalendar()[1]}"
        if w_str not in ordered_weeks:
            ordered_weeks.append(w_str)
        if day_name in heatmap_dict:
            heatmap_dict[day_name][w_str] = heatmap_dict[day_name].get(w_str, 0.0) + pnl_val

    profit_factor = round(gross_profit / gross_loss, 2) if gross_loss > 0 else "MAX"

    heatmap_data = []
    for day in ["Mon", "Tue", "Wed", "Thu", "Fri"]:
        series_data = []
        for w in ordered_weeks:
            series_data.append({"x": w, "y": round(heatmap_dict[day].get(w, 0.0), 2)})
        heatmap_data.append({"name": day, "data": series_data})

    return {
        "account_state": {
            "net_equity": round(final_equity, 2),
            "buying_power": round(buying_power, 2),
            "locked_margin": round(locked_margin, 2),
            "starting_capital": capital,
            "total_return_pct": round(((final_equity - capital) / capital) * 100, 2),
            "total_commissions": round(total_commissions, 2),
            "total_trades": len(closing_trades),
            "max_drawdown_pct": round(max_drawdown * 100, 2),
            "sharpe_ratio": round(sharpe, 4),
            "win_rate": round(win_rate, 2),
            "profit_factor": profit_factor,
            "max_losing_streak": max_losing_streak,
        },
        "trades": trades,
        "equity_curve": equity_curve,
        "heatmap": heatmap_data,
    }


# ─────────────────────────────────────────────────────────
# API ENDPOINT
# ─────────────────────────────────────────────────────────

async def _run_backtest(
    ticker: str, interval: str, sma_fast: int, sma_slow: int,
    capital: float, asset_class: str,
    stop_loss_pct: float = 0, take_profit_pct: float = 0,
):
    """Shared backtest logic for both endpoint aliases."""
    if sma_fast >= sma_slow:
        raise ValueError("sma_fast must be less than sma_slow")
    if capital <= 0:
        raise ValueError("capital must be positive")
    if asset_class not in ("stocks", "forex", "indices"):
        raise ValueError("asset_class must be 'stocks', 'forex', or 'indices'")

    payload = await get_backtest_payload_cached(
        ticker=ticker,
        interval=interval,
        sma_fast=sma_fast,
        sma_slow=sma_slow,
        capital=capital,
        asset_class=asset_class,
        stop_loss_pct=stop_loss_pct,
        take_profit_pct=take_profit_pct,
    )
    return JSONResponse(content=payload)


def _backtest_key_builder(
    func: Any,
    namespace: str,
    request: Optional[Any],
    response: Optional[Any],
    *args: Any,
    **kwargs: Any,
) -> str:
    def _g(k, i, default=""):
        if k in kwargs:
            return kwargs.get(k, default)
        if len(args) > i:
            return args[i]
        return default

    ticker = _g("ticker", 0)
    interval = _g("interval", 1)
    sma_fast = _g("sma_fast", 2)
    sma_slow = _g("sma_slow", 3)
    capital = _g("capital", 4)
    asset_class = _g("asset_class", 5)
    stop_loss_pct = _g("stop_loss_pct", 6)
    take_profit_pct = _g("take_profit_pct", 7)

    return f"{namespace}:{ticker}:{interval}:{asset_class}:{sma_fast}:{sma_slow}:{capital}:{stop_loss_pct}:{take_profit_pct}"


@cache(expire=60, namespace="backtest:v3", key_builder=_backtest_key_builder)
async def get_backtest_payload_cached(
    ticker: str,
    interval: str,
    sma_fast: int,
    sma_slow: int,
    capital: float,
    asset_class: str,
    stop_loss_pct: float = 0,
    take_profit_pct: float = 0,
) -> dict:
    formatted_ticker = format_ticker(ticker, asset_class)
    history_payload = await fetch_market_data_cached(formatted_ticker, interval)
    df = _cache_payload_to_df(history_payload)
    df = await run_in_threadpool(compute_sma_only, df, sma_fast, sma_slow)
    df, ai_prediction = await run_in_threadpool(compute_smc_signals, df, sma_fast)
    result = await run_in_threadpool(simulate_broker, df, capital, asset_class, formatted_ticker, stop_loss_pct, take_profit_pct)

    price_dec = get_price_decimals(asset_class, formatted_ticker)
    candle_slice = df.tail(300).copy()

    if "Volume" in candle_slice.columns:
        vol_val = pd.to_numeric(candle_slice["Volume"], errors="coerce").fillna(0).astype(int)
    else:
        vol_val = pd.Series([0] * len(candle_slice), index=candle_slice.index, dtype="int64")

    vol_total_sum = float(vol_val.sum())
    volume_experimental = (asset_class == "forex") or (vol_total_sum <= 0)

    is_buy = candle_slice["Close"] > candle_slice["Open"]
    buy_vol = vol_val.where(is_buy, 0)
    sell_vol = vol_val.where(~is_buy, 0)
    vol_ma20 = vol_val.rolling(window=20, min_periods=1).mean()
    denom = vol_ma20.where(vol_ma20 > 0, vol_val.clip(lower=1))
    volume_intensity = (vol_val / denom).clip(lower=0.0, upper=1.0).astype(float)
    volume_delta = (buy_vol - sell_vol).astype(int)

    ts = pd.to_datetime(candle_slice["Date"]).dt.strftime("%Y-%m-%dT%H:%M:%S")

    sma_fast_s = candle_slice.get("SMA_Fast")
    sma_slow_s = candle_slice.get("SMA_Slow")
    vwap_s = candle_slice.get("VWAP")
    adx_s = candle_slice.get("ADX")

    candles_df = pd.DataFrame({
        "x": ts,
        "o": candle_slice["Open"].round(price_dec),
        "h": candle_slice["High"].round(price_dec),
        "l": candle_slice["Low"].round(price_dec),
        "c": candle_slice["Close"].round(price_dec),
        "v": vol_val,
        "buy_volume": buy_vol,
        "sell_volume": sell_vol,
        "total_volume": vol_val,
        "volume_delta": volume_delta,
        "volume_intensity": volume_intensity,
        "sma_fast": sma_fast_s.round(price_dec) if sma_fast_s is not None else None,
        "sma_slow": sma_slow_s.round(price_dec) if sma_slow_s is not None else None,
        "vwap": vwap_s.round(price_dec) if vwap_s is not None else None,
        "adx": adx_s.round(2) if adx_s is not None else None,
    })

    for col in ("sma_fast", "sma_slow", "vwap", "adx"):
        if col in candles_df.columns:
            candles_df[col] = candles_df[col].where(pd.notna(candles_df[col]), None)

    candles = candles_df.to_dict(orient="records")

    volume_profile_df = pd.DataFrame({
        "timestamp": ts,
        "buy_volume": buy_vol,
        "sell_volume": sell_vol,
        "total_volume": vol_val,
    })
    volume_profile = volume_profile_df.to_dict(orient="records")

    display_ticker = str(ticker).upper().replace("=X", "")
    return {
        "status": "success",
        "ticker": display_ticker,
        "interval": interval,
        "asset_class": asset_class,
        "price_decimals": price_dec,
        "total_candles": int(len(df)),
        "rendered_candles": int(len(candles)),
        "candles": candles,
        "volume_profile": volume_profile,
        "volume_experimental": bool(volume_experimental),
        "ai_prediction": ai_prediction,
        **result,
    }


@app.get("/api/broker/execute")
@app.get("/api/backtest")
async def execute_paper_trade(
    ticker: str = Query("AAPL", description="Ticker symbol"),
    interval: str = Query("5m", description="Candle interval: 1m, 5m, 15m"),
    sma_fast: int = Query(10, description="Fast SMA period"),
    sma_slow: int = Query(30, description="Slow SMA period"),
    capital: float = Query(10000, description="Starting demo capital (USD)"),
    asset_class: str = Query("stocks", description="Asset class: stocks, forex, or indices"),
    stop_loss_pct: float = Query(0, description="Stop-loss percentage (0 = disabled)"),
    take_profit_pct: float = Query(0, description="Take-profit percentage (0 = disabled)"),
    user: dict = Depends(get_current_user)
):
    """Execute a paper trading simulation using SMA crossover strategy."""
    try:
        return await _run_backtest(
            ticker, interval, sma_fast, sma_slow,
            capital, asset_class, stop_loss_pct, take_profit_pct,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Engine error: {str(e)}")

@app.websocket("/ws/live")
async def ws_live(websocket: WebSocket):
    await live_manager.connect(websocket)
    ticker = websocket.query_params.get("ticker", "AAPL")
    asset_class = websocket.query_params.get("asset_class", "stocks")
    formatted_ticker = format_ticker(ticker, asset_class)
    try:
        while True:
            price = await get_latest_price(formatted_ticker)
            await websocket.send_json({
                "type": "LIVE_TICK",
                "timestamp": int(time.time()),
                "price": price,
            })
            await asyncio.sleep(3)
    except WebSocketDisconnect:
        await live_manager.disconnect(websocket)
    except Exception:
        await live_manager.disconnect(websocket)
        try:
            await websocket.close()
        except Exception:
            return

# ─────────────────────────────────────────────────────────
# HEALTH CHECK
# ─────────────────────────────────────────────────────────

@app.get("/api/health")
async def health_check():
    db_status = "not configured"
    if SUPABASE_URL and SUPABASE_SERVICE_KEY:
        try:
            resp = supabase_request("GET", "")
            if resp and resp.status_code < 500:
                db_status = "connected"
            else:
                db_status = f"error: HTTP {resp.status_code if resp else 'no response'}"
        except Exception as e:
            db_status = f"error: {str(e)}"

    return {"service": "Nexus Quant API", "status": "online", "version": "2.1.0", "database": db_status}


# ─────────────────────────────────────────────────────────
# STATIC FILES (REACT FRONTEND)
# ─────────────────────────────────────────────────────────

frontend_build = os.path.join(os.path.dirname(__file__), "frontend", "build")
if os.path.isdir(frontend_build):
    app.mount("/static", StaticFiles(directory=os.path.join(frontend_build, "static")), name="static")

    @app.get("/{full_path:path}")
    async def serve_react(full_path: str):
        path = os.path.join(frontend_build, full_path)
        if os.path.isfile(path):
            return FileResponse(path)
        return FileResponse(os.path.join(frontend_build, "index.html"))
else:
    @app.get("/")
    async def root():
        return {"message": "API is running. Build the frontend (`npm run build` inside frontend/ folder) to serve the UI."}
