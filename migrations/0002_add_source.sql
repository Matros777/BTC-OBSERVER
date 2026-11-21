-- Mark where a snapshot row came from: 'live' (real cron snapshot) or 'replay'
-- (walk-forward backfill computed from history after the fact).
ALTER TABLE forecast_snapshots ADD COLUMN source TEXT NOT NULL DEFAULT 'live';
