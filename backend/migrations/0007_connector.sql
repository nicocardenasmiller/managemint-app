-- Nov 2026: assistant connector sign-in (OAuth 2.1 with PKCE, see src/oauth.ts). Server-only tables: the phone app
-- never syncs these, so no Room change. Applied automatically by `npm run deploy`.

-- Assistant apps register themselves before signing in (dynamic client registration). Public clients, no secret.
CREATE TABLE IF NOT EXISTS oauth_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,          -- JSON array
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- One-time sign-in codes (5 minutes), bound to the client, its redirect address and the PKCE challenge. Stored hashed.
CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

-- One row per approved assistant. Tokens are stored hashed; removing the row's access (revoked_at) signs it out.
CREATE TABLE IF NOT EXISTS connector_grants (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  access_hash TEXT NOT NULL UNIQUE,
  access_expires_at TEXT NOT NULL,
  refresh_hash TEXT NOT NULL UNIQUE,
  refresh_expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_used_at TEXT,
  revoked_at TEXT
);
