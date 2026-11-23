#!/usr/bin/env node
// Walk-forward replay backfill for the Forecast Scoreboard.
//
// For every requested day D (snapshot moment = D 09:00 UTC) this script:
//   1. fetches the 500 hourly candles STRICTLY BEFORE that moment,
//   2. runs the exact production model (functions/_lib/analysis.js) on them,
//   3. fetches the actual 1-minute close at D+24h,
//   4. emits a verified INSERT with source='replay'.
//
// No future data leaks into the model: indicators and the Monte Carlo run are
// computed only from candles that existed at the snapshot moment. The Monte
// Carlo path sampling is nondeterministic (Math.random), so replay values are
// a faithful *redraw* of the same distribution, not the numbers a live run
// would have shown — this is why rows are labelled 'replay' in the UI.
//
// Usage:
//   node scripts/backfill_forecast.mjs 2026-11-18 2026-11-19 2026-11-20
//        > /tmp/backfill.sql
//   npx wrangler d1 execute DB --config wrangler.toml [--local|--remote] \
//        --file /tmp/backfill.sql -y

import { analyze } from "../functions/_lib/analysis.js";

const PROVIDERS = [
  { name: "mexc", base: "https://api.mexc.com", interval: (v) => (v === "1h" ? "60m" : v) },
  { name: "binance-vision", base: "https://data-api.binance.vision", interval: (v) => v },
  { name: "binance", base: "https://api.binance.com", interval: (v) => v },
];

const HOUR = 3600_000;
const HORIZON = 24 * HOUR;
const SNAPSHOT_HOUR_UTC = 9;

async function fetchJson(url) {
  let lastErr = null;
  for (const p of [url]) {
    try {
      const res = await fetch(p, { headers: { "User-Agent": "btc-observer-backfill/1.0" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

async function getKlinesUntil(interval, limit, endTimeMs) {
  let lastErr = null;
  for (const provider of PROVIDERS) {
    try {
      const url =
        `${provider.base}/api/v3/klines?symbol=BTCUSDT&interval=${provider.interval(interval)}` +
        `&endTime=${endTimeMs}&limit=${limit}`;
      const raw = await fetchJson(url);
      if (!Array.isArray(raw) || raw.length < 250) throw new Error(`too few candles: ${raw?.length}`);
      const rows = raw.map((k) => ({
        t: Number(k[0]), o: Number(k[1]), h: Number(k[2]), l: Number(k[3]),
        c: Number(k[4]), v: Number(k[5]), ct: Number(k[6]), qv: Number(k[7]),
        n: Number(k[8] || 0), tb: Number(k[9] || 0), tq: Number(k[10] || 0),
      }));
      // Provider sanity: the returned candles must actually END at the requested
      // boundary. MEXC silently ignores endTime and returns the latest candles —
      // detect that and fall through to the next provider.
      const lastOpen = rows[rows.length - 1].t;
      if (lastOpen > endTimeMs || lastOpen <= endTimeMs - 2 * HOUR) {
        throw new Error(`endTime not honored: last open ${new Date(lastOpen).toISOString()}`);
      }
      return rows;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

async function getCloseAt(tsMs) {
  const start = tsMs - 60_000;
  for (const provider of PROVIDERS) {
    try {
      const url = `${provider.base}/api/v3/klines?symbol=BTCUSDT&interval=1m&startTime=${start}&limit=1`;
      const raw = await fetchJson(url);
      if (!Array.isArray(raw) || raw.length === 0) throw new Error("empty");
      if (Number(raw[0][0]) !== start) throw new Error("startTime not honored");
      return Number(raw[0][4]);
    } catch (e) {
      /* next provider */
    }
  }
  throw new Error(`no fact price at ${new Date(tsMs).toISOString()}`);
}

// Reconstruct a 24h ticker from the last 24 candles so analyze() has a ticker
// shaped like the production one (prediction itself only needs the klines).
function makeTicker(klines, price) {
  const w = klines.slice(-24);
  const first = w[0].o;
  const hi = Math.max(...w.map((k) => k.h));
  const lo = Math.min(...w.map((k) => k.l));
  const vol = w.reduce((s, k) => s + k.v, 0);
  const qvol = w.reduce((s, k) => s + k.qv, 0);
  const chg = price - first;
  return {
    priceChangePercent: String(((price / first - 1) * 100).toFixed(4)),
    priceChange: String(chg.toFixed(2)),
    highPrice: String(hi),
    lowPrice: String(lo),
    volume: String(vol),
    quoteVolume: String(qvol),
    count: String(w.reduce((s, k) => s + (k.n || 0), 0)),
  };
}

const esc = (v) => (typeof v === "number" && Number.isFinite(v) ? String(v) : "NULL");
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

const days = process.argv.slice(2);
if (days.length === 0) {
  console.error("usage: node scripts/backfill_forecast.mjs YYYY-MM-DD [YYYY-MM-DD ...]");
  process.exit(1);
}

const rows = [];
for (const day of days) {
  const snapMs = Date.parse(`${day}T09:00:00Z`);
  if (Number.isNaN(snapMs)) throw new Error(`bad day: ${day}`);
  if (snapMs + HORIZON > Date.now()) {
    console.error(`skip ${day}: horizon not reached yet`);
    continue;
  }

  const klines = await getKlinesUntil("1h", 500, snapMs);
  const price = klines[klines.length - 1].c;
  const data = analyze(klines, makeTicker(klines, price), { seed: Number(day.replace(/-/g, "")) });
  const p = data.prediction;

  const factTs = snapMs + HORIZON;
  const factPrice = await getCloseAt(factTs);

  const dirUp = p.probUp >= 0.5;
  const hitDir = dirUp === factPrice > price ? 1 : 0;
  const inRange = factPrice >= p.p10 && factPrice <= p.p90 ? 1 : 0;
  const mae = (Math.abs(p.median - factPrice) / factPrice) * 100;

  rows.push({ day, snapMs, price, p, factTs, factPrice, hitDir, inRange, mae });

  console.error(
    `${day}: price $${price.toFixed(0)} → median $${p.median.toFixed(0)} ` +
      `(P10 $${p.p10.toFixed(0)}–P90 $${p.p90.toFixed(0)}, pUp ${(p.probUp * 100).toFixed(0)}%) | ` +
      `fact $${factPrice.toFixed(0)} | dir ${hitDir ? "HIT" : "MISS"}, range ${inRange ? "IN" : "OUT"}, ` +
      `err ${mae.toFixed(2)}%`
  );
}

console.log("-- generated by scripts/backfill_forecast.mjs (source='replay')");
for (const r of rows) {
  console.log(
    `INSERT OR REPLACE INTO forecast_snapshots ` +
      `(day, ts, price_now, median, p10, p90, prob_up, confidence, verified, fact_ts, fact_price, hit_dir, in_range, mae_pct, source) ` +
      `VALUES ('${r.day}', ${r.snapMs}, ${esc(r.price)}, ${esc(num(r.p.median))}, ${esc(num(r.p.p10))}, ` +
      `${esc(num(r.p.p90))}, ${esc(num(r.p.probUp))}, ${esc(num(r.p.confidence))}, 1, ${r.factTs}, ` +
      `${esc(r.factPrice)}, ${r.hitDir}, ${r.inRange}, ${esc(Number(r.mae.toFixed(4)))}, 'replay');`
  );
}
