// D1 store for the daily forecast scoreboard.
// Flow: the 09:00 UTC cron snapshots today's 24h forecast; the next day's run
// verifies it against the actual close. Verified rows are immutable — a cron
// re-run never rewrites history.

export const HORIZON_MS = 24 * 60 * 60 * 1000;

export function utcDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export async function saveSnapshot(db, snap) {
  await db
    .prepare(
      `INSERT INTO forecast_snapshots (day, ts, price_now, median, p10, p90, prob_up, confidence)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(day) DO UPDATE SET
         ts = excluded.ts, price_now = excluded.price_now, median = excluded.median,
         p10 = excluded.p10, p90 = excluded.p90, prob_up = excluded.prob_up, confidence = excluded.confidence
       WHERE forecast_snapshots.verified = 0`
    )
    .bind(snap.day, snap.ts, snap.price, snap.median, snap.p10, snap.p90, snap.probUp, snap.confidence)
    .run();
}

export async function hasSnapshotForDay(db, day) {
  const row = await db.prepare(`SELECT 1 AS x FROM forecast_snapshots WHERE day = ?1`).bind(day).first();
  return !!row;
}

export async function pendingSnapshots(db, nowMs) {
  const res = await db
    .prepare(
      `SELECT id, day, ts, price_now, median, p10, p90, prob_up
       FROM forecast_snapshots
       WHERE verified = 0 AND ts <= ?1
       ORDER BY ts ASC
       LIMIT 10`
    )
    .bind(nowMs - HORIZON_MS)
    .run();
  return res.results || [];
}

export async function verifySnapshot(db, row, factPrice, factTs) {
  const maePct = (Math.abs(row.median - factPrice) / factPrice) * 100;
  const dirUp = row.prob_up >= 0.5;
  const factUp = factPrice > row.price_now;
  const hitDir = dirUp === factUp ? 1 : 0;
  const inRange = factPrice >= row.p10 && factPrice <= row.p90 ? 1 : 0;
  await db
    .prepare(
      `UPDATE forecast_snapshots
       SET verified = 1, fact_ts = ?2, fact_price = ?3, hit_dir = ?4, in_range = ?5, mae_pct = ?6
       WHERE id = ?1`
    )
    .bind(row.id, factTs, factPrice, hitDir, inRange, Number(maePct.toFixed(4)))
    .run();
  return { hitDir, inRange, maePct };
}

const AGG_SQL = `SELECT
         COUNT(*) AS total,
         COALESCE(SUM(verified), 0) AS verified,
         AVG(CASE WHEN verified = 1 THEN hit_dir END) AS hit_rate,
         AVG(CASE WHEN verified = 1 THEN in_range END) AS in_range_rate,
         AVG(CASE WHEN verified = 1 THEN mae_pct END) AS mae_avg
       FROM forecast_snapshots
       WHERE source = 'live'`;

const shapeAgg = (a) => ({
  total: a ? a.total : 0,
  verified: a ? a.verified : 0,
  hit_rate: a && a.hit_rate != null ? a.hit_rate : null,
  in_range_rate: a && a.in_range_rate != null ? a.in_range_rate : null,
  mae_avg: a && a.mae_avg != null ? a.mae_avg : null,
});

export async function scoreboardData(db) {
  const [liveAgg, historyRes] = await Promise.all([
    db.prepare(AGG_SQL).first(),
    db
      .prepare(
        `SELECT day, ts, price_now, median, p10, p90, prob_up, confidence,
                verified, fact_price, hit_dir, in_range, mae_pct, source
         FROM forecast_snapshots
         WHERE source = 'live'
         ORDER BY ts DESC
         LIMIT 60`
      )
      .all(),
  ]);

  const rows = historyRes.results || [];

  // Streak: consecutive verified direction hits, newest first.
  let streak = 0;
  for (const r of rows) {
    if (!r.verified) continue;
    if (r.hit_dir === 1) streak += 1;
    else break;
  }

  const last = rows.find((r) => r.verified) || null;
  const live = shapeAgg(liveAgg);

  return {
    // Only real daily snapshots are shown. Walk-forward replay rows stay in D1
    // for offline analysis but never appear on the dashboard.
    summary: {
      ...live,
      pending: live.total - live.verified,
      streak,
    },
    last,
    history: rows.slice(0, 14),
    generated_at: Date.now(),
  };
}
