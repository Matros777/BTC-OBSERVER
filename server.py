#!/usr/bin/env python3
"""
BTC Observer — local Binance BTCUSDT dashboard.

Stdlib only. Serves a static dashboard and a JSON API:
  /api/market   -> price, candles, indicators, signals, 24h forecast
  /api/health   -> liveness
  /api/klines   -> raw klines

Run:
  python3 server.py --host 0.0.0.0 --port 8787
"""

import argparse
import json
import math
import os
import random
import statistics
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

BINANCE = "https://api.binance.com"
SYMBOL = "BTCUSDT"
CACHE_TTL = 30
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")

_cache = {}
_cache_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Binance
# ---------------------------------------------------------------------------

def fetch_json(url, timeout=20):
    req = Request(
        url,
        headers={
            "User-Agent": "btc-observer/1.0",
            "Accept": "application/json",
        },
    )
    with urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def cached(key, ttl, fn):
    now = time.time()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    value = fn()
    with _cache_lock:
        _cache[key] = (now, value)
    return value


def get_klines(interval="1h", limit=500):
    url = (
        f"{BINANCE}/api/v3/klines"
        f"?symbol={SYMBOL}&interval={interval}&limit={limit}"
    )
    raw = cached(("klines", interval, limit), CACHE_TTL, lambda: fetch_json(url))
    out = []
    for k in raw:
        out.append(
            {
                "t": int(k[0]),
                "o": float(k[1]),
                "h": float(k[2]),
                "l": float(k[3]),
                "c": float(k[4]),
                "v": float(k[5]),
                "ct": int(k[6]),
                "qv": float(k[7]),
                "n": int(k[8]),
                "tb": float(k[9]),
                "tq": float(k[10]),
            }
        )
    return out


def get_ticker():
    url = f"{BINANCE}/api/v3/ticker/24hr?symbol={SYMBOL}"
    return cached("ticker", CACHE_TTL, lambda: fetch_json(url))


# ---------------------------------------------------------------------------
# Indicators
# ---------------------------------------------------------------------------

def sma(values, period):
    out = [None] * len(values)
    if period <= 0 or len(values) < period:
        return out
    total = 0.0
    for i, v in enumerate(values):
        total += v
        if i >= period:
            total -= values[i - period]
        if i >= period - 1:
            out[i] = total / period
    return out


def ema(values, period):
    out = [None] * len(values)
    if period <= 0 or len(values) < period:
        return out
    seed = sum(values[:period]) / period
    out[period - 1] = seed
    k = 2.0 / (period + 1.0)
    for i in range(period, len(values)):
        out[i] = values[i] * k + out[i - 1] * (1.0 - k)
    return out


def rsi(values, period=14):
    out = [None] * len(values)
    if len(values) <= period:
        return out
    gains = []
    losses = []
    for i in range(1, period + 1):
        diff = values[i] - values[i - 1]
        gains.append(max(diff, 0.0))
        losses.append(max(-diff, 0.0))
    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period

    def calc(g, l):
        if l == 0:
            return 100.0
        rs = g / l
        return 100.0 - 100.0 / (1.0 + rs)

    out[period] = calc(avg_gain, avg_loss)
    for i in range(period + 1, len(values)):
        diff = values[i] - values[i - 1]
        gain = max(diff, 0.0)
        loss = max(-diff, 0.0)
        avg_gain = (avg_gain * (period - 1) + gain) / period
        avg_loss = (avg_loss * (period - 1) + loss) / period
        out[i] = calc(avg_gain, avg_loss)
    return out


def macd(values, fast=12, slow=26, signal=9):
    fast_ema = ema(values, fast)
    slow_ema = ema(values, slow)
    line = [None] * len(values)
    for i in range(len(values)):
        if fast_ema[i] is not None and slow_ema[i] is not None:
            line[i] = fast_ema[i] - slow_ema[i]
    start = next((i for i, v in enumerate(line) if v is not None), None)
    sig = [None] * len(values)
    if start is not None:
        sub = [v for v in line[start:] if v is not None]
        sub_ema = ema(sub, signal)
        for j, v in enumerate(sub_ema):
            if v is not None:
                sig[start + j] = v
    hist = [
        None if line[i] is None or sig[i] is None else line[i] - sig[i]
        for i in range(len(values))
    ]
    return line, sig, hist


def bollinger(values, period=20, k=2.0):
    middle = sma(values, period)
    upper = [None] * len(values)
    lower = [None] * len(values)
    width = [None] * len(values)
    percent_b = [None] * len(values)
    for i in range(len(values)):
        if middle[i] is None:
            continue
        window = values[i - period + 1 : i + 1]
        sd = statistics.pstdev(window)
        upper[i] = middle[i] + k * sd
        lower[i] = middle[i] - k * sd
        if middle[i]:
            width[i] = (upper[i] - lower[i]) / middle[i] * 100.0
        rng = upper[i] - lower[i]
        percent_b[i] = (values[i] - lower[i]) / rng if rng else 0.5
    return {
        "middle": middle,
        "upper": upper,
        "lower": lower,
        "width": width,
        "percent_b": percent_b,
    }


def atr(highs, lows, closes, period=14):
    n = len(closes)
    tr = [None] * n
    for i in range(n):
        if i == 0:
            tr[i] = highs[i] - lows[i]
        else:
            tr[i] = max(
                highs[i] - lows[i],
                abs(highs[i] - closes[i - 1]),
                abs(lows[i] - closes[i - 1]),
            )
    out = [None] * n
    if n < period:
        return out
    out[period - 1] = sum(tr[:period]) / period
    for i in range(period, n):
        out[i] = (out[i - 1] * (period - 1) + tr[i]) / period
    return out


def stochastic(highs, lows, closes, k_period=14, d_period=3):
    n = len(closes)
    k_line = [None] * n
    for i in range(n):
        if i < k_period - 1:
            continue
        hh = max(highs[i - k_period + 1 : i + 1])
        ll = min(lows[i - k_period + 1 : i + 1])
        k_line[i] = 100.0 * (closes[i] - ll) / (hh - ll) if hh != ll else 50.0
    d_line = [None] * n
    for i in range(n):
        window = [k_line[j] for j in range(max(0, i - d_period + 1), i + 1) if k_line[j] is not None]
        if len(window) == d_period:
            d_line[i] = sum(window) / d_period
    return k_line, d_line


def adx(highs, lows, closes, period=14):
    n = len(closes)
    tr = [0.0] * n
    plus_dm = [0.0] * n
    minus_dm = [0.0] * n
    for i in range(1, n):
        up = highs[i] - highs[i - 1]
        down = lows[i - 1] - lows[i]
        plus_dm[i] = up if up > down and up > 0 else 0.0
        minus_dm[i] = down if down > up and down > 0 else 0.0
        tr[i] = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        )
    atr_s = [None] * n
    plus_s = [None] * n
    minus_s = [None] * n
    if n <= period:
        return {"adx": [None] * n, "plus_di": [None] * n, "minus_di": [None] * n}
    atr_s[period] = sum(tr[1 : period + 1]) / period
    plus_s[period] = sum(plus_dm[1 : period + 1]) / period
    minus_s[period] = sum(minus_dm[1 : period + 1]) / period
    for i in range(period + 1, n):
        atr_s[i] = (atr_s[i - 1] * (period - 1) + tr[i]) / period
        plus_s[i] = (plus_s[i - 1] * (period - 1) + plus_dm[i]) / period
        minus_s[i] = (minus_s[i - 1] * (period - 1) + minus_dm[i]) / period
    plus_di = [None] * n
    minus_di = [None] * n
    dx = [None] * n
    for i in range(period, n):
        if atr_s[i]:
            plus_di[i] = 100.0 * plus_s[i] / atr_s[i]
            minus_di[i] = 100.0 * minus_s[i] / atr_s[i]
            denom = plus_di[i] + minus_di[i]
            dx[i] = 100.0 * abs(plus_di[i] - minus_di[i]) / denom if denom else 0.0
    adx_line = [None] * n
    first = next((i for i, v in enumerate(dx) if v is not None), None)
    if first is not None and first + period <= n:
        adx_line[first + period - 1] = sum(dx[first : first + period]) / period
        for i in range(first + period, n):
            if adx_line[i - 1] is not None and dx[i] is not None:
                adx_line[i] = (adx_line[i - 1] * (period - 1) + dx[i]) / period
    return {"adx": adx_line, "plus_di": plus_di, "minus_di": minus_di}


def obv(closes, volumes):
    out = [0.0] * len(closes)
    for i in range(1, len(closes)):
        if closes[i] > closes[i - 1]:
            out[i] = out[i - 1] + volumes[i]
        elif closes[i] < closes[i - 1]:
            out[i] = out[i - 1] - volumes[i]
        else:
            out[i] = out[i - 1]
    return out


def rolling_vwap(highs, lows, closes, volumes, period=24):
    n = len(closes)
    out = [None] * n
    for i in range(n):
        if i < period - 1:
            continue
        total_pv = 0.0
        total_v = 0.0
        for j in range(i - period + 1, i + 1):
            typical = (highs[j] + lows[j] + closes[j]) / 3.0
            total_pv += typical * volumes[j]
            total_v += volumes[j]
        out[i] = total_pv / total_v if total_v else None
    return out


def cci(highs, lows, closes, period=20):
    n = len(closes)
    typical = [(highs[i] + lows[i] + closes[i]) / 3.0 for i in range(n)]
    out = [None] * n
    for i in range(period - 1, n):
        window = typical[i - period + 1 : i + 1]
        mean = sum(window) / period
        mean_dev = sum(abs(x - mean) for x in window) / period
        out[i] = (typical[i] - mean) / (0.015 * mean_dev) if mean_dev else 0.0
    return out


def williams_r(highs, lows, closes, period=14):
    n = len(closes)
    out = [None] * n
    for i in range(period - 1, n):
        hh = max(highs[i - period + 1 : i + 1])
        ll = min(lows[i - period + 1 : i + 1])
        out[i] = -100.0 * (hh - closes[i]) / (hh - ll) if hh != ll else -50.0
    return out


def mfi(highs, lows, closes, volumes, period=14):
    n = len(closes)
    typical = [(highs[i] + lows[i] + closes[i]) / 3.0 for i in range(n)]
    pos = [0.0] * n
    neg = [0.0] * n
    for i in range(1, n):
        flow = typical[i] * volumes[i]
        if typical[i] > typical[i - 1]:
            pos[i] = flow
        elif typical[i] < typical[i - 1]:
            neg[i] = flow
    out = [None] * n
    for i in range(period, n):
        p = sum(pos[i - period + 1 : i + 1])
        q = sum(neg[i - period + 1 : i + 1])
        out[i] = 100.0 - 100.0 / (1.0 + p / q) if q else 100.0
    return out


def roc(values, period=12):
    n = len(values)
    out = [None] * n
    for i in range(period, n):
        prev = values[i - period]
        out[i] = (values[i] / prev - 1.0) * 100.0 if prev else None
    return out


def ichimoku(highs, lows, closes):
    n = len(closes)

    def mid_line(period):
        out = [None] * n
        for i in range(period - 1, n):
            out[i] = (max(highs[i - period + 1 : i + 1]) + min(lows[i - period + 1 : i + 1])) / 2.0
        return out

    tenkan = mid_line(9)
    kijun = mid_line(26)
    senkou_a = [None] * n
    senkou_b = [None] * n
    for i in range(n):
        if tenkan[i] is not None and kijun[i] is not None:
            j = i + 26
            if j < n:
                senkou_a[j] = (tenkan[i] + kijun[i]) / 2.0
        if i >= 51:
            j = i + 26
            if j < n:
                senkou_b[j] = (max(highs[i - 51 : i + 1]) + min(lows[i - 51 : i + 1])) / 2.0
    chikou = [None] * n
    for i in range(n - 26):
        chikou[i] = closes[i + 26]
    return {
        "tenkan": tenkan,
        "kijun": kijun,
        "senkou_a": senkou_a,
        "senkou_b": senkou_b,
        "chikou": chikou,
    }


def fib_levels(highs, lows, lookback=120):
    window_h = highs[-lookback:]
    window_l = lows[-lookback:]
    high = max(window_h)
    low = min(window_l)
    diff = high - low
    ratios = [0.0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0]
    levels = {f"{r:.3f}": high - diff * r for r in ratios}
    return {"high": high, "low": low, "levels": levels}


def pivot_points(highs, lows, closes):
    h = max(highs[-24:])
    l = min(lows[-24:])
    c = closes[-1]
    p = (h + l + c) / 3.0
    return {
        "p": p,
        "r1": 2 * p - l,
        "s1": 2 * p - h,
        "r2": p + (h - l),
        "s2": p - (h - l),
        "r3": h + 2 * (p - l),
        "s3": l - 2 * (h - p),
    }


def swing_levels(highs, lows, lookback=200, wing=3):
    start = max(wing, len(highs) - lookback)
    highs_out = []
    lows_out = []
    for i in range(start, len(highs) - wing):
        if highs[i] == max(highs[i - wing : i + wing + 1]):
            highs_out.append(highs[i])
        if lows[i] == min(lows[i - wing : i + wing + 1]):
            lows_out.append(lows[i])
    return highs_out[-5:], lows_out[-5:]


def last_valid(series):
    for value in reversed(series):
        if value is not None:
            return value
    return None


def clamp(value, low, high):
    return max(low, min(high, value))


# ---------------------------------------------------------------------------
# BTC spot ETF flows (farside, $M) — 2-week window
# ---------------------------------------------------------------------------

ETF_DATASET = {
    "2026-10-27": {"total": 176.1, "ibit": None, "fbtc": None, "src": "memory-reconstructed"},
    "2026-10-28": {"total": 137.3, "ibit": 136.0, "fbtc": 0.0, "src": "farside"},
    "2026-10-29": {"total": 17.2, "ibit": 12.8, "fbtc": 10.5, "src": "farside"},
    "2026-10-30": {"total": -643.2, "ibit": -233.7, "fbtc": -201.0, "src": "farside"},
    "2026-11-02": {"total": -398.6, "ibit": -405.3, "fbtc": 6.7, "src": "farside"},
    "2026-11-03": {"total": -115.6, "ibit": -95.0, "fbtc": 6.8, "src": "farside"},
    "2026-11-04": {"total": 74.6, "ibit": -201.2, "fbtc": 236.7, "src": "farside"},
    "2026-11-05": {"total": -430.2, "ibit": -105.0, "fbtc": -199.9, "src": "farside"},
    "2026-11-06": {"total": -411.9, "ibit": -403.0, "fbtc": 42.8, "src": "farside"},
    "2026-11-09": {"total": -201.0, "ibit": -213.2, "fbtc": 0.0, "src": "farside"},
    "2026-11-10": {"total": -95.0, "ibit": -78.2, "fbtc": -36.8, "src": "farside"},
    "2026-11-11": {"total": -299.8, "ibit": -269.7, "fbtc": 0.0, "src": "farside"},
    "2026-11-12": {"total": -284.1, "ibit": -203.8, "fbtc": -32.6, "src": "farside"},
    "2026-11-13": {"total": -185.4, "ibit": -143.5, "fbtc": -41.9, "src": "farside"},
    "2026-11-16": {"total": 7.9, "ibit": 76.5, "fbtc": -11.3, "src": "farside"},
}

ETF_ISSUANCE_BTC = 450.0
ETF_TH_RED = -250.0

# Live days appended by scripts/etf_sync.mjs (same file the browser loads).
# Missing/invalid file is fine: the embedded seed above stays authoritative.
def _load_live_etf_days():
    path = os.path.join(BASE_DIR, "static", "etf-live.json")
    try:
        with open(path, "r", encoding="utf-8") as fh:
            payload = json.load(fh)
    except (OSError, ValueError):
        return
    for day, item in (payload.get("days") or {}).items():
        if not isinstance(item, dict) or item.get("total") is None:
            continue
        try:
            ETF_DATASET[day] = {
                "total": float(item["total"]),
                "ibit": None if item.get("ibit") is None else float(item["ibit"]),
                "fbtc": None if item.get("fbtc") is None else float(item["fbtc"]),
                "src": item.get("src", "farside"),
            }
        except (TypeError, ValueError):
            continue


_load_live_etf_days()


def etf_verdict(total, ibit):
    if total > 0:
        return "FLASH-BUY" if ibit is not None and ibit > 0 else "FLASH-FAKE"
    if total >= ETF_TH_RED:
        return "YELLOW"
    return "RED"


def etf_summary(price, limit=10):
    days = sorted(ETF_DATASET.keys())
    window = days[-limit:]
    rows = []
    for day in window:
        item = ETF_DATASET[day]
        total = float(item["total"])
        ibit = item.get("ibit")
        fbtc = item.get("fbtc")
        rows.append(
            {
                "date": day,
                "total": total,
                "ibit": None if ibit is None else float(ibit),
                "fbtc": None if fbtc is None else float(fbtc),
                "verdict": etf_verdict(total, ibit),
                "src": item.get("src", "farside"),
            }
        )

    totals = [r["total"] for r in rows]
    net = sum(totals)
    inflows = sum(v for v in totals if v > 0)
    outflows = sum(v for v in totals if v < 0)
    green_days = sum(1 for v in totals if v > 0)
    red_days = sum(1 for v in totals if v < 0)
    ibit_net = sum((r["ibit"] or 0.0) for r in rows)
    fbtc_net = sum((r["fbtc"] or 0.0) for r in rows)
    avg_daily = net / len(rows) if rows else 0.0

    issuance_m = ETF_ISSUANCE_BTC * price / 1e6 if price else 0.0
    pressure = abs(avg_daily) / issuance_m if issuance_m else 0.0

    flow_score = math.tanh(avg_daily / issuance_m / 3.0) * 100.0 if issuance_m else 0.0
    recent3 = sum(totals[-3:]) if len(totals) >= 3 else net
    prev3 = sum(totals[-6:-3]) if len(totals) >= 6 else 0.0
    momentum = math.tanh((recent3 - prev3) / (3.0 * issuance_m * 2.0)) * 100.0 if issuance_m else 0.0
    score = clamp(0.7 * flow_score + 0.3 * momentum, -100.0, 100.0)

    if score >= 50:
        label = "STRONG BULLISH"
    elif score >= 20:
        label = "BULLISH"
    elif score > -20:
        label = "NEUTRAL"
    elif score > -50:
        label = "BEARISH"
    else:
        label = "STRONG BEARISH"

    last5 = sum(totals[-5:]) if len(totals) >= 5 else net
    prev5 = sum(totals[-10:-5]) if len(totals) >= 10 else 0.0
    wow = (last5 / prev5) if prev5 else None

    best = max(rows, key=lambda r: r["total"]) if rows else None
    worst = min(rows, key=lambda r: r["total"]) if rows else None
    last = rows[-1] if rows else None

    return {
        "window": {
            "start": rows[0]["date"] if rows else None,
            "end": rows[-1]["date"] if rows else None,
            "days": len(rows),
            "label": "2W",
        },
        "daily": rows,
        "summary": {
            "net": round(net, 1),
            "inflows": round(inflows, 1),
            "outflows": round(outflows, 1),
            "greenDays": green_days,
            "redDays": red_days,
            "avgDaily": round(avg_daily, 1),
            "ibitNet": round(ibit_net, 1),
            "fbtcNet": round(fbtc_net, 1),
            "best": {"date": best["date"], "total": best["total"]} if best else None,
            "worst": {"date": worst["date"], "total": worst["total"]} if worst else None,
            "wow": None if wow is None else round(wow, 3),
            "pressure": round(pressure, 2),
            "issuanceM": round(issuance_m, 2),
            "last": last,
            "lastVerdict": last["verdict"] if last else "YELLOW",
            "tail": [round(v, 1) for v in totals[-3:]],
        },
        "score": round(score, 1),
        "label": label,
        "method": "farside spot BTC ETF net flows, $M; 10 trading days; flow pressure vs 450 BTC/day issuance",
        "disclaimer": "ETF flows are historical data, not a forecast. Not financial advice.",
        "updatedAt": int(time.time() * 1000),
    }


# ---------------------------------------------------------------------------
# Analysis
# ---------------------------------------------------------------------------

def analyze(klines, ticker):
    if not klines:
        raise ValueError("no klines")

    closes = [k["c"] for k in klines]
    highs = [k["h"] for k in klines]
    lows = [k["l"] for k in klines]
    volumes = [k["v"] for k in klines]
    price = closes[-1]

    ema20 = ema(closes, 20)
    ema50 = ema(closes, 50)
    ema200 = ema(closes, 200)
    rsi14 = rsi(closes, 14)
    macd_line, macd_signal, macd_hist = macd(closes)
    bb = bollinger(closes)
    atr14 = atr(highs, lows, closes, 14)
    stoch_k, stoch_d = stochastic(highs, lows, closes)
    adx_data = adx(highs, lows, closes)
    obv_line = obv(closes, volumes)
    vwap24 = rolling_vwap(highs, lows, closes, volumes, 24)
    cci20 = cci(highs, lows, closes)
    wr14 = williams_r(highs, lows, closes)
    mfi14 = mfi(highs, lows, closes, volumes)
    roc12 = roc(closes, 12)
    ichi = ichimoku(highs, lows, closes)
    fib = fib_levels(highs, lows)
    piv = pivot_points(highs, lows, closes)
    swing_highs, swing_lows = swing_levels(highs, lows)

    e20 = last_valid(ema20)
    e50 = last_valid(ema50)
    e200 = last_valid(ema200)
    rsi_v = last_valid(rsi14)
    macd_v = last_valid(macd_line)
    macd_sig_v = last_valid(macd_signal)
    macd_hist_v = last_valid(macd_hist)
    bb_upper = last_valid(bb["upper"])
    bb_lower = last_valid(bb["lower"])
    bb_mid = last_valid(bb["middle"])
    bb_pb = last_valid(bb["percent_b"])
    bb_width = last_valid(bb["width"])
    atr_v = last_valid(atr14)
    stoch_k_v = last_valid(stoch_k)
    stoch_d_v = last_valid(stoch_d)
    adx_v = last_valid(adx_data["adx"])
    plus_di_v = last_valid(adx_data["plus_di"])
    minus_di_v = last_valid(adx_data["minus_di"])
    obv_v = last_valid(obv_line)
    vwap_v = last_valid(vwap24)
    cci_v = last_valid(cci20)
    wr_v = last_valid(wr14)
    mfi_v = last_valid(mfi14)
    roc_v = last_valid(roc12)
    tenkan_v = last_valid(ichi["tenkan"])
    kijun_v = last_valid(ichi["kijun"])
    senkou_a_v = last_valid(ichi["senkou_a"])
    senkou_b_v = last_valid(ichi["senkou_b"])

    signals = []

    def add(name, value, signal, score, weight=1.0, note=""):
        signals.append(
            {
                "name": name,
                "value": value,
                "signal": signal,
                "score": round(clamp(score, -1.0, 1.0), 3),
                "weight": weight,
                "note": note,
            }
        )

    # Trend
    if e50:
        score = 1.0 if price > e50 else -1.0
        add("Price vs EMA50", f"${price:,.0f} / ${e50:,.0f}", "BULL" if score > 0 else "BEAR", score, 1.2)
    if e50 and e200:
        score = 1.0 if e50 > e200 else -1.0
        add("EMA50 vs EMA200", f"${e50:,.0f} / ${e200:,.0f}", "GOLDEN" if score > 0 else "DEATH", score, 1.2)
    if e20 and len(ema20) > 6 and ema20[-6]:
        slope = (e20 / ema20[-6] - 1.0) * 100.0
        score = clamp(slope / 2.0, -1.0, 1.0)
        add("EMA20 slope", f"{slope:+.2f}% / 5h", "UP" if slope > 0 else "DOWN", score, 1.0)
    if macd_hist_v is not None and len(macd_hist) > 1:
        prev = last_valid(macd_hist[:-1])
        direction = 1.0 if macd_hist_v > 0 else -1.0
        if prev is not None:
            direction = 1.0 if macd_hist_v > prev else -1.0 if macd_hist_v < prev else direction
        add("MACD histogram", f"{macd_hist_v:,.1f}", "BULL" if macd_hist_v > 0 else "BEAR", direction, 1.2)
    if adx_v is not None and plus_di_v is not None and minus_di_v is not None:
        score = 0.0
        if adx_v >= 25:
            score = 1.0 if plus_di_v > minus_di_v else -1.0
        add("ADX / DI", f"{adx_v:.1f} / +{plus_di_v:.1f} -{minus_di_v:.1f}", "TREND" if adx_v >= 25 else "RANGE", score, 1.0)

    # Momentum
    if rsi_v is not None:
        if rsi_v < 30:
            score, label = 1.0, "OVERSOLD"
        elif rsi_v > 70:
            score, label = -1.0, "OVERBOUGHT"
        elif rsi_v >= 50:
            score, label = 0.35, "BULLISH"
        else:
            score, label = -0.35, "BEARISH"
        add("RSI 14", f"{rsi_v:.1f}", label, score, 1.0)
    if stoch_k_v is not None and stoch_d_v is not None:
        if stoch_k_v < 20 and stoch_k_v > stoch_d_v:
            score, label = 1.0, "OVERSOLD CROSS"
        elif stoch_k_v > 80 and stoch_k_v < stoch_d_v:
            score, label = -1.0, "OVERBOUGHT CROSS"
        else:
            score = clamp((stoch_k_v - stoch_d_v) / 20.0, -0.6, 0.6)
            label = "BULL" if score > 0 else "BEAR"
        add("Stochastic", f"K {stoch_k_v:.1f} / D {stoch_d_v:.1f}", label, score, 0.8)
    if cci_v is not None:
        if cci_v > 100:
            score, label = -0.8, "OVERBOUGHT"
        elif cci_v < -100:
            score, label = 0.8, "OVERSOLD"
        else:
            score, label = clamp(cci_v / 200.0, -0.5, 0.5), "NEUTRAL"
        add("CCI 20", f"{cci_v:.1f}", label, score, 0.6)
    if wr_v is not None:
        if wr_v < -80:
            score, label = 1.0, "OVERSOLD"
        elif wr_v > -20:
            score, label = -1.0, "OVERBOUGHT"
        else:
            score, label = clamp((wr_v + 50.0) / 50.0, -0.5, 0.5), "NEUTRAL"
        add("Williams %R", f"{wr_v:.1f}", label, score, 0.6)
    if mfi_v is not None:
        if mfi_v < 20:
            score, label = 1.0, "OVERSOLD"
        elif mfi_v > 80:
            score, label = -1.0, "OVERBOUGHT"
        else:
            score, label = clamp((50.0 - mfi_v) / 50.0, -0.5, 0.5), "NEUTRAL"
        add("MFI 14", f"{mfi_v:.1f}", label, score, 0.6)
    if roc_v is not None:
        score = clamp(roc_v / 5.0, -1.0, 1.0)
        add("ROC 12", f"{roc_v:+.2f}%", "UP" if roc_v > 0 else "DOWN", score, 0.8)

    # Mean reversion / volatility
    if bb_pb is not None:
        if bb_pb < 0:
            score, label = 1.0, "BELOW LOWER"
        elif bb_pb > 1:
            score, label = -1.0, "ABOVE UPPER"
        else:
            score, label = clamp((0.5 - bb_pb) * 2.0, -0.7, 0.7), "INSIDE BANDS"
        add("Bollinger %B", f"{bb_pb:.2f}", label, score, 0.7)

    # Volume
    if obv_v is not None and len(obv_line) > 24:
        prev = obv_line[-25]
        score = 1.0 if obv_v > prev else -1.0 if obv_v < prev else 0.0
        add("OBV slope", f"{obv_v:,.0f}", "ACCUMULATION" if score > 0 else "DISTRIBUTION", score, 0.8)
    if vwap_v:
        score = 0.5 if price > vwap_v else -0.5
        add("VWAP 24h", f"${vwap_v:,.0f}", "ABOVE" if score > 0 else "BELOW", score, 0.6)

    # Ichimoku
    if kijun_v is not None:
        score = 0.0
        if price > kijun_v:
            score += 0.5
        else:
            score -= 0.5
        if tenkan_v is not None:
            score += 0.5 if tenkan_v > kijun_v else -0.5
        add("Ichimoku", f"T {tenkan_v:,.0f} / K {kijun_v:,.0f}" if tenkan_v else f"K {kijun_v:,.0f}", "BULL" if score > 0 else "BEAR", score, 0.7)

    # Pivot
    if piv:
        score = 0.5 if price > piv["p"] else -0.5
        add("Pivot", f"P ${piv['p']:,.0f}", "ABOVE" if score > 0 else "BELOW", score, 0.4)

    total_weight = sum(s["weight"] for s in signals) or 1.0
    composite_score = sum(s["score"] * s["weight"] for s in signals) / total_weight * 100.0

    if composite_score >= 60:
        composite_label = "STRONG BULLISH"
    elif composite_score >= 25:
        composite_label = "BULLISH"
    elif composite_score > -25:
        composite_label = "NEUTRAL"
    elif composite_score > -60:
        composite_label = "BEARISH"
    else:
        composite_label = "STRONG BEARISH"

    adx_for_conf = adx_v if adx_v is not None else 20.0
    confidence = clamp(35.0 + abs(composite_score) * 0.45 + min(adx_for_conf, 50.0) * 0.4, 0.0, 95.0)
    if adx_for_conf < 20:
        confidence *= 0.8

    # 24h Monte Carlo forecast
    returns = []
    for i in range(1, len(closes)):
        if closes[i - 1] > 0 and closes[i] > 0:
            returns.append(math.log(closes[i] / closes[i - 1]))
    recent = returns[-72:] if len(returns) >= 72 else returns
    vol_window = returns[-168:] if len(returns) >= 168 else returns
    mu = sum(recent) / len(recent) if recent else 0.0
    sigma = statistics.pstdev(vol_window) if len(vol_window) > 1 else 0.01
    if e20 and len(ema20) > 6 and ema20[-6]:
        slope = (e20 / ema20[-6] - 1.0) / 5.0
        if slope > -0.99:
            mu = 0.5 * mu + 0.5 * math.log(1.0 + slope)
    sigma = max(sigma, 0.0005)
    mu = clamp(mu, -sigma * 0.5, sigma * 0.5)

    steps = 24
    simulations = 2000
    finals = []
    paths = []
    for _ in range(simulations):
        p = price
        path = [p]
        for _ in range(steps):
            p *= math.exp(mu + sigma * random.gauss(0.0, 1.0))
            path.append(p)
        finals.append(p)
        paths.append(path)
    finals.sort()
    median_final = statistics.median(finals)
    p10 = finals[int(0.10 * len(finals))]
    p90 = finals[int(0.90 * len(finals))]
    prob_up = sum(1 for f in finals if f > price) / len(finals)
    median_path = [statistics.median([path[i] for path in paths]) for i in range(steps + 1)]
    forecast_confidence = clamp(
        30.0 + abs(composite_score) * 0.4 + min(adx_for_conf, 50.0) * 0.4,
        0.0,
        90.0,
    )

    # Chart payload: last 180 candles
    tail_n = 180
    start = max(0, len(klines) - tail_n)

    def tail(series):
        return series[start:]

    chart = {
        "candles": klines[start:],
        "ema20": tail(ema20),
        "ema50": tail(ema50),
        "ema200": tail(ema200),
        "bb_upper": tail(bb["upper"]),
        "bb_lower": tail(bb["lower"]),
        "bb_mid": tail(bb["middle"]),
        "rsi": tail(rsi14),
        "macd": tail(macd_line),
        "macd_signal": tail(macd_signal),
        "macd_hist": tail(macd_hist),
        "volume": [k["v"] for k in klines[start:]],
    }

    return {
        "symbol": SYMBOL,
        "price": price,
        "ticker": {
            "change24h": float(ticker.get("priceChangePercent", 0.0)),
            "change24hAbs": float(ticker.get("priceChange", 0.0)),
            "high24h": float(ticker.get("highPrice", 0.0)),
            "low24h": float(ticker.get("lowPrice", 0.0)),
            "volume24h": float(ticker.get("volume", 0.0)),
            "quoteVolume24h": float(ticker.get("quoteVolume", 0.0)),
            "trades24h": int(ticker.get("count", 0)),
        },
        "indicators": {
            "ema20": e20,
            "ema50": e50,
            "ema200": e200,
            "rsi14": rsi_v,
            "macd": macd_v,
            "macd_signal": macd_sig_v,
            "macd_hist": macd_hist_v,
            "bb_upper": bb_upper,
            "bb_mid": bb_mid,
            "bb_lower": bb_lower,
            "bb_percent_b": bb_pb,
            "bb_width": bb_width,
            "atr14": atr_v,
            "stoch_k": stoch_k_v,
            "stoch_d": stoch_d_v,
            "adx": adx_v,
            "plus_di": plus_di_v,
            "minus_di": minus_di_v,
            "obv": obv_v,
            "vwap24": vwap_v,
            "cci20": cci_v,
            "williams_r": wr_v,
            "mfi14": mfi_v,
            "roc12": roc_v,
            "tenkan": tenkan_v,
            "kijun": kijun_v,
            "senkou_a": senkou_a_v,
            "senkou_b": senkou_b_v,
        },
        "signals": signals,
        "composite": {
            "score": round(composite_score, 1),
            "label": composite_label,
            "confidence": round(confidence, 1),
        },
        "prediction": {
            "horizon": "24h",
            "current": price,
            "median": median_final,
            "p10": p10,
            "p90": p90,
            "probUp": prob_up,
            "changePct": (median_final / price - 1.0) * 100.0,
            "rangeLow": p10,
            "rangeHigh": p90,
            "confidence": round(forecast_confidence, 1),
            "path": median_path,
            "method": "Monte Carlo GBM · 2000 paths · 1h steps · 24h horizon",
            "disclaimer": "Probabilistic model, not financial advice.",
        },
        "levels": {
            "fibonacci": fib,
            "pivots": piv,
            "swing_highs": swing_highs,
            "swing_lows": swing_lows,
            "support": min(swing_lows) if swing_lows else fib["low"],
            "resistance": max(swing_highs) if swing_highs else fib["high"],
        },
        "chart": chart,
        "updatedAt": int(time.time() * 1000),
    }


def analyze_long_term(klines):
    """Daily-timeframe trend score for the long-term half of the cosmic gauge."""
    if not klines or len(klines) < 50:
        return {
            "score": 0.0,
            "label": "NEUTRAL",
            "confidence": 0.0,
            "details": {},
            "signals": [],
        }

    closes = [k["c"] for k in klines]
    highs = [k["h"] for k in klines]
    lows = [k["l"] for k in klines]
    price = closes[-1]

    e50 = last_valid(ema(closes, 50))
    e200 = last_valid(ema(closes, 200))
    rsi_v = last_valid(rsi(closes, 14))
    macd_line, _, macd_hist = macd(closes)
    hist_v = last_valid(macd_hist)
    adx_data = adx(highs, lows, closes)
    adx_v = last_valid(adx_data["adx"])
    plus_di = last_valid(adx_data["plus_di"])
    minus_di = last_valid(adx_data["minus_di"])
    roc30 = (price / closes[-31] - 1.0) * 100.0 if len(closes) >= 31 and closes[-31] else None

    signals = []

    def add(name, value, signal, score, weight=1.0):
        signals.append(
            {
                "name": name,
                "value": value,
                "signal": signal,
                "score": round(clamp(score, -1.0, 1.0), 3),
                "weight": weight,
            }
        )

    if e200:
        score = 1.0 if price > e200 else -1.0
        add("Price vs EMA200", f"${price:,.0f} / ${e200:,.0f}", "BULL" if score > 0 else "BEAR", score, 1.5)
    if e50 and e200:
        score = 1.0 if e50 > e200 else -1.0
        add("EMA50 vs EMA200", f"${e50:,.0f} / ${e200:,.0f}", "GOLDEN" if score > 0 else "DEATH", score, 1.5)
    if rsi_v is not None:
        if rsi_v < 30:
            score, label = 1.0, "OVERSOLD"
        elif rsi_v > 70:
            score, label = -1.0, "OVERBOUGHT"
        elif rsi_v >= 50:
            score, label = 0.3, "BULLISH"
        else:
            score, label = -0.3, "BEARISH"
        add("Daily RSI 14", f"{rsi_v:.1f}", label, score, 1.0)
    if hist_v is not None:
        add("Daily MACD", f"{hist_v:,.1f}", "BULL" if hist_v > 0 else "BEAR", 1.0 if hist_v > 0 else -1.0, 1.2)
    if roc30 is not None:
        score = clamp(roc30 / 15.0, -1.0, 1.0)
        add("30D ROC", f"{roc30:+.1f}%", "UP" if roc30 > 0 else "DOWN", score, 1.0)
    if adx_v is not None and plus_di is not None and minus_di is not None:
        score = 0.0
        if adx_v >= 25:
            score = 1.0 if plus_di > minus_di else -1.0
        add("Daily ADX", f"{adx_v:.1f}", "TREND" if adx_v >= 25 else "RANGE", score, 1.0)

    total_weight = sum(s["weight"] for s in signals) or 1.0
    composite = sum(s["score"] * s["weight"] for s in signals) / total_weight * 100.0

    if composite >= 50:
        label = "STRONG BULLISH"
    elif composite >= 20:
        label = "BULLISH"
    elif composite > -20:
        label = "NEUTRAL"
    elif composite > -50:
        label = "BEARISH"
    else:
        label = "STRONG BEARISH"

    confidence = clamp(40.0 + abs(composite) * 0.45 + min(adx_v or 20.0, 50.0) * 0.3, 0.0, 95.0)

    return {
        "score": round(composite, 1),
        "label": label,
        "confidence": round(confidence, 1),
        "details": {
            "price": price,
            "ema50": e50,
            "ema200": e200,
            "rsi14": rsi_v,
            "macdHist": hist_v,
            "adx": adx_v,
            "roc30": roc30,
        },
        "signals": signals,
    }


# ---------------------------------------------------------------------------
# HTTP server
# ---------------------------------------------------------------------------

MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
}


class Handler(BaseHTTPRequestHandler):
    server_version = "BTCObserver/1.0"

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args), flush=True)

    def _send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, rel_path):
        safe_root = os.path.realpath(STATIC_DIR)
        full = os.path.realpath(os.path.join(STATIC_DIR, rel_path))
        if not full.startswith(safe_root + os.sep) and full != safe_root:
            self._send_json({"error": "forbidden"}, 403)
            return
        if not os.path.isfile(full):
            self._send_json({"error": "not found"}, 404)
            return
        ext = os.path.splitext(full)[1].lower()
        mime = MIME.get(ext, "application/octet-stream")
        with open(full, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/health":
            self._send_json({"ok": True, "ts": int(time.time() * 1000)})
            return

        if path == "/api/klines":
            qs = parse_qs(parsed.query)
            interval = qs.get("interval", ["1h"])[0]
            try:
                limit = int(qs.get("limit", ["500"])[0])
            except ValueError:
                limit = 500
            limit = max(10, min(limit, 1000))
            try:
                self._send_json({"symbol": SYMBOL, "interval": interval, "klines": get_klines(interval, limit)})
            except (HTTPError, URLError, TimeoutError, ValueError) as exc:
                self._send_json({"error": str(exc)}, 502)
            return

        if path == "/api/market":
            try:
                klines = get_klines("1h", 500)
                ticker = get_ticker()
                data = analyze(klines, ticker)
                data["etf"] = etf_summary(data["price"])
                try:
                    data["longTerm"] = analyze_long_term(get_klines("1d", 250))
                except (HTTPError, URLError, TimeoutError, ValueError, KeyError):
                    data["longTerm"] = {
                        "score": 0.0,
                        "label": "NEUTRAL",
                        "confidence": 0.0,
                        "details": {},
                        "signals": [],
                    }
                self._send_json(data)
            except (HTTPError, URLError, TimeoutError, ValueError, KeyError) as exc:
                self._send_json({"error": str(exc)}, 502)
            return

        if path == "/api/etf":
            try:
                ticker = get_ticker()
                price = float(ticker.get("lastPrice", 0.0))
                self._send_json(etf_summary(price))
            except (HTTPError, URLError, TimeoutError, ValueError, KeyError) as exc:
                self._send_json({"error": str(exc)}, 502)
            return

        if path == "/api/ticker":
            try:
                self._send_json(get_ticker())
            except (HTTPError, URLError, TimeoutError, ValueError) as exc:
                self._send_json({"error": str(exc)}, 502)
            return

        if path in ("/", ""):
            self._send_file("index.html")
            return

        self._send_file(path.lstrip("/"))


def main():
    parser = argparse.ArgumentParser(description="BTC Observer local server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"BTC Observer running on http://{args.host}:{args.port}", flush=True)
    print(f"Static dir: {STATIC_DIR}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
