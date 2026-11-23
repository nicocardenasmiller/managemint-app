-- Dailies: small things to do every day (a habit list). One row per daily, one row per daily per day it was checked.
CREATE TABLE IF NOT EXISTS dailies (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS daily_checks (
  daily_id TEXT NOT NULL REFERENCES dailies(id),
  date TEXT NOT NULL,            -- YYYY-MM-DD, the user's local day
  done INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (daily_id, date)
);
CREATE INDEX IF NOT EXISTS daily_checks_updated ON daily_checks(updated_at);
