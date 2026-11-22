// Who may use this server: per-device tokens, the setup password, one-time pairing codes, and simple limits.
// docs/sharing-plan.md §4 (risks 1 and 2).
import { sameSecret } from "./auth";

export interface AccessEnv {
  DB: D1Database;
  /** Nico's original single token. Optional on friends' copies. */
  API_TOKEN?: string;
  /** Chosen by the friend in the deploy form; unlocks the setup page. */
  SETUP_PASSWORD?: string;
}

const enc = new TextEncoder();
const nowIso = () => new Date().toISOString();

export function randomToken(bytes = 32): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
  return Array.from(d, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** A secret only counts if it's set and long enough; an unset env var must never match anything. */
const usable = (s: string | undefined, min: number): s is string => typeof s === "string" && s.length >= min;

/** Device tokens look like "mm_<43 chars>". */
export const DEVICE_PREFIX = "mm_";

/** Returns the device id ("api-token" for the legacy token), or null if the request isn't allowed. */
export async function authenticate(req: Request, env: AccessEnv, ctx?: { waitUntil(p: Promise<unknown>): void }): Promise<string | null> {
  const h = req.headers.get("authorization") ?? "";
  if (!h.startsWith("Bearer ")) return null;
  const token = h.slice(7).trim();
  if (usable(env.API_TOKEN, 16) && sameSecret(token, env.API_TOKEN)) return "api-token";
  if (!token.startsWith(DEVICE_PREFIX) || token.length < 40) return null;
  const hash = await sha256(token);
  const row = await env.DB.prepare("SELECT id, last_seen_at FROM devices WHERE token_hash = ? AND revoked_at IS NULL").bind(hash).first<{ id: string; last_seen_at: string | null }>();
  if (!row) return null;
  // Record "last used" at most once an hour, so normal use doesn't write on every request.
  if (!row.last_seen_at || Date.parse(row.last_seen_at) < Date.now() - 3600_000) {
    const p = env.DB.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").bind(nowIso(), row.id).run();
    ctx ? ctx.waitUntil(p) : await p;
  }
  return row.id;
}

/** The setup password (or, on Nico's server, the API token) unlocks the setup page. */
export function checkSetupPassword(password: unknown, env: AccessEnv): boolean {
  if (typeof password !== "string" || !password) return false;
  const a = usable(env.SETUP_PASSWORD, 8) && sameSecret(password, env.SETUP_PASSWORD);
  const b = usable(env.API_TOKEN, 16) && sameSecret(password, env.API_TOKEN);
  return a || b;
}

export function setupConfigured(env: AccessEnv): boolean {
  return usable(env.SETUP_PASSWORD, 8) || usable(env.API_TOKEN, 16);
}

/** Creates a device and returns its token. The token is never stored, only its hash. */
export async function createDevice(env: AccessEnv, name: string): Promise<{ id: string; token: string }> {
  const token = DEVICE_PREFIX + randomToken();
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO devices (id, name, token_hash, last_seen_at) VALUES (?, ?, ?, ?)")
    .bind(id, cleanName(name), await sha256(token), nowIso()).run();
  return { id, token };
}

export function cleanName(name: unknown): string {
  const s = typeof name === "string" ? name.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 60) : "";
  return s || "Device";
}

// ---------- pairing codes ----------
// 8 characters from an alphabet without look-alikes (no 0/O, 1/I/L). 31^8 ≈ 8.5e11, and attempts are rate-limited.
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const PAIR_MINUTES = 10;

export function newPairCode(): string {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(b, (x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join("");
}

/** Accepts "abcd-efgh", "ABCD EFGH" etc. Returns null if it can't be a code. */
export function normalizeCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const s = input.toUpperCase().replace(/[\s-]/g, "");
  return /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/.test(s) ? s : null;
}

export async function startPairing(env: AccessEnv): Promise<{ code: string; expires_at: string }> {
  const code = newPairCode();
  const expires_at = new Date(Date.now() + PAIR_MINUTES * 60_000).toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM pair_codes WHERE expires_at < ?").bind(nowIso()),
    env.DB.prepare("INSERT INTO pair_codes (code_hash, expires_at) VALUES (?, ?)").bind(await sha256(code), expires_at),
  ]);
  return { code, expires_at };
}

/** Marks the code used (once) and returns true if it was valid. */
export async function usePairCode(env: AccessEnv, input: unknown): Promise<boolean> {
  const code = normalizeCode(input);
  if (!code) return false;
  const r = await env.DB.prepare("UPDATE pair_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING code_hash")
    .bind(nowIso(), await sha256(code), nowIso()).first();
  return Boolean(r);
}

// ---------- counters (limits) ----------
/** Adds 1 to a counter that resets after `seconds`; returns the new count. */
export async function bump(env: AccessEnv, key: string, seconds: number): Promise<number> {
  const now = nowIso();
  const until = new Date(Date.now() + seconds * 1000).toISOString();
  const r = await env.DB.prepare(
    `INSERT INTO counters (key, n, expires_at) VALUES (?1, 1, ?2)
     ON CONFLICT(key) DO UPDATE SET n = CASE WHEN expires_at < ?3 THEN 1 ELSE n + 1 END,
                                    expires_at = CASE WHEN expires_at < ?3 THEN ?2 ELSE expires_at END
     RETURNING n`,
  ).bind(key, until, now).first<{ n: number }>();
  return r?.n ?? 1;
}

export async function peek(env: AccessEnv, key: string): Promise<number> {
  const r = await env.DB.prepare("SELECT n FROM counters WHERE key = ? AND expires_at >= ?").bind(key, nowIso()).first<{ n: number }>();
  return r?.n ?? 0;
}

/** Failed attempts per client IP per hour before it's blocked for the rest of the hour. */
export const MAX_FAILURES_PER_HOUR = 10;
export const clientIp = (req: Request) => req.headers.get("cf-connecting-ip") ?? "unknown";

export async function tooManyFailures(env: AccessEnv, what: string, req: Request): Promise<boolean> {
  return (await peek(env, `fail:${what}:${clientIp(req)}`)) >= MAX_FAILURES_PER_HOUR;
}
export async function recordFailure(env: AccessEnv, what: string, req: Request): Promise<void> {
  await bump(env, `fail:${what}:${clientIp(req)}`, 3600);
}

// ---------- settings ----------
export async function getSetting(env: AccessEnv, key: string): Promise<string | null> {
  const r = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
  return r?.value ?? null;
}
export async function setSetting(env: AccessEnv, key: string, value: string | null): Promise<void> {
  if (value === null) await env.DB.prepare("DELETE FROM settings WHERE key = ?").bind(key).run();
  else await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(key, value, nowIso()).run();
}
