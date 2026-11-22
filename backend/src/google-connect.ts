// "Connect Google Calendar" from the setup page (replaces scripts/google-auth.mjs for friends' copies).
// docs/sharing-plan.md §3. Google only redirects to addresses registered for the OAuth client, and every friend's
// server has its own address, so friends' copies use one fixed redirect page on the public website (oauth.html) that
// forwards back to the server named in `state`. The server only accepts a state whose single-use nonce it issued.
import { getSetting, randomToken, setSetting, sha256, type AccessEnv } from "./access";
import { serverWording as sw } from "./wording";

export const SCOPE = "https://www.googleapis.com/auth/calendar.app.created";
export const CAL_NAME = "Managemint";

export interface GoogleEnv extends AccessEnv {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REFRESH_TOKEN?: string;
  GCAL_CALENDAR_ID?: string;
  /** The public redirect page (friends' copies). Unset: this server's own /auth/google/callback. */
  GOOGLE_REDIRECT_URI?: string;
  TZ: string;
}

/** Servers the redirect page may forward to. Kept in sync with release/public/site/oauth.html. */
export const RELAY_TARGET = /^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.workers\.dev$/;

const b64url = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string) => atob(s.replace(/-/g, "+").replace(/_/g, "/"));

export function encodeState(origin: string, nonce: string): string {
  return b64url(JSON.stringify({ o: origin, n: nonce }));
}
export function decodeState(state: string | null): { o: string; n: string } | null {
  if (!state || state.length > 500) return null;
  try {
    const v = JSON.parse(unb64url(state));
    return typeof v?.o === "string" && typeof v?.n === "string" ? { o: v.o, n: v.n } : null;
  } catch { return null; }
}

/** Secrets set by Nico's script win; otherwise use what the setup page stored. */
export function credentialsSource(env: GoogleEnv): "secrets" | "setup" {
  return env.GOOGLE_REFRESH_TOKEN && env.GCAL_CALENDAR_ID ? "secrets" : "setup";
}

/** env with the Google refresh token and calendar id filled in from settings when they aren't secrets. */
export async function withGoogleSettings<E extends GoogleEnv>(env: E): Promise<E> {
  if (credentialsSource(env) === "secrets" || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return env;
  const r = await env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('google_refresh_token', 'gcal_calendar_id')").all<{ key: string; value: string }>();
  const s = Object.fromEntries(r.results.map((x) => [x.key, x.value]));
  if (!s.google_refresh_token || !s.gcal_calendar_id) return env;
  const out = Object.create(env) as E;
  Object.defineProperties(out, {
    GOOGLE_REFRESH_TOKEN: { value: s.google_refresh_token },
    GCAL_CALENDAR_ID: { value: s.gcal_calendar_id },
  });
  return out;
}

const redirectUri = (env: GoogleEnv, origin: string) => env.GOOGLE_REDIRECT_URI || `${origin}/auth/google/callback`;

export async function startGoogle(env: GoogleEnv, origin: string): Promise<string> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw new Error(sw("google_missing_keys"));
  const nonce = randomToken(24);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM oauth_states WHERE expires_at < ?").bind(new Date().toISOString()),
    env.DB.prepare("INSERT INTO oauth_states (nonce_hash, expires_at) VALUES (?, ?)").bind(await sha256(nonce), new Date(Date.now() + 600_000).toISOString()),
  ]);
  return "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri(env, origin), response_type: "code", scope: SCOPE,
    access_type: "offline", prompt: "consent", include_granted_scopes: "false", state: encodeState(origin, nonce),
  });
}

/** Handles Google's redirect. Returns a short message for the setup page. */
export async function finishGoogle(env: GoogleEnv, origin: string, url: URL): Promise<{ ok: boolean; message: string }> {
  if (url.searchParams.get("error")) return { ok: false, message: sw("google_cancelled") };
  const st = decodeState(url.searchParams.get("state"));
  const code = url.searchParams.get("code");
  if (!st || !code || st.o !== origin) return { ok: false, message: sw("google_wrong_server") };
  const used = await env.DB.prepare("DELETE FROM oauth_states WHERE nonce_hash = ? AND expires_at > ? RETURNING nonce_hash")
    .bind(await sha256(st.n), new Date().toISOString()).first();
  if (!used) return { ok: false, message: sw("google_expired") };

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri(env, origin), grant_type: "authorization_code",
    }),
  });
  if (!res.ok) return { ok: false, message: sw("google_refused", { status: res.status }) };
  const tok = (await res.json()) as { access_token: string; refresh_token?: string; scope?: string };
  if (!tok.refresh_token) return { ok: false, message: sw("google_no_refresh") };
  if (!(tok.scope ?? "").split(" ").includes(SCOPE)) return { ok: false, message: sw("google_no_scope") };

  // Reuse the calendar from an earlier connection if it still exists; otherwise create one.
  const auth = { authorization: `Bearer ${tok.access_token}` };
  let calId = await getSetting(env, "gcal_calendar_id");
  if (calId) {
    const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}`, { headers: auth });
    if (!r.ok) calId = null;
  }
  if (!calId) {
    const r = await fetch("https://www.googleapis.com/calendar/v3/calendars", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ summary: CAL_NAME, timeZone: env.TZ, description: sw("google_calendar_description") }),
    });
    if (!r.ok) return { ok: false, message: sw("google_calendar_failed", { status: r.status }) };
    calId = ((await r.json()) as { id: string }).id;
  }
  await setSetting(env, "google_refresh_token", tok.refresh_token);
  await setSetting(env, "gcal_calendar_id", calId);
  return { ok: true, message: sw("google_connected") };
}

export async function disconnectGoogle(env: GoogleEnv): Promise<void> {
  const t = await getSetting(env, "google_refresh_token");
  if (t) await fetch("https://oauth2.googleapis.com/revoke?" + new URLSearchParams({ token: t }), { method: "POST" }).catch(() => undefined);
  await setSetting(env, "google_refresh_token", null);
  // Keep gcal_calendar_id so reconnecting reuses the same calendar.
}
