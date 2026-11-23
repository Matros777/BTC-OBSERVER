// Forecast self-audit job: snapshot today's forecast, verify yesterday's.
// Runs from the 09:00 UTC cron trigger, and lazily from /api/market when
// today's snapshot is missing (fresh deploy or a missed cron run).

import { getKlines, getTicker, getCloseAt } from "./binance.js";
import { analyze } from "./analysis.js";
import {
  saveSnapshot,
  hasSnapshotForDay,
  pendingSnapshots,
  verifySnapshot,
  HORIZON_MS,
  utcDay,
} from "./forecast-store.js";

export async function runForecastJob(env) {
  const now = Date.now();
  const out = { snapshot: null, verified: [], errors: [] };

  if (!env.DB) {
    out.errors.push("D1 binding (DB) is not configured");
    return out;
  }

  // 1) Snapshot today's forecast — the exact same pipeline the dashboard uses.
  try {
    const [klines, ticker] = await Promise.all([getKlines("1h", 500), getTicker()]);
    const data = analyze(klines, ticker);
    const p = data.prediction;
    const snap = {
      day: utcDay(now),
      ts: now,
      price: data.price,
      median: p.median,
      p10: p.p10,
      p90: p.p90,
      probUp: p.probUp,
      confidence: p.confidence,
    };
    await saveSnapshot(env.DB, snap);
    out.snapshot = snap;
  } catch (e) {
    out.errors.push(`snapshot: ${e && e.message ? e.message : e}`);
  }

  // 2) Verify every snapshot whose 24h horizon has passed.
  const v = await verifyDue(env, now);
  out.verified = v.verified;
  out.errors.push(...v.errors);

  return out;
}

// Verify every snapshot whose 24h horizon has passed. Kept separate from the
// snapshot step so a page-load bootstrap can catch up after a missed cron run
// without rewriting today's snapshot timestamp.
export async function verifyDue(env, nowMs = Date.now()) {
  const out = { verified: [], errors: [] };
  if (!env.DB) return out;
  try {
    const due = await pendingSnapshots(env.DB, nowMs);
    for (const row of due) {
      try {
        const factTs = row.ts + HORIZON_MS;
        const factPrice = await getCloseAt(factTs);
        if (!factPrice || factPrice <= 0) throw new Error("no fact price");
        const res = await verifySnapshot(env.DB, row, factPrice, factTs);
        out.verified.push({ day: row.day, ...res });
      } catch (e) {
        out.errors.push(`verify ${row.day}: ${e && e.message ? e.message : e}`);
      }
    }
  } catch (e) {
    out.errors.push(`pending: ${e && e.message ? e.message : e}`);
  }
  return out;
}

// Lazy bootstrap: one indexed SELECT per /api/market call. Runs the full job
// when today's row is missing (fresh deploy or a missed cron snapshot) and
// still retries overdue verifications without touching today's row.
// Race-safe: the day-level unique index plus the verified-guarded upsert make
// concurrent runs converge on one row.
export async function bootstrapToday(env) {
  if (!env.DB) return;
  const now = Date.now();
  const today = utcDay(now);
  if (!(await hasSnapshotForDay(env.DB, today))) {
    await runForecastJob(env);
    return;
  }
  await verifyDue(env, now);
}
