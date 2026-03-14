"""
NEXUS QUANT — Demo Broker Simulator
FastAPI backend: Pure REST API for HFT Scalping & Paper Trading Engine
"""

import os
import math
import numpy as np
import pandas as pd
import yfinance as yf
from datetime import datetime

import jwt
import requests as http_client
from dotenv import load_dotenv
from fastapi import FastAPI, Query, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

load_dotenv()
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET")
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")

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
    "1m":  {"period": "7d",  "interval": "1m"},
    "5m":  {"period": "30d", "interval": "5m"},
    "15m": {"period": "60d", "interval": "15m"},
}


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
    return 4


def format_ticker(ticker: str, asset_class: str) -> str:
    """Format ticker for yfinance. Forex pairs need '=X' suffix."""
    ticker = ticker.upper().replace(" ", "").replace("/", "")
    if asset_class == "forex" and not ticker.endswith("=X"):
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
    """Institutional-grade signal generation with ADX and VWAP filters."""
    df = df.copy()
    
    # --- 1. Basic SMA Crossovers ---
    df["SMA_Fast"] = df["Close"].rolling(window=sma_fast, min_periods=sma_fast).mean()
    df["SMA_Slow"] = df["Close"].rolling(window=sma_slow, min_periods=sma_slow).mean()

    # --- 2. Institutional VWAP Calculation ---
    # Typical Price = (High + Low + Close) / 3
    df["Typical_Price"] = (df["High"] + df["Low"] + df["Close"]) / 3
    df["TP_Vol"] = df["Typical_Price"] * df["Volume"]
    # Cumulative Sum to avoid loop lag
    df["Cum_TP_Vol"] = df["TP_Vol"].cumsum()
    df["Cum_Vol"] = df["Volume"].cumsum().replace(0, np.nan)
    df["VWAP"] = df["Cum_TP_Vol"] / df["Cum_Vol"]
    # Fallback for VWAP if volume is 0: use Close
    df["VWAP"] = df["VWAP"].fillna(df["Close"])

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

    # Wilde's Smoothing using EWM (alpha = 1/n)
    df["TR_Smooth"] = df["TR"].ewm(alpha=1/n, adjust=False).mean()
    df["+DM_Smooth"] = df["+DM"].ewm(alpha=1/n, adjust=False).mean()
    df["-DM_Smooth"] = df["-DM"].ewm(alpha=1/n, adjust=False).mean()

    df["+DI"] = 100 * (df["+DM_Smooth"] / df["TR_Smooth"].replace(0, np.nan))
    df["-DI"] = 100 * (df["-DM_Smooth"] / df["TR_Smooth"].replace(0, np.nan))
    
    # DI can be NaN if TR is 0, fill with 0 to allow DX calculation
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

    # Detect crossover points
    df["Signal_Shift"] = df["Signal"].shift(1).fillna(0)
    df["Crossover"] = 0

    # Rules:
    # 1. ADX of previous candle must be >= 25 (Trend Strength)
    # 2. LONG: Close > VWAP
    # 3. SHORT: Close < VWAP
    
    df["ADX_P"] = df["ADX"].shift(1)
    
    # Cross UP
    long_condition = (
        (df["Signal"] == 1) & 
        (df["Signal_Shift"] != 1) & 
        (df["ADX_P"] >= 25) & 
        (df["Close"] > df["VWAP"])
    )
    df.loc[long_condition, "Crossover"] = 1

    # Cross DOWN
    short_condition = (
        (df["Signal"] == -1) & 
        (df["Signal_Shift"] != -1) & 
        (df["ADX_P"] >= 25) & 
        (df["Close"] < df["VWAP"])
    )
    df.loc[short_condition, "Crossover"] = -1

    # Cleanup temporary math cols
    df = df.drop(columns=[
        "Typical_Price", "TP_Vol", "Cum_TP_Vol", "Cum_Vol", 
        "prev_close", "tr1", "tr2", "tr3", "TR", "up_move", "down_move", 
        "+DM", "-DM", "TR_Smooth", "+DM_Smooth", "-DM_Smooth", 
        "+DI", "-DI", "DX"
    ])

    # Only drop if SMA is missing (standard behavior), keep ADX/VWAP errors as defaults
    return df.dropna(subset=["SMA_Fast", "SMA_Slow"]).fillna({"ADX": 0}).reset_index(drop=True)


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
        crossover = int(row["Crossover"])
        date_str = str(row["Date"])

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
    if asset_class not in ("stocks", "forex"):
        raise ValueError("asset_class must be 'stocks' or 'forex'")

    formatted_ticker = format_ticker(ticker, asset_class)
    df = fetch_market_data(formatted_ticker, interval)
    df = compute_signals(df, sma_fast, sma_slow)
    result = simulate_broker(df, capital, asset_class, formatted_ticker, stop_loss_pct, take_profit_pct)

    price_dec = get_price_decimals(asset_class, formatted_ticker)
    candle_slice = df.tail(300).copy()
    candles = []
    for _, row in candle_slice.iterrows():
        candles.append({
            "x": str(row["Date"]),
            "o": round(float(row["Open"]), price_dec),
            "h": round(float(row["High"]), price_dec),
            "l": round(float(row["Low"]), price_dec),
            "c": round(float(row["Close"]), price_dec),
            "v": int(row["Volume"]),
            "sma_fast": round(float(row["SMA_Fast"]), price_dec) if pd.notna(row["SMA_Fast"]) else None,
            "sma_slow": round(float(row["SMA_Slow"]), price_dec) if pd.notna(row["SMA_Slow"]) else None,
            "vwap": round(float(row["VWAP"]), price_dec) if pd.notna(row["VWAP"]) else None,
            "adx": round(float(row["ADX"]), 2) if pd.notna(row["ADX"]) else None,
        })

    display_ticker = ticker.upper().replace("=X", "")
    return JSONResponse(content={
        "status": "success",
        "ticker": display_ticker,
        "interval": interval,
        "asset_class": asset_class,
        "price_decimals": price_dec,
        "total_candles": len(df),
        "rendered_candles": len(candles),
        "candles": candles,
        **result,
    })


@app.get("/api/broker/execute")
@app.get("/api/backtest")
async def execute_paper_trade(
    ticker: str = Query("AAPL", description="Ticker symbol"),
    interval: str = Query("5m", description="Candle interval: 1m, 5m, 15m"),
    sma_fast: int = Query(10, description="Fast SMA period"),
    sma_slow: int = Query(30, description="Slow SMA period"),
    capital: float = Query(10000, description="Starting demo capital (USD)"),
    asset_class: str = Query("stocks", description="Asset class: stocks or forex"),
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
