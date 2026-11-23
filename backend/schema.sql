-- Managemint schema (Cloudflare D1 / SQLite). Dates are local dates 'YYYY-MM-DD'; times 'HH:MM'.
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  description TEXT DEFAULT '',
  keywords TEXT DEFAULT '[]',          -- JSON array
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','done')),
  sort INTEGER NOT NULL DEFAULT 0,
  calendar INTEGER NOT NULL DEFAULT 1,  -- 0 = keep this project's tasks off Google Calendar
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS sections (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS captures (
  id TEXT PRIMARY KEY,
  transcript TEXT NOT NULL,
  forced_project_id TEXT,
  result_json TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','saved','discarded','undone')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  section_id TEXT REFERENCES sections(id),
  parent_id TEXT REFERENCES tasks(id),
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'task' CHECK (kind IN ('task','milestone')),
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','done','cancelled')),
  start_date TEXT,
  due_date TEXT,
  due_time TEXT,
  deadline TEXT,
  duration_min INTEGER,
  priority INTEGER NOT NULL DEFAULT 4 CHECK (priority BETWEEN 1 AND 4),
  calendar INTEGER NOT NULL DEFAULT 1,  -- 0 = keep this task off Google Calendar
  sort INTEGER NOT NULL DEFAULT 0,
  gcal_event_id TEXT,
  gcal_deadline_event_id TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('voice','manual','template')),
  capture_id TEXT REFERENCES captures(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS tasks_updated ON tasks(updated_at);
CREATE INDEX IF NOT EXISTS tasks_due ON tasks(due_date);

CREATE TABLE IF NOT EXISTS deps (
  task_id TEXT NOT NULL REFERENCES tasks(id),
  depends_on_id TEXT NOT NULL REFERENCES tasks(id),
  PRIMARY KEY (task_id, depends_on_id)
);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  body_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Server-only tables for setup, pairing and limits (migration 0002).

-- One row per paired phone/browser. Only the SHA-256 of the token is stored; the token itself is shown once.
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at TEXT,
  revoked_at TEXT
);

-- One-time pairing codes (10 minutes). Stored hashed.
CREATE TABLE IF NOT EXISTS pair_codes (
  code_hash TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

-- Google sign-in in progress (single-use, 10 minutes). Stored hashed.
CREATE TABLE IF NOT EXISTS oauth_states (
  nonce_hash TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL
);

-- Server settings written by the setup page (e.g. the Google refresh token and calendar id when they aren't secrets).
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Counters: daily Claude calls (key 'claude:YYYY-MM-DD') and failed setup/pairing attempts per hour.
CREATE TABLE IF NOT EXISTS counters (
  key TEXT PRIMARY KEY,
  n INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dailies (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  days TEXT NOT NULL DEFAULT '1111111',   -- Mon..Sun, 1 = due that day
  per_week INTEGER,                       -- set (1-6): N times a week on any day; days is ignored
  pauses TEXT NOT NULL DEFAULT '[]',      -- JSON [[from, to|null], ...] local dates
  color TEXT,                             -- accent name (design/accents.css) or null = theme colour
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
