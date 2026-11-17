// BTC spot ETF flows (farside, $M) — 2-week window.

export const ETF_DATASET = {
  "2026-10-27": { total: 176.1, ibit: null, fbtc: null, src: "memory-reconstructed" },
  "2026-10-28": { total: 137.3, ibit: 136.0, fbtc: 0.0, src: "farside" },
  "2026-10-29": { total: 17.2, ibit: 12.8, fbtc: 10.5, src: "farside" },
  "2026-10-30": { total: -643.2, ibit: -233.7, fbtc: -201.0, src: "farside" },
  "2026-11-02": { total: -398.6, ibit: -405.3, fbtc: 6.7, src: "farside" },
  "2026-11-03": { total: -115.6, ibit: -95.0, fbtc: 6.8, src: "farside" },
  "2026-11-04": { total: 74.6, ibit: -201.2, fbtc: 236.7, src: "farside" },
  "2026-11-05": { total: -430.2, ibit: -105.0, fbtc: -199.9, src: "farside" },
  "2026-11-06": { total: -411.9, ibit: -403.0, fbtc: 42.8, src: "farside" },
  "2026-11-09": { total: -201.0, ibit: -213.2, fbtc: 0.0, src: "farside" },
  "2026-11-10": { total: -95.0, ibit: -78.2, fbtc: -36.8, src: "farside" },
  "2026-11-11": { total: -299.8, ibit: -269.7, fbtc: 0.0, src: "farside" },
  "2026-11-12": { total: -284.1, ibit: -203.8, fbtc: -32.6, src: "farside" },
  "2026-11-13": { total: -185.4, ibit: -143.5, fbtc: -41.9, src: "farside" },
  "2026-11-16": { total: 7.9, ibit: 76.5, fbtc: -11.3, src: "farside" },
};

export const ETF_ISSUANCE_BTC = 450;
export const ETF_TH_RED = -250;

export function etfVerdict(total, ibit) {
  if (total > 0) return ibit !== null && ibit > 0 ? "FLASH-BUY" : "FLASH-FAKE";
  if (total >= ETF_TH_RED) return "YELLOW";
  return "RED";
}

export function etfSummary(price, limit = 10, dataset = ETF_DATASET) {
  const days = Object.keys(dataset || {}).sort();
  const window = days.slice(-limit);
  const rows = window.map((day) => {
    const item = dataset[day];
    const total = Number(item.total);
    const ibit = item.ibit === null || item.ibit === undefined ? null : Number(item.ibit);
    const fbtc = item.fbtc === null || item.fbtc === undefined ? null : Number(item.fbtc);
    return { date: day, total, ibit, fbtc, verdict: etfVerdict(total, ibit), src: item.src || "farside" };
  });

  const totals = rows.map((r) => r.total);
  const net = totals.reduce((a, b) => a + b, 0);
  const inflows = totals.filter((v) => v > 0).reduce((a, b) => a + b, 0);
  const outflows = totals.filter((v) => v < 0).reduce((a, b) => a + b, 0);
  const greenDays = totals.filter((v) => v > 0).length;
  const redDays = totals.filter((v) => v < 0).length;
  const ibitNet = rows.reduce((a, r) => a + (r.ibit || 0), 0);
  const fbtcNet = rows.reduce((a, r) => a + (r.fbtc || 0), 0);
  const avgDaily = rows.length ? net / rows.length : 0;
  const issuanceM = price ? (ETF_ISSUANCE_BTC * price) / 1e6 : 0;
  const pressure = issuanceM ? Math.abs(avgDaily) / issuanceM : 0;

  const flowScore = issuanceM ? Math.tanh(avgDaily / issuanceM / 3) * 100 : 0;
  const recent3 = totals.length >= 3 ? totals.slice(-3).reduce((a, b) => a + b, 0) : net;
  const prev3 = totals.length >= 6 ? totals.slice(-6, -3).reduce((a, b) => a + b, 0) : 0;
  const momentum = issuanceM ? Math.tanh((recent3 - prev3) / (3 * issuanceM * 2)) * 100 : 0;
  const score = Math.max(-100, Math.min(100, 0.7 * flowScore + 0.3 * momentum));

  let label;
  if (score >= 50) label = "STRONG BULLISH";
  else if (score >= 20) label = "BULLISH";
  else if (score > -20) label = "NEUTRAL";
  else if (score > -50) label = "BEARISH";
  else label = "STRONG BEARISH";

  const last5 = totals.length >= 5 ? totals.slice(-5).reduce((a, b) => a + b, 0) : net;
  const prev5 = totals.length >= 10 ? totals.slice(-10, -5).reduce((a, b) => a + b, 0) : 0;
  const wow = prev5 ? last5 / prev5 : null;

  let best = null;
  let worst = null;
  for (const r of rows) {
    if (!best || r.total > best.total) best = r;
    if (!worst || r.total < worst.total) worst = r;
  }
  const last = rows.length ? rows[rows.length - 1] : null;

  return {
    window: {
      start: rows.length ? rows[0].date : null,
      end: rows.length ? rows[rows.length - 1].date : null,
      days: rows.length,
      label: "2W",
    },
    daily: rows,
    summary: {
      net: Number(net.toFixed(1)),
      inflows: Number(inflows.toFixed(1)),
      outflows: Number(outflows.toFixed(1)),
      greenDays,
      redDays,
      avgDaily: Number(avgDaily.toFixed(1)),
      ibitNet: Number(ibitNet.toFixed(1)),
      fbtcNet: Number(fbtcNet.toFixed(1)),
      best: best ? { date: best.date, total: best.total } : null,
      worst: worst ? { date: worst.date, total: worst.total } : null,
      wow: wow === null ? null : Number(wow.toFixed(3)),
      pressure: Number(pressure.toFixed(2)),
      issuanceM: Number(issuanceM.toFixed(2)),
      last,
      lastVerdict: last ? last.verdict : "YELLOW",
      tail: totals.slice(-3).map((v) => Number(v.toFixed(1))),
    },
    score: Number(score.toFixed(1)),
    label,
    method: "farside spot BTC ETF net flows, $M; 10 trading days; flow pressure vs 450 BTC/day issuance",
    disclaimer: "ETF flows are historical data, not a forecast. Not financial advice.",
    updatedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Live days (2026-11-17+) are published by the daily sync into static/etf-live.json
// and merged on top of the embedded seed, so the 2-week window slides by itself.
// ---------------------------------------------------------------------------

export function mergeEtfDatasets(liveDays) {
  const clean = {};
  const src = liveDays && typeof liveDays === "object" ? liveDays : {};
  for (const [day, item] of Object.entries(src)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !item) continue;
    const total = Number(item.total);
    if (!Number.isFinite(total)) continue;
    const toNum = (v) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
    clean[day] = { total, ibit: toNum(item.ibit), fbtc: toNum(item.fbtc), src: item.src || "farside" };
  }
  return { ...ETF_DATASET, ...clean };
}

export async function loadEtfDataset() {
  const stamp = new Date().toISOString().slice(0, 13); // hourly cache-buster
  try {
    const res = await fetch(`/etf-live.json?v=${stamp}`, { cache: "no-store" });
    if (!res.ok) return ETF_DATASET;
    const payload = await res.json();
    return mergeEtfDatasets(payload && payload.days);
  } catch {
    return ETF_DATASET;
  }
}
