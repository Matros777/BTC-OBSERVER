// BTC Observer — indicator + signal engine (Cloudflare Pages Functions, JS port).

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const lastValid = (arr) => {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] !== null && arr[i] !== undefined && Number.isFinite(arr[i])) return arr[i];
  }
  return null;
};

const pstdev = (arr) => {
  if (!arr.length) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length);
};

export function sma(values, period) {
  const out = Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    total += values[i];
    if (i >= period) total -= values[i - period];
    if (i >= period - 1) out[i] = total / period;
  }
  return out;
}

export function ema(values, period) {
  const out = Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  out[period - 1] = seed / period;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

export function rsi(values, period = 14) {
  const out = Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    gains += Math.max(diff, 0);
    losses += Math.max(-diff, 0);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  const calc = (g, l) => (l === 0 ? 100 : 100 - 100 / (1 + g / l));
  out[period] = calc(avgGain, avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
    out[i] = calc(avgGain, avgLoss);
  }
  return out;
}

export function macd(values, fast = 12, slow = 26, signal = 9) {
  const fastEma = ema(values, fast);
  const slowEma = ema(values, slow);
  const line = values.map((_, i) =>
    fastEma[i] !== null && slowEma[i] !== null ? fastEma[i] - slowEma[i] : null
  );
  const start = line.findIndex((v) => v !== null);
  const sig = Array(values.length).fill(null);
  if (start >= 0) {
    const sub = line.slice(start).filter((v) => v !== null);
    const subEma = ema(sub, signal);
    for (let j = 0; j < subEma.length; j++) {
      if (subEma[j] !== null) sig[start + j] = subEma[j];
    }
  }
  const hist = values.map((_, i) =>
    line[i] !== null && sig[i] !== null ? line[i] - sig[i] : null
  );
  return { line, signal: sig, hist };
}

export function bollinger(values, period = 20, k = 2) {
  const middle = sma(values, period);
  const upper = Array(values.length).fill(null);
  const lower = Array(values.length).fill(null);
  const width = Array(values.length).fill(null);
  const percentB = Array(values.length).fill(null);
  for (let i = 0; i < values.length; i++) {
    if (middle[i] === null) continue;
    const window = values.slice(i - period + 1, i + 1);
    const sd = pstdev(window);
    upper[i] = middle[i] + k * sd;
    lower[i] = middle[i] - k * sd;
    if (middle[i]) width[i] = ((upper[i] - lower[i]) / middle[i]) * 100;
    const range = upper[i] - lower[i];
    percentB[i] = range ? (values[i] - lower[i]) / range : 0.5;
  }
  return { middle, upper, lower, width, percent_b: percentB };
}

export function atr(highs, lows, closes, period = 14) {
  const n = closes.length;
  const tr = Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (i === 0) tr[i] = highs[i] - lows[i];
    else tr[i] = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
  }
  const out = Array(n).fill(null);
  if (n < period) return out;
  out[period - 1] = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < n; i++) {
    out[i] = (out[i - 1] * (period - 1) + tr[i]) / period;
  }
  return out;
}

export function stochastic(highs, lows, closes, kPeriod = 14, dPeriod = 3) {
  const n = closes.length;
  const kLine = Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (i < kPeriod - 1) continue;
    const hh = Math.max(...highs.slice(i - kPeriod + 1, i + 1));
    const ll = Math.min(...lows.slice(i - kPeriod + 1, i + 1));
    kLine[i] = hh !== ll ? (100 * (closes[i] - ll)) / (hh - ll) : 50;
  }
  const dLine = Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const window = kLine.slice(Math.max(0, i - dPeriod + 1), i + 1).filter((v) => v !== null);
    if (window.length === dPeriod) dLine[i] = window.reduce((a, b) => a + b, 0) / dPeriod;
  }
  return { k: kLine, d: dLine };
}

export function adx(highs, lows, closes, period = 14) {
  const n = closes.length;
  const tr = Array(n).fill(0);
  const plusDm = Array(n).fill(0);
  const minusDm = Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const up = highs[i] - highs[i - 1];
    const down = lows[i - 1] - lows[i];
    plusDm[i] = up > down && up > 0 ? up : 0;
    minusDm[i] = down > up && down > 0 ? down : 0;
    tr[i] = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
  }
  const atrS = Array(n).fill(null);
  const plusS = Array(n).fill(null);
  const minusS = Array(n).fill(null);
  if (n <= period) return { adx: Array(n).fill(null), plus_di: Array(n).fill(null), minus_di: Array(n).fill(null) };
  atrS[period] = tr.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  plusS[period] = plusDm.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  minusS[period] = minusDm.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  for (let i = period + 1; i < n; i++) {
    atrS[i] = (atrS[i - 1] * (period - 1) + tr[i]) / period;
    plusS[i] = (plusS[i - 1] * (period - 1) + plusDm[i]) / period;
    minusS[i] = (minusS[i - 1] * (period - 1) + minusDm[i]) / period;
  }
  const plusDi = Array(n).fill(null);
  const minusDi = Array(n).fill(null);
  const dx = Array(n).fill(null);
  for (let i = period; i < n; i++) {
    if (atrS[i]) {
      plusDi[i] = (100 * plusS[i]) / atrS[i];
      minusDi[i] = (100 * minusS[i]) / atrS[i];
      const denom = plusDi[i] + minusDi[i];
      dx[i] = denom ? (100 * Math.abs(plusDi[i] - minusDi[i])) / denom : 0;
    }
  }
  const adxLine = Array(n).fill(null);
  const first = dx.findIndex((v) => v !== null);
  if (first >= 0 && first + period <= n) {
    adxLine[first + period - 1] = dx.slice(first, first + period).reduce((a, b) => a + b, 0) / period;
    for (let i = first + period; i < n; i++) {
      if (adxLine[i - 1] !== null && dx[i] !== null) {
        adxLine[i] = (adxLine[i - 1] * (period - 1) + dx[i]) / period;
      }
    }
  }
  return { adx: adxLine, plus_di: plusDi, minus_di: minusDi };
}

export function obv(closes, volumes) {
  const out = Array(closes.length).fill(0);
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) out[i] = out[i - 1] + volumes[i];
    else if (closes[i] < closes[i - 1]) out[i] = out[i - 1] - volumes[i];
    else out[i] = out[i - 1];
  }
  return out;
}

export function rollingVwap(highs, lows, closes, volumes, period = 24) {
  const n = closes.length;
  const out = Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    let pv = 0;
    let vol = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const typical = (highs[j] + lows[j] + closes[j]) / 3;
      pv += typical * volumes[j];
      vol += volumes[j];
    }
    out[i] = vol ? pv / vol : null;
  }
  return out;
}

export function cci(highs, lows, closes, period = 20) {
  const n = closes.length;
  const typical = highs.map((h, i) => (h + lows[i] + closes[i]) / 3);
  const out = Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    const window = typical.slice(i - period + 1, i + 1);
    const mean = window.reduce((a, b) => a + b, 0) / period;
    const meanDev = window.reduce((s, v) => s + Math.abs(v - mean), 0) / period;
    out[i] = meanDev ? (typical[i] - mean) / (0.015 * meanDev) : 0;
  }
  return out;
}

export function williamsR(highs, lows, closes, period = 14) {
  const n = closes.length;
  const out = Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    const hh = Math.max(...highs.slice(i - period + 1, i + 1));
    const ll = Math.min(...lows.slice(i - period + 1, i + 1));
    out[i] = hh !== ll ? (-100 * (hh - closes[i])) / (hh - ll) : -50;
  }
  return out;
}

export function mfi(highs, lows, closes, volumes, period = 14) {
  const n = closes.length;
  const typical = highs.map((h, i) => (h + lows[i] + closes[i]) / 3);
  const pos = Array(n).fill(0);
  const neg = Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const flow = typical[i] * volumes[i];
    if (typical[i] > typical[i - 1]) pos[i] = flow;
    else if (typical[i] < typical[i - 1]) neg[i] = flow;
  }
  const out = Array(n).fill(null);
  for (let i = period; i < n; i++) {
    const p = pos.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    const q = neg.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    out[i] = q ? 100 - 100 / (1 + p / q) : 100;
  }
  return out;
}

export function roc(values, period = 12) {
  const out = Array(values.length).fill(null);
  for (let i = period; i < values.length; i++) {
    out[i] = values[i - period] ? (values[i] / values[i - period] - 1) * 100 : null;
  }
  return out;
}

export function ichimoku(highs, lows, closes) {
  const n = closes.length;
  const midLine = (period) => {
    const out = Array(n).fill(null);
    for (let i = period - 1; i < n; i++) {
      out[i] = (Math.max(...highs.slice(i - period + 1, i + 1)) + Math.min(...lows.slice(i - period + 1, i + 1))) / 2;
    }
    return out;
  };
  const tenkan = midLine(9);
  const kijun = midLine(26);
  const senkouA = Array(n).fill(null);
  const senkouB = Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (tenkan[i] !== null && kijun[i] !== null) {
      const j = i + 26;
      if (j < n) senkouA[j] = (tenkan[i] + kijun[i]) / 2;
    }
    if (i >= 51) {
      const j = i + 26;
      if (j < n) senkouB[j] = (Math.max(...highs.slice(i - 51, i + 1)) + Math.min(...lows.slice(i - 51, i + 1))) / 2;
    }
  }
  const chikou = Array(n).fill(null);
  for (let i = 0; i < n - 26; i++) chikou[i] = closes[i + 26];
  return { tenkan, kijun, senkou_a: senkouA, senkou_b: senkouB, chikou };
}

export function fibLevels(highs, lows, lookback = 120) {
  const h = Math.max(...highs.slice(-lookback));
  const l = Math.min(...lows.slice(-lookback));
  const diff = h - l;
  const levels = {};
  for (const r of [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]) {
    levels[r.toFixed(3)] = h - diff * r;
  }
  return { high: h, low: l, levels };
}

export function pivotPoints(highs, lows, closes) {
  const h = Math.max(...highs.slice(-24));
  const l = Math.min(...lows.slice(-24));
  const c = closes[closes.length - 1];
  const p = (h + l + c) / 3;
  return {
    p,
    r1: 2 * p - l,
    s1: 2 * p - h,
    r2: p + (h - l),
    s2: p - (h - l),
    r3: h + 2 * (p - l),
    s3: l - 2 * (h - p),
  };
}

export function swingLevels(highs, lows, lookback = 200, wing = 3) {
  const start = Math.max(wing, highs.length - lookback);
  const hs = [];
  const ls = [];
  for (let i = start; i < highs.length - wing; i++) {
    if (highs[i] === Math.max(...highs.slice(i - wing, i + wing + 1))) hs.push(highs[i]);
    if (lows[i] === Math.min(...lows.slice(i - wing, i + wing + 1))) ls.push(lows[i]);
  }
  return { highs: hs.slice(-5), lows: ls.slice(-5) };
}

const gauss = () => {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

export function analyze(klines, ticker) {
  if (!klines || !klines.length) throw new Error("no klines");
  const closes = klines.map((k) => k.c);
  const highs = klines.map((k) => k.h);
  const lows = klines.map((k) => k.l);
  const volumes = klines.map((k) => k.v);
  const price = closes[closes.length - 1];

  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const rsi14 = rsi(closes, 14);
  const macdData = macd(closes);
  const bb = bollinger(closes);
  const atr14 = atr(highs, lows, closes, 14);
  const stoch = stochastic(highs, lows, closes);
  const adxData = adx(highs, lows, closes);
  const obvLine = obv(closes, volumes);
  const vwap24 = rollingVwap(highs, lows, closes, volumes, 24);
  const cci20 = cci(highs, lows, closes);
  const wr14 = williamsR(highs, lows, closes);
  const mfi14 = mfi(highs, lows, closes, volumes);
  const roc12 = roc(closes, 12);
  const ichi = ichimoku(highs, lows, closes);
  const fib = fibLevels(highs, lows);
  const piv = pivotPoints(highs, lows, closes);
  const swings = swingLevels(highs, lows);

  const e20 = lastValid(ema20);
  const e50 = lastValid(ema50);
  const e200 = lastValid(ema200);
  const rsiV = lastValid(rsi14);
  const macdV = lastValid(macdData.line);
  const macdSigV = lastValid(macdData.signal);
  const macdHistV = lastValid(macdData.hist);
  const bbUpper = lastValid(bb.upper);
  const bbLower = lastValid(bb.lower);
  const bbMid = lastValid(bb.middle);
  const bbPb = lastValid(bb.percent_b);
  const bbWidth = lastValid(bb.width);
  const atrV = lastValid(atr14);
  const stochK = lastValid(stoch.k);
  const stochD = lastValid(stoch.d);
  const adxV = lastValid(adxData.adx);
  const plusDi = lastValid(adxData.plus_di);
  const minusDi = lastValid(adxData.minus_di);
  const obvV = lastValid(obvLine);
  const vwapV = lastValid(vwap24);
  const cciV = lastValid(cci20);
  const wrV = lastValid(wr14);
  const mfiV = lastValid(mfi14);
  const rocV = lastValid(roc12);
  const tenkanV = lastValid(ichi.tenkan);
  const kijunV = lastValid(ichi.kijun);
  const senkouAV = lastValid(ichi.senkou_a);
  const senkouBV = lastValid(ichi.senkou_b);

  // ------------------------------------------------------------------
  // EMA cross: 20/50, 50/200, 20/200. Upward cross = BUY, downward = SELL.
  // ------------------------------------------------------------------
  const emaCross = (() => {
    const pairs = [
      ["20/50", ema20, ema50],
      ["50/200", ema50, ema200],
      ["20/200", ema20, ema200],
    ];
    const spreads = {};
    const events = [];
    for (const [name, a, b] of pairs) {
      const line = new Array(klines.length).fill(null);
      for (let i = 0; i < klines.length; i++) {
        const av = a[i];
        const bv = b[i];
        if (av === null || bv === null || !bv) continue;
        line[i] = (av / bv - 1) * 100;
        if (i === 0) continue;
        const prev = line[i - 1];
        if (prev === null) continue;
        if (prev <= 0 && line[i] > 0) events.push({ t: klines[i].t, dir: "up", pair: name });
        else if (prev >= 0 && line[i] < 0) events.push({ t: klines[i].t, dir: "down", pair: name });
      }
      spreads[name] = line;
    }
    events.sort((a, b) => a.t - b.t);
    const last = klines.length - 1;
    const sgn = (v) => (v === null || v === undefined ? 0 : v > 0 ? 1 : v < 0 ? -1 : 0);
    const s1 = sgn(spreads["20/50"][last]);
    const s2 = sgn(spreads["50/200"][last]);
    const s3 = sgn(spreads["20/200"][last]);
    const score = clamp(100 * (0.45 * s1 + 0.35 * s2 + 0.2 * s3), -100, 100);
    const state = s1 > 0 && s2 > 0 ? "bull" : s1 < 0 && s2 < 0 ? "bear" : "mixed";
    return {
      spreads,
      events,
      score: Number(score.toFixed(1)),
      state,
      label: state === "bull" ? "BUY" : state === "bear" ? "SELL" : "MIXED",
      stack: `20 ${s1 > 0 ? ">" : "<"} 50 ${s2 > 0 ? ">" : "<"} 200`,
      lastEvent: events.length ? events[events.length - 1] : null,
    };
  })();

  const signals = [];
  const add = (name, value, signal, score, weight = 1, note = "") => {
    signals.push({ name, value, signal, score: Number(clamp(score, -1, 1).toFixed(3)), weight, note });
  };

  if (e50) {
    const s = price > e50 ? 1 : -1;
    add("Price vs EMA50", `$${price.toFixed(0)} / $${e50.toFixed(0)}`, s > 0 ? "BULL" : "BEAR", s, 1.2);
  }
  if (e50 && e200) {
    const s = e50 > e200 ? 1 : -1;
    add("EMA50 vs EMA200", `$${e50.toFixed(0)} / $${e200.toFixed(0)}`, s > 0 ? "GOLDEN" : "DEATH", s, 1.2);
  }
  if (e20 && ema20.length > 6 && ema20[ema20.length - 6]) {
    const slope = (e20 / ema20[ema20.length - 6] - 1) * 100;
    add("EMA20 slope", `${slope >= 0 ? "+" : ""}${slope.toFixed(2)}% / 5h`, slope > 0 ? "UP" : "DOWN", clamp(slope / 2, -1, 1), 1);
  }
  if (macdHistV !== null && macdData.hist.length > 1) {
    const prev = lastValid(macdData.hist.slice(0, -1));
    let dir = macdHistV > 0 ? 1 : -1;
    if (prev !== null) dir = macdHistV > prev ? 1 : macdHistV < prev ? -1 : dir;
    add("MACD histogram", macdHistV.toFixed(1), macdHistV > 0 ? "BULL" : "BEAR", dir, 1.2);
  }
  if (macdV !== null) {
    const s = macdV > 0 ? 0.8 : macdV < 0 ? -0.8 : 0;
    add("MACD vs zero", macdV.toFixed(1), macdV > 0 ? "ABOVE" : "BELOW", s, 1);
  }
  if (adxV !== null && plusDi !== null && minusDi !== null) {
    const s = adxV >= 25 ? (plusDi > minusDi ? 1 : -1) : 0;
    add("ADX / DI", `${adxV.toFixed(1)} / +${plusDi.toFixed(1)} -${minusDi.toFixed(1)}`, adxV >= 25 ? "TREND" : "RANGE", s, 1);
  }
  if (rsiV !== null) {
    let s;
    let label;
    if (rsiV < 30) { s = 1; label = "OVERSOLD"; }
    else if (rsiV > 70) { s = -1; label = "OVERBOUGHT"; }
    else if (rsiV >= 50) { s = 0.35; label = "BULLISH"; }
    else { s = -0.35; label = "BEARISH"; }
    add("RSI 14", rsiV.toFixed(1), label, s, 1);
  }
  if (stochK !== null && stochD !== null) {
    let s;
    let label;
    if (stochK < 20 && stochK > stochD) { s = 1; label = "OVERSOLD CROSS"; }
    else if (stochK > 80 && stochK < stochD) { s = -1; label = "OVERBOUGHT CROSS"; }
    else { s = clamp((stochK - stochD) / 20, -0.6, 0.6); label = s > 0 ? "BULL" : "BEAR"; }
    add("Stochastic", `K ${stochK.toFixed(1)} / D ${stochD.toFixed(1)}`, label, s, 0.8);
  }
  if (cciV !== null) {
    let s;
    let label;
    if (cciV > 100) { s = -0.8; label = "OVERBOUGHT"; }
    else if (cciV < -100) { s = 0.8; label = "OVERSOLD"; }
    else { s = clamp(cciV / 200, -0.5, 0.5); label = "NEUTRAL"; }
    add("CCI 20", cciV.toFixed(1), label, s, 0.6);
  }
  if (wrV !== null) {
    let s;
    let label;
    if (wrV < -80) { s = 1; label = "OVERSOLD"; }
    else if (wrV > -20) { s = -1; label = "OVERBOUGHT"; }
    else { s = clamp((wrV + 50) / 50, -0.5, 0.5); label = "NEUTRAL"; }
    add("Williams %R", wrV.toFixed(1), label, s, 0.6);
  }
  if (mfiV !== null) {
    let s;
    let label;
    if (mfiV < 20) { s = 1; label = "OVERSOLD"; }
    else if (mfiV > 80) { s = -1; label = "OVERBOUGHT"; }
    else { s = clamp((50 - mfiV) / 50, -0.5, 0.5); label = "NEUTRAL"; }
    add("MFI 14", mfiV.toFixed(1), label, s, 0.6);
  }
  if (rocV !== null) {
    add("ROC 12", `${rocV >= 0 ? "+" : ""}${rocV.toFixed(2)}%`, rocV > 0 ? "UP" : "DOWN", clamp(rocV / 5, -1, 1), 0.8);
  }
  if (bbPb !== null) {
    let s;
    let label;
    if (bbPb < 0) { s = 1; label = "BELOW LOWER"; }
    else if (bbPb > 1) { s = -1; label = "ABOVE UPPER"; }
    else { s = clamp((0.5 - bbPb) * 2, -0.7, 0.7); label = "INSIDE BANDS"; }
    add("Bollinger %B", bbPb.toFixed(2), label, s, 0.7);
  }
  if (obvV !== null && obvLine.length > 24) {
    const prev = obvLine[obvLine.length - 25];
    const s = obvV > prev ? 1 : obvV < prev ? -1 : 0;
    add("OBV slope", obvV.toFixed(0), s > 0 ? "ACCUMULATION" : "DISTRIBUTION", s, 0.8);
  }
  if (vwapV) {
    const s = price > vwapV ? 0.5 : -0.5;
    add("VWAP 24h", `$${vwapV.toFixed(0)}`, s > 0 ? "ABOVE" : "BELOW", s, 0.6);
  }
  if (kijunV !== null) {
    let s = price > kijunV ? 0.5 : -0.5;
    if (tenkanV !== null) s += tenkanV > kijunV ? 0.5 : -0.5;
    add("Ichimoku", tenkanV ? `T ${tenkanV.toFixed(0)} / K ${kijunV.toFixed(0)}` : `K ${kijunV.toFixed(0)}`, s > 0 ? "BULL" : "BEAR", s, 0.7);
  }
  if (piv) {
    const s = price > piv.p ? 0.5 : -0.5;
    add("Pivot", `P $${piv.p.toFixed(0)}`, s > 0 ? "ABOVE" : "BELOW", s, 0.4);
  }

  add(
    "EMA CROSS",
    emaCross.stack,
    emaCross.label,
    emaCross.score / 100,
    0,
    emaCross.lastEvent
      ? `${emaCross.lastEvent.pair} ${emaCross.lastEvent.dir === "up" ? "▲" : "▼"} ${new Date(emaCross.lastEvent.t).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}`
      : "no cross yet"
  );

  const totalWeight = signals.reduce((a, s) => a + s.weight, 0) || 1;
  const compositeScore = (signals.reduce((a, s) => a + s.score * s.weight, 0) / totalWeight) * 100;
  let compositeLabel;
  if (compositeScore >= 60) compositeLabel = "STRONG BULLISH";
  else if (compositeScore >= 25) compositeLabel = "BULLISH";
  else if (compositeScore > -25) compositeLabel = "NEUTRAL";
  else if (compositeScore > -60) compositeLabel = "BEARISH";
  else compositeLabel = "STRONG BEARISH";
  const adxForConf = adxV !== null ? adxV : 20;
  let confidence = clamp(35 + Math.abs(compositeScore) * 0.45 + Math.min(adxForConf, 50) * 0.4, 0, 95);
  if (adxForConf < 20) confidence *= 0.8;

  const returns = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0 && closes[i] > 0) returns.push(Math.log(closes[i] / closes[i - 1]));
  }
  const recent = returns.slice(-72);
  const volWindow = returns.slice(-168);
  let mu = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
  let sigma = volWindow.length > 1 ? pstdev(volWindow) : 0.01;
  if (e20 && ema20.length > 6 && ema20[ema20.length - 6]) {
    const slope = (e20 / ema20[ema20.length - 6] - 1) / 5;
    if (slope > -0.99) mu = 0.5 * mu + 0.5 * Math.log(1 + slope);
  }
  sigma = Math.max(sigma, 0.0005);
  mu = clamp(mu, -sigma * 0.5, sigma * 0.5);

  const steps = 24;
  const simulations = 1000;
  const finals = [];
  const paths = [];
  for (let n = 0; n < simulations; n++) {
    let p = price;
    const path = [p];
    for (let s = 0; s < steps; s++) {
      p *= Math.exp(mu + sigma * gauss());
      path.push(p);
    }
    finals.push(p);
    paths.push(path);
  }
  finals.sort((a, b) => a - b);
  const medianFinal = finals[Math.floor(finals.length / 2)];
  const p10 = finals[Math.floor(0.1 * finals.length)];
  const p90 = finals[Math.floor(0.9 * finals.length)];
  const probUp = finals.filter((f) => f > price).length / finals.length;
  let medianPath = paths[0];
  let bestDiff = Math.abs(medianPath[steps] - medianFinal);
  for (const path of paths) {
    const diff = Math.abs(path[steps] - medianFinal);
    if (diff < bestDiff) {
      bestDiff = diff;
      medianPath = path;
    }
  }
  const forecastConfidence = clamp(30 + Math.abs(compositeScore) * 0.4 + Math.min(adxForConf, 50) * 0.4, 0, 90);

  const tailN = 240;
  const start = Math.max(0, klines.length - tailN);
  const tail = (series) => series.slice(start);

  const chart = {
    candles: klines.slice(start),
    ema20: tail(ema20),
    ema50: tail(ema50),
    ema200: tail(ema200),
    bb_upper: tail(bb.upper),
    bb_lower: tail(bb.lower),
    bb_mid: tail(bb.middle),
    rsi: tail(rsi14),
    macd: tail(macdData.line),
    macd_signal: tail(macdData.signal),
    macd_hist: tail(macdData.hist),
    volume: klines.slice(start).map((k) => k.v),
    ema_cross: {
      p2050: tail(emaCross.spreads["20/50"]),
      p50200: tail(emaCross.spreads["50/200"]),
      events: emaCross.events.filter((ev) => ev.t >= klines[start].t),
    },
  };

  return {
    symbol: "BTCUSDT",
    price,
    ticker: {
      change24h: Number(ticker.priceChangePercent || 0),
      change24hAbs: Number(ticker.priceChange || 0),
      high24h: Number(ticker.highPrice || 0),
      low24h: Number(ticker.lowPrice || 0),
      volume24h: Number(ticker.volume || 0),
      quoteVolume24h: Number(ticker.quoteVolume || 0),
      trades24h: Number(ticker.count || 0),
    },
    indicators: {
      ema20: e20,
      ema50: e50,
      ema200: e200,
      rsi14: rsiV,
      macd: macdV,
      macd_signal: macdSigV,
      macd_hist: macdHistV,
      bb_upper: bbUpper,
      bb_mid: bbMid,
      bb_lower: bbLower,
      bb_percent_b: bbPb,
      bb_width: bbWidth,
      atr14: atrV,
      stoch_k: stochK,
      stoch_d: stochD,
      adx: adxV,
      plus_di: plusDi,
      minus_di: minusDi,
      obv: obvV,
      vwap24: vwapV,
      cci20: cciV,
      williams_r: wrV,
      mfi14: mfiV,
      roc12: rocV,
      tenkan: tenkanV,
      kijun: kijunV,
      senkou_a: senkouAV,
      senkou_b: senkouBV,
    },
    signals,
    composite: {
      score: Number(compositeScore.toFixed(1)),
      label: compositeLabel,
      confidence: Number(confidence.toFixed(1)),
    },
    emaCross: {
      score: emaCross.score,
      state: emaCross.state,
      label: emaCross.label,
      stack: emaCross.stack,
      lastEvent: emaCross.lastEvent,
    },
    prediction: {
      horizon: "24h",
      current: price,
      median: medianFinal,
      p10,
      p90,
      probUp,
      changePct: (medianFinal / price - 1) * 100,
      rangeLow: p10,
      rangeHigh: p90,
      confidence: Number(forecastConfidence.toFixed(1)),
      path: medianPath,
      method: "Monte Carlo GBM · 2000 paths · 1h steps · 24h horizon",
      disclaimer: "Probabilistic model, not financial advice.",
    },
    levels: {
      fibonacci: fib,
      pivots: piv,
      swing_highs: swings.highs,
      swing_lows: swings.lows,
      support: swings.lows.length ? Math.min(...swings.lows) : fib.low,
      resistance: swings.highs.length ? Math.max(...swings.highs) : fib.high,
    },
    chart,
    updatedAt: Date.now(),
  };
}

export function analyzeLongTerm(klines) {
  if (!klines || klines.length < 50) {
    return { score: 0, label: "NEUTRAL", confidence: 0, details: {}, signals: [] };
  }
  const closes = klines.map((k) => k.c);
  const highs = klines.map((k) => k.h);
  const lows = klines.map((k) => k.l);
  const price = closes[closes.length - 1];
  const e50 = lastValid(ema(closes, 50));
  const e200 = lastValid(ema(closes, 200));
  const rsiV = lastValid(rsi(closes, 14));
  const macdData = macd(closes);
  const histV = lastValid(macdData.hist);
  const adxData = adx(highs, lows, closes);
  const adxV = lastValid(adxData.adx);
  const plusDi = lastValid(adxData.plus_di);
  const minusDi = lastValid(adxData.minus_di);
  const roc30 = closes.length >= 31 && closes[closes.length - 31]
    ? (price / closes[closes.length - 31] - 1) * 100
    : null;

  const signals = [];
  const add = (name, value, signal, score, weight = 1) => {
    signals.push({ name, value, signal, score: Number(clamp(score, -1, 1).toFixed(3)), weight });
  };
  if (e200) {
    const s = price > e200 ? 1 : -1;
    add("Price vs EMA200", `$${price.toFixed(0)} / $${e200.toFixed(0)}`, s > 0 ? "BULL" : "BEAR", s, 1.5);
  }
  if (e50 && e200) {
    const s = e50 > e200 ? 1 : -1;
    add("EMA50 vs EMA200", `$${e50.toFixed(0)} / $${e200.toFixed(0)}`, s > 0 ? "GOLDEN" : "DEATH", s, 1.5);
  }
  if (rsiV !== null) {
    let s;
    let label;
    if (rsiV < 30) { s = 1; label = "OVERSOLD"; }
    else if (rsiV > 70) { s = -1; label = "OVERBOUGHT"; }
    else if (rsiV >= 50) { s = 0.3; label = "BULLISH"; }
    else { s = -0.3; label = "BEARISH"; }
    add("Daily RSI 14", rsiV.toFixed(1), label, s, 1);
  }
  if (histV !== null) {
    add("Daily MACD", histV.toFixed(1), histV > 0 ? "BULL" : "BEAR", histV > 0 ? 1 : -1, 1.2);
  }
  if (roc30 !== null) {
    add("30D ROC", `${roc30 >= 0 ? "+" : ""}${roc30.toFixed(1)}%`, roc30 > 0 ? "UP" : "DOWN", clamp(roc30 / 15, -1, 1), 1);
  }
  if (adxV !== null && plusDi !== null && minusDi !== null) {
    const s = adxV >= 25 ? (plusDi > minusDi ? 1 : -1) : 0;
    add("Daily ADX", adxV.toFixed(1), adxV >= 25 ? "TREND" : "RANGE", s, 1);
  }
  const totalWeight = signals.reduce((a, s) => a + s.weight, 0) || 1;
  const composite = (signals.reduce((a, s) => a + s.score * s.weight, 0) / totalWeight) * 100;
  let label;
  if (composite >= 50) label = "STRONG BULLISH";
  else if (composite >= 20) label = "BULLISH";
  else if (composite > -20) label = "NEUTRAL";
  else if (composite > -50) label = "BEARISH";
  else label = "STRONG BEARISH";
  const confidence = clamp(40 + Math.abs(composite) * 0.45 + Math.min(adxV || 20, 50) * 0.3, 0, 95);
  return {
    score: Number(composite.toFixed(1)),
    label,
    confidence: Number(confidence.toFixed(1)),
    details: { price, ema50: e50, ema200: e200, rsi14: rsiV, macdHist: histV, adx: adxV, roc30 },
    signals,
  };
}
