-- Forecast Scoreboard: daily self-audit of the 24h Monte Carlo forecast.
-- ts is unix milliseconds (UTC). One row per UTC day (unique index on `day`).

CREATE TABLE IF NOT EXISTS forecast_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,
  ts INTEGER NOT NULL,
  price_now REAL NOT NULL,
  median REAL NOT NULL,
  p10 REAL,
  p90 REAL,
  prob_up REAL,
  confidence REAL,
  verified INTEGER NOT NULL DEFAULT 0,
  fact_ts INTEGER,
  fact_price REAL,
  hit_dir INTEGER,
  in_range INTEGER,
  mae_pct REAL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_forecast_day ON forecast_snapshots(day);
