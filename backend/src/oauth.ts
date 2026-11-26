// Sign-in for the assistant connector (connector.ts): a minimal OAuth 2.1 authorization server, as the MCP spec asks.
//   1. The assistant app finds this server from the 401 on /mcp → /.well-known/oauth-protected-resource →
//      /.well-known/oauth-authorization-server.
//   2. It registers itself (POST /oauth/register) and opens /oauth/authorize in the person's browser.
//   3. The person approves there with the setup password, or with one tap if that browser is already signed in.
//   4. The app swaps the one-time code (with its PKCE verifier) for tokens at POST /oauth/token.
// Connector tokens only work on /mcp, and device tokens don't work on /mcp. Everything secret is stored hashed.
import { randomToken, sha256, type AccessEnv } from "./access";

export const SCOPE = "checklists";
export const ACCESS_PREFIX = "mmc_";
export const REFRESH_PREFIX = "mmr_";
export const ACCESS_SECONDS = 3600;
export const REFRESH_DAYS = 60;
const CODE_SECONDS = 300;
const MAX_CLIENTS = 200;

const nowIso = () => new Date().toISOString();
const later = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();

export const resourceUrl = (origin: string) => `${origin}/mcp`;

export function protectedResourceMetadata(origin: string) {
  return { resource: resourceUrl(origin), authorization_servers: [origin], scopes_supported: [SCOPE], bearer_methods_supported: ["header"], resource_name: "Managemint" };
}

export function authServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [SCOPE],
  };
}

/** The WWW-Authenticate header on a 401 from /mcp, which tells the assistant app where to sign in. */
export const challenge = (origin: string, error?: string) =>
  `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"${error ? `, error="${error}"` : ""}, scope="${SCOPE}"`;

// ---------- client registration ----------

/** https anywhere, or http only back to this computer (desktop apps catch the redirect on a local port). */
export function redirectAllowed(uri: unknown): uri is string {
  if (typeof uri !== "string" || uri.length > 500) return false;
  let u: URL;
  try { u = new URL(uri); } catch { return false; }
  if (u.hash || u.username || u.password) return false;
  if (u.protocol === "https:") return true;
  return u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
}

const cleanClientName = (s: unknown) => (typeof s === "string" ? s.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 60) : "") || "Assistant";

export async function registerClient(env: AccessEnv, body: Record<string, unknown>) {
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > 5 || !uris.every(redirectAllowed))
    return { error: "invalid_redirect_uri", error_description: "redirect_uris must be 1-5 https URLs (http only for localhost)" };
  const method = body.token_endpoint_auth_method ?? "none";
  if (method !== "none") return { error: "invalid_client_metadata", error_description: "only public clients (token_endpoint_auth_method none) are supported" };
  // Registrations that never led to an approval are dropped after a day, and the total is capped.
  await env.DB.prepare(
    "DELETE FROM oauth_clients WHERE created_at < ? AND id NOT IN (SELECT client_id FROM connector_grants WHERE revoked_at IS NULL)",
  ).bind(later(-86400)).run();
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM oauth_clients").first<{ n: number }>();
  if ((n?.n ?? 0) >= MAX_CLIENTS) return { error: "temporarily_unavailable", error_description: "too many registered clients" };
  const id = "mmapp_" + randomToken(16);
  const name = cleanClientName(body.client_name);
  await env.DB.prepare("INSERT INTO oauth_clients (id, name, redirect_uris) VALUES (?, ?, ?)").bind(id, name, JSON.stringify(uris)).run();
  return {
    client_id: id, client_id_issued_at: Math.floor(Date.now() / 1000), client_name: name, redirect_uris: uris,
    token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], scope: SCOPE,
  };
}

// ---------- authorize ----------

export interface AuthRequest {
  client_id: string; redirect_uri: string; code_challenge: string; state: string | null; client_name: string;
}

/** Checks the parameters from /oauth/authorize. Errors here are shown on the page, never sent to the redirect address. */
export async function checkAuthRequest(env: AccessEnv, origin: string, q: Record<string, unknown>): Promise<AuthRequest | { error: string }> {
  const s = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : "");
  const client = s("client_id")
    ? await env.DB.prepare("SELECT id, name, redirect_uris FROM oauth_clients WHERE id = ?").bind(s("client_id")).first<{ id: string; name: string; redirect_uris: string }>()
    : null;
  if (!client) return { error: "unknown_client" };
  const uris = JSON.parse(client.redirect_uris) as string[];
  if (!uris.includes(s("redirect_uri"))) return { error: "bad_redirect" };
  if (s("response_type") !== "code") return { error: "bad_request" };
  if (s("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(s("code_challenge"))) return { error: "bad_request" };
  const resource = s("resource");
  if (resource && resource.replace(/\/+$/, "") !== resourceUrl(origin) && resource.replace(/\/+$/, "") !== origin) return { error: "bad_request" };
  return { client_id: client.id, redirect_uri: s("redirect_uri"), code_challenge: s("code_challenge"), state: s("state") || null, client_name: client.name };
}

/** After the person approved: a one-time code, and the address to send the browser back to. */
export async function issueCode(env: AccessEnv, origin: string, r: AuthRequest): Promise<string> {
  const code = randomToken(32);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM oauth_codes WHERE expires_at < ?").bind(nowIso()),
    env.DB.prepare("INSERT INTO oauth_codes (code_hash, client_id, redirect_uri, code_challenge, expires_at) VALUES (?, ?, ?, ?, ?)")
      .bind(await sha256(code), r.client_id, r.redirect_uri, r.code_challenge, later(CODE_SECONDS)),
  ]);
  const u = new URL(r.redirect_uri);
  u.searchParams.set("code", code);
  if (r.state) u.searchParams.set("state", r.state);
  u.searchParams.set("iss", origin);
  return u.toString();
}

// ---------- token ----------

export async function pkceChallenge(verifier: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return btoa(String.fromCharCode(...d)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type TokenResult = { status: number; body: Record<string, unknown> };
const tokenError = (error: string, error_description?: string, status = 400): TokenResult => ({ status, body: { error, ...(error_description ? { error_description } : {}) } });

async function newTokens(): Promise<{ access: string; refresh: string; accessHash: string; refreshHash: string }> {
  const access = ACCESS_PREFIX + randomToken(32), refresh = REFRESH_PREFIX + randomToken(32);
  return { access, refresh, accessHash: await sha256(access), refreshHash: await sha256(refresh) };
}
const tokenBody = (t: { access: string; refresh: string }) =>
  ({ access_token: t.access, token_type: "Bearer", expires_in: ACCESS_SECONDS, refresh_token: t.refresh, scope: SCOPE });

/** POST /oauth/token, form-encoded (JSON is accepted too). */
export async function exchangeToken(env: AccessEnv, p: Record<string, string>): Promise<TokenResult> {
  if (p.grant_type === "authorization_code") {
    if (!p.code || !p.code_verifier || !p.client_id || !p.redirect_uri) return tokenError("invalid_request", "code, code_verifier, client_id and redirect_uri are required");
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(p.code_verifier)) return tokenError("invalid_grant", "bad code_verifier");
    // Single use: the code is marked used in the same statement that reads it.
    const row = await env.DB.prepare(
      "UPDATE oauth_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING client_id, redirect_uri, code_challenge",
    ).bind(nowIso(), await sha256(p.code), nowIso()).first<{ client_id: string; redirect_uri: string; code_challenge: string }>();
    if (!row || row.client_id !== p.client_id || row.redirect_uri !== p.redirect_uri || row.code_challenge !== (await pkceChallenge(p.code_verifier)))
      return tokenError("invalid_grant");
    const client = await env.DB.prepare("SELECT name FROM oauth_clients WHERE id = ?").bind(row.client_id).first<{ name: string }>();
    if (!client) return tokenError("invalid_client", undefined, 401);
    const t = await newTokens();
    await env.DB.prepare(
      `INSERT INTO connector_grants (id, client_id, name, access_hash, access_expires_at, refresh_hash, refresh_expires_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), row.client_id, client.name, t.accessHash, later(ACCESS_SECONDS), t.refreshHash, later(REFRESH_DAYS * 86400), nowIso()).run();
    return { status: 200, body: tokenBody(t) };
  }
  if (p.grant_type === "refresh_token") {
    if (!p.refresh_token?.startsWith(REFRESH_PREFIX)) return tokenError("invalid_grant");
    const t = await newTokens();
    // Each refresh token works once: it is replaced in the same statement that checks it.
    const row = await env.DB.prepare(
      `UPDATE connector_grants SET access_hash = ?, access_expires_at = ?, refresh_hash = ?, refresh_expires_at = ?, last_used_at = ?
       WHERE refresh_hash = ? AND revoked_at IS NULL AND refresh_expires_at > ? ${p.client_id ? "AND client_id = ?" : ""} RETURNING id`,
    ).bind(t.accessHash, later(ACCESS_SECONDS), t.refreshHash, later(REFRESH_DAYS * 86400), nowIso(),
      await sha256(p.refresh_token), nowIso(), ...(p.client_id ? [p.client_id] : [])).first();
    if (!row) return tokenError("invalid_grant");
    return { status: 200, body: tokenBody(t) };
  }
  return tokenError("unsupported_grant_type");
}

/** The grant id for a valid connector access token, or null. */
export async function authenticateConnector(req: Request, env: AccessEnv): Promise<string | null> {
  const h = req.headers.get("authorization") ?? "";
  if (!h.startsWith("Bearer ")) return null;
  const token = h.slice(7).trim();
  if (!token.startsWith(ACCESS_PREFIX) || token.length < 40) return null;
  const row = await env.DB.prepare("SELECT id FROM connector_grants WHERE access_hash = ? AND revoked_at IS NULL AND access_expires_at > ?")
    .bind(await sha256(token), nowIso()).first<{ id: string }>();
  return row?.id ?? null;
}

// ---------- the setup page's list ----------

export async function listGrants(env: AccessEnv) {
  const r = await env.DB.prepare(
    "SELECT id, name, created_at, last_used_at FROM connector_grants WHERE revoked_at IS NULL AND refresh_expires_at > ? ORDER BY created_at",
  ).bind(nowIso()).all<{ id: string; name: string; created_at: string; last_used_at: string | null }>();
  return r.results;
}

export async function revokeGrant(env: AccessEnv, id: string): Promise<void> {
  await env.DB.prepare("UPDATE connector_grants SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(nowIso(), id).run();
}
