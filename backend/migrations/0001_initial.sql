-- Initial schema (Nov 2026). Safe to run on an existing database: everything is IF NOT EXISTS / INSERT OR IGNORE,
-- so on Nico's live database (already at this schema) it only records itself in d1_migrations.
-- Applied automatically by `npm run deploy` (wrangler d1 migrations apply). Future changes: 0002_..., never edit this file.
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

-- Every copy needs the Inbox (fixed id 'inbox'). Personal is a sensible default for a new user.
-- Starting projects (Nico, Nov 22: only these three; the rest get added via the API while testing). 'inbox' must exist.
INSERT OR IGNORE INTO projects (id,name,color,description,keywords,sort) VALUES ('inbox','Inbox','#8a8f98','Anything that does not clearly fit another project.','[]',0);
INSERT OR IGNORE INTO projects (id,name,color,description,keywords,sort) VALUES ('personal','Personal','#7a9a8a','Errands, family, health, apartment, bills, travel, sport.','["buy", "call", "rent", "flights", "gym", "soccer"]',2);
