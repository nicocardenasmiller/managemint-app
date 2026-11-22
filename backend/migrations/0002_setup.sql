-- Nov 2026: friends' self-deployed copies. Server-only tables (the phone app never syncs these, so no Room change).
-- Applied automatically by `npm run deploy`.

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
