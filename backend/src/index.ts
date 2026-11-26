import { parseTranscript, type ProjectRow } from "./capture";
import { calendarEnabled, syncTaskEvents, type CalTask } from "./calendar";
import type { DraftTask } from "./postprocess";
import { slug, validateBulk, type BulkBody } from "./bulk";
import { authenticate, bump, checkSetupPassword, cleanName, clientIp, createDevice, getSetting, peek, setSetting, recordFailure, setupConfigured, startPairing, tooManyFailures, usePairCode } from "./access";
import { credentialsSource, disconnectGoogle, finishGoogle, startGoogle, withGoogleSettings } from "./google-connect";
import { AUTHORIZE_HTML, AUTHORIZE_JS, PAGE_HEADERS, PAIR_HTML, PAIR_JS, SETUP_HTML, SETUP_JS } from "./setup-page";
import qrcode from "qrcode-generator";
import { VERSION, compareVersions, latestRelease } from "./version";
import { MAX_NOTES, guidelinesText, proposePlan } from "./onboarding";
import { chatTurn, cleanMessages, type ProjectInfo, type TemplateRow } from "./project-chat";
import { defaultAnchor, fromProject, type SectionRow, type TaskRow as TplTaskRow } from "./templates";
import { serverWording as sw } from "./wording";
import { handleMcp } from "./connector";
import { authServerMetadata, authenticateConnector, challenge, checkAuthRequest, exchangeToken, issueCode, listGrants, protectedResourceMetadata, registerClient, revokeGrant } from "./oauth";
import { FEED_PATH, buildIcs, feedLinks, feedToken, feedTokenMatches, feedTasks, resetFeedToken } from "./feed";

export interface Env {
  DB: D1Database;
  /** Built desktop app (../desktop/dist), served at /app/. */
  ASSETS?: Fetcher;
  /** Nico's original single token. Friends' copies use device tokens from pairing instead. */
  API_TOKEN?: string;
  /** Unlocks /setup on friends' copies (chosen in the deploy form). */
  SETUP_PASSWORD?: string;
  ANTHROPIC_API_KEY: string;
  MODEL: string;
  TZ: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REFRESH_TOKEN?: string;
  GCAL_CALENDAR_ID?: string;
  /** "owner/name" of the public repo this copy was deployed from; enables the "update available" notice. */
  PUBLIC_REPO?: string;
  /** Friends' copies: the public website's Google redirect page. Unset: /auth/google/callback on this server. */
  GOOGLE_REDIRECT_URI?: string;
  /** AI requests allowed per day (UTC). Default 500. */
  CLAUDE_DAILY_LIMIT?: string;
}

const TASK_FIELDS = [
  "project_id", "section_id", "parent_id", "title", "notes", "kind", "status",
  "start_date", "due_date", "due_time", "deadline", "duration_min", "priority", "sort", "calendar",
] as const;
const PROJECT_FIELDS = ["name", "color", "description", "keywords", "status", "sort", "calendar"] as const;
const CAL_FIELDS = new Set(["title", "notes", "kind", "status", "due_date", "due_time", "deadline", "duration_min", "calendar", "project_id"]);

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...cors } });
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
};
const nowIso = () => new Date().toISOString();

// The desktop app is static files with no secrets; the token is entered in the app and kept in its storage.
// These headers stop other sites framing it and limit what scripts it can load or call.
const APP_HEADERS: Record<string, string> = {
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; " +
    "connect-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
};

async function serveApp(req: Request, env: Env, path: string): Promise<Response> {
  if (!env.ASSETS) return new Response("Desktop app not built", { status: 404 });
  if (path === "/app") return Response.redirect(new URL("/app/", req.url).toString(), 301);
  const res = await env.ASSETS.fetch(req);
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(APP_HEADERS)) out.headers.set(k, v);
  // Hashed files under /app/assets/ never change; everything else (index.html, manifest) must revalidate so a deploy shows up at once.
  out.headers.set("cache-control", path.startsWith("/app/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
  return out;
}

const PUBLIC_PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Managemint</title><body style="font:16px/1.5 system-ui;max-width:40em;margin:2em auto;padding:0 1em">
<h1>Managemint</h1>
<p>A private, single-user task manager. It is not offered to the public.</p>
<h2>Privacy</h2>
<p>Managemint asks Google only for permission to create its own "Managemint" calendar and manage events on it.
It cannot see your other calendars. It writes task titles, notes and dates to that calendar and stores nothing
from Google except the ids of the events it created. Nothing is shared with third parties or used for ads.
To revoke access, remove Managemint at https://myaccount.google.com/permissions.</p>`;

const claudeLimit = (env: Env) => Math.max(1, parseInt(env.CLAUDE_DAILY_LIMIT ?? "", 10) || 500);
const claudeKey = () => `claude:${new Date().toISOString().slice(0, 10)}`;

async function projects(env: Env): Promise<ProjectRow[]> {
  const r = await env.DB.prepare("SELECT id, name, description, keywords FROM projects WHERE deleted_at IS NULL AND status != 'done' ORDER BY sort").all<ProjectRow>();
  return r.results;
}

const PALETTE = ["clay", "ochre", "olive", "sage", "teal", "slate", "iris", "plum"];

/** A project asked for in a voice note: unique id from its name, the least-used palette colour, last in order. */
async function createProjectFromCapture(env: Env, name: string): Promise<string> {
  const base = slug(name);
  let id = base;
  for (let i = 2; await env.DB.prepare("SELECT id FROM projects WHERE id = ?").bind(id).first(); i++) id = `${base}-${i}`;
  const rows = (await env.DB.prepare("SELECT color FROM projects WHERE deleted_at IS NULL").all<{ color: string | null }>()).results;
  const used = (c: string) => rows.filter((r) => r.color === c).length;
  const color = PALETTE.reduce((best, c) => (used(c) < used(best) ? c : best), PALETTE[0]);
  const sort = ((await env.DB.prepare("SELECT MAX(sort) AS m FROM projects").first<{ m: number | null }>())?.m ?? 0) + 1;
  await env.DB.prepare("INSERT INTO projects (id, name, color, description, keywords, sort) VALUES (?, ?, ?, '', '[]', ?)")
    .bind(id, name, color, sort).run();
  return id;
}

async function getTask(env: Env, id: string) {
  return env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first<CalTask & Record<string, unknown>>();
}

/** Sync calendar for one task and store the event ids. Calendar errors never block saving. */
async function syncCalendar(env: Env, id: string): Promise<string | null> {
  const t = await getTask(env, id);
  if (!t) return null;
  try {
    // A task is on the calendar only if both it and its project are switched on (calendar = 1).
    const p = await env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(t.project_id).first<{ calendar?: number }>();
    const ids = await syncTaskEvents(env, { ...t, calendar_off: p?.calendar === 0 || t.calendar === 0 });
    if (ids.gcal_event_id !== t.gcal_event_id || ids.gcal_deadline_event_id !== t.gcal_deadline_event_id) {
      await env.DB.prepare("UPDATE tasks SET gcal_event_id = ?, gcal_deadline_event_id = ? WHERE id = ?")
        .bind(ids.gcal_event_id, ids.gcal_deadline_event_id, id).run();
    }
    return null;
  } catch (e) {
    return String(e);
  }
}

const CLIENT_ID = /^[A-Za-z0-9-]{8,64}$/;
const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Theme accent names (design/accents.css); a daily may use one as its colour. */
const DAILY_COLORS = ["blue", "slate", "teal", "sage", "olive", "ochre", "iris", "plum"];

/** Schedule and colour fields from a dailies request body: days (Mon..Sun "1010100", at least one day) and per_week (1-6 or null). */
export function dailySchedule(body: Record<string, unknown>): { days?: string; per_week?: number | null; color?: string | null } | { error: string } {
  const out: { days?: string; per_week?: number | null; color?: string | null } = {};
  if ("days" in body) {
    if (typeof body.days !== "string" || !/^[01]{7}$/.test(body.days) || !body.days.includes("1")) return { error: "days must be 7 characters of 0/1, Mon..Sun, with at least one 1" };
    out.days = body.days;
  }
  if ("per_week" in body) {
    const n = body.per_week;
    if (n !== null && !(Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 6)) return { error: "per_week must be 1-6 or null" };
    out.per_week = n as number | null;
  }
  if ("color" in body) {
    if (body.color !== null && !(typeof body.color === "string" && DAILY_COLORS.includes(body.color))) return { error: `color must be null or one of ${DAILY_COLORS.join(", ")}` };
    out.color = body.color as string | null;
  }
  return out;
}

async function insertTask(env: Env, t0: Partial<Record<(typeof TASK_FIELDS)[number], unknown>>, extra: { source: string; capture_id?: string | null; id?: string }) {
  // Clients may pick the id (the phone does, so an offline task keeps its id and a retried POST can't duplicate it).
  let t = t0;
  const id = extra.id && CLIENT_ID.test(extra.id) ? extra.id : crypto.randomUUID();
  // A phone that was offline may still send tasks for a project deleted meanwhile: those land in Inbox.
  if (t.project_id && t.project_id !== "inbox" &&
    !(await env.DB.prepare("SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL").bind(t.project_id).first())) {
    t = { ...t, project_id: "inbox", section_id: null };
  }
  const cols = TASK_FIELDS.filter((k) => t[k] !== undefined && t[k] !== null);
  await env.DB.prepare(
    `INSERT INTO tasks (id, source, capture_id, ${cols.join(", ")}) VALUES (?, ?, ?, ${cols.map(() => "?").join(", ")})`,
  ).bind(id, extra.source, extra.capture_id ?? null, ...cols.map((k) => t[k] as string | number)).run();
  return id;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (path === "/health") return json({ ok: true });
    if (url.pathname === "/app" || url.pathname.startsWith("/app/")) return serveApp(req, env, url.pathname);
    // The bare address opens the app (it links to /setup when not signed in).
    if (path === "/") return Response.redirect(new URL("/app/", req.url).toString(), 302);
    // Privacy page (Google asks for one before an OAuth app goes "In production"): copies deployed from the public
    // repo point to the website's privacy page; a server without PUBLIC_REPO keeps the short built-in page.
    if (path === "/privacy") {
      const [owner, name] = (env.PUBLIC_REPO ?? "").split("/");
      if (owner && name) return Response.redirect(`https://${owner.toLowerCase()}.github.io/${name}/privacy.html`, 302);
      return new Response(PUBLIC_PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // ---- setup and pairing (no token yet) ----
    const page = (body: string, type: string) => new Response(body, { headers: { "content-type": `${type}; charset=utf-8`, ...PAGE_HEADERS } });
    if (path === "/setup" && req.method === "GET") return page(SETUP_HTML, "text/html");
    if (path === "/setup.js") return page(SETUP_JS, "text/javascript");
    if (path === "/pair" && req.method === "GET") return page(PAIR_HTML, "text/html");
    if (path === "/pair.js") return page(PAIR_JS, "text/javascript");
    if (path === "/setup/login" && req.method === "POST") {
      if (!setupConfigured(env)) return json({ error: sw("no_setup_password") }, 503);
      if (await tooManyFailures(env, "login", req)) return json({ error: sw("too_many_attempts") }, 429);
      const b = (await req.json().catch(() => ({}))) as { password?: unknown; name?: unknown };
      if (!checkSetupPassword(b.password, env)) { await recordFailure(env, "login", req); return json({ error: sw("wrong_password") }, 401); }
      const d = await createDevice(env, cleanName(b.name ?? "Setup page"));
      return json({ token: d.token, device_id: d.id });
    }
    if (path === "/pair/claim" && req.method === "POST") {
      if (await tooManyFailures(env, "pair", req)) return json({ error: sw("too_many_attempts") }, 429);
      const b = (await req.json().catch(() => ({}))) as { code?: unknown; name?: unknown };
      if (!(await usePairCode(env, b.code))) { await recordFailure(env, "pair", req); return json({ error: sw("pair_code_bad") }, 401); }
      const d = await createDevice(env, cleanName(b.name ?? "Phone"));
      return json({ token: d.token, device_id: d.id, server: url.origin });
    }
    if (path === "/auth/google/callback" && req.method === "GET") {
      const r = await finishGoogle(env, url.origin, url).catch((e) => ({ ok: false, message: `Couldn't connect Google: ${(e as Error).message}` }));
      return Response.redirect(`${url.origin}/setup?` + new URLSearchParams({ google: r.ok ? "ok" : "error", msg: r.message }), 302);
    }

    // GET /calendar/<token>.ics — the subscribable calendar feed. The secret token in the link is the only key,
    // because calendar apps can't send a login. Regenerating it on the setup page turns the old link off.
    const feed = (req.method === "GET" || req.method === "HEAD") ? FEED_PATH.exec(url.pathname) : null;
    if (feed) {
      if (!(await feedTokenMatches(env, feed[1]))) return new Response("Not found", { status: 404 });
      const ics = buildIcs(await feedTasks(env), env.TZ, "managemint");
      return new Response(req.method === "HEAD" ? null : ics, {
        headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": 'inline; filename="managemint.ics"',
          "cache-control": "private, max-age=300", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" },
      });
    }

    // ---- assistant connector (connector.ts) and its sign-in (oauth.ts) ----
    const origin = url.origin;
    if (path === "/.well-known/oauth-protected-resource" || path === "/.well-known/oauth-protected-resource/mcp")
      return json(protectedResourceMetadata(origin));
    if (path === "/.well-known/oauth-authorization-server") return json(authServerMetadata(origin));
    if (path === "/oauth/register" && req.method === "POST") {
      if ((await bump(env, `oauth-register:${clientIp(req)}`, 3600)) > 20) return json({ error: "slow_down" }, 429);
      const r = await registerClient(env, (await req.json().catch(() => ({}))) as Record<string, unknown>);
      return json(r, "error" in r ? 400 : 201);
    }
    if (path === "/oauth/authorize" && req.method === "GET") return page(AUTHORIZE_HTML, "text/html");
    if (path === "/oauth/authorize.js") return page(AUTHORIZE_JS, "text/javascript");
    // POST /oauth/check {params} → {client_name} so the page can say who is asking; POST /oauth/approve {params, password?}
    // (or a signed-in device's token) → {redirect}. Problems with the request are shown on the page, never redirected.
    if ((path === "/oauth/check" || path === "/oauth/approve") && req.method === "POST") {
      const b = (await req.json().catch(() => ({}))) as { params?: Record<string, unknown>; password?: unknown };
      const ar = await checkAuthRequest(env, origin, b.params ?? {});
      if ("error" in ar) {
        const why = { unknown_client: sw("oauth_unknown_client"), bad_redirect: sw("oauth_bad_redirect"), bad_request: sw("oauth_bad_request") };
        return json({ error: why[ar.error as keyof typeof why] ?? why.bad_request }, 400);
      }
      if (path === "/oauth/check") return json({ client_name: ar.client_name, signed_in: Boolean(await authenticate(req, env, ctx)) });
      if (!(await authenticate(req, env, ctx))) {
        if (await tooManyFailures(env, "login", req)) return json({ error: sw("too_many_attempts") }, 429);
        if (!checkSetupPassword(b.password, env)) { await recordFailure(env, "login", req); return json({ error: sw("wrong_password") }, 401); }
      }
      return json({ redirect: await issueCode(env, origin, ar) });
    }
    if (path === "/oauth/token" && req.method === "POST") {
      if (await tooManyFailures(env, "token", req)) return json({ error: "slow_down" }, 429);
      const type = req.headers.get("content-type") ?? "";
      const p: Record<string, string> = type.includes("application/json")
        ? Object.fromEntries(Object.entries((await req.json().catch(() => ({}))) as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
        : Object.fromEntries(new URLSearchParams(await req.text()));
      const r = await exchangeToken(env, p);
      if (r.status !== 200) await recordFailure(env, "token", req);
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json", "cache-control": "no-store", pragma: "no-cache", ...cors } });
    }
    if (path === "/mcp") {
      if (!(await authenticateConnector(req, env)))
        return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json", "www-authenticate": challenge(origin, req.headers.has("authorization") ? "invalid_token" : undefined) } });
      return handleMcp(req, { ...env, onTaskCreated: async (id) => syncCalendar(await withGoogleSettings(env), id) });
    }

    const deviceId = await authenticate(req, env, ctx);
    if (!deviceId) return json({ error: "unauthorized" }, 401);
    env = await withGoogleSettings(env);

    try {
      const seg = path.split("/").filter(Boolean);
      const body = req.method === "GET" || req.method === "DELETE" ? {} : ((await req.json().catch(() => ({}))) as Record<string, any>);

      // GET /version → {version, latest, update_available}. Apps show "Update available" when this copy is behind.
      if (seg[0] === "version" && seg.length === 1 && req.method === "GET") {
        const latest = await latestRelease(env.PUBLIC_REPO);
        return json({ version: VERSION, latest, update_available: latest ? compareVersions(VERSION, latest) < 0 : false, tz: env.TZ, repo: env.PUBLIC_REPO ?? null });
      }

      // ---- setup page (any paired device or the API token) ----
      if (seg[0] === "setup" && seg[1] === "status" && req.method === "GET") {
        const devices = await env.DB.prepare("SELECT id, name, created_at, last_seen_at FROM devices WHERE revoked_at IS NULL ORDER BY created_at").all<{ id: string }>();
        const latest = await latestRelease(env.PUBLIC_REPO);
        const refresh = credentialsSource(env) === "secrets" || Boolean(env.GOOGLE_REFRESH_TOKEN);
        return json({
          version: VERSION, latest, update_available: latest ? compareVersions(VERSION, latest) < 0 : false, tz: env.TZ,
          claude: Boolean(env.ANTHROPIC_API_KEY), claude_daily_limit: claudeLimit(env), claude_used_today: await peek(env, claudeKey()),
          google: { client: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET), source: credentialsSource(env), connected: refresh },
          devices: devices.results.map((d) => ({ ...d, current: d.id === deviceId })),
        });
      }
      if (seg[0] === "setup" && seg[1] === "check-claude" && req.method === "POST") {
        if (!env.ANTHROPIC_API_KEY) return json({ ok: false, error: sw("ai_no_key") });
        const r = await fetch("https://api.anthropic.com/v1/models?limit=1", { headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" } }).catch(() => null);
        if (!r) return json({ ok: false, error: sw("ai_unreachable") });
        if (r.status === 401) return json({ ok: false, error: sw("ai_key_rejected") });
        return json(r.ok ? { ok: true } : { ok: false, error: sw("ai_status", { status: r.status }) });
      }
      if (seg[0] === "pair" && seg[1] === "start" && req.method === "POST") {
        const p = await startPairing(env);
        const pairUrl = `${url.origin}/pair?code=${p.code}`;
        const qr = qrcode(0, "M"); qr.addData(pairUrl); qr.make();
        return json({ ...p, pair_url: pairUrl, qr_svg: qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }) });
      }
      if (seg[0] === "devices" && seg[1] && seg.length === 2 && req.method === "DELETE") {
        await env.DB.prepare("UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(nowIso(), seg[1]).run();
        return json({ ok: true });
      }
      // GET /calendar/feed → the calendar feed links (made on first use) and a QR code of the webcal:// link.
      // POST /calendar/feed/reset → a new secret link; calendars subscribed to the old one stop updating.
      if (seg[0] === "calendar" && seg[1] === "feed" && (seg.length === 2 && req.method === "GET" || seg[2] === "reset" && req.method === "POST")) {
        const token = seg[2] === "reset" ? await resetFeedToken(env) : await feedToken(env);
        const links = feedLinks(url.origin, token);
        const qr = qrcode(0, "M"); qr.addData(links.webcal); qr.make();
        return json({ ...links, qr_svg: qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }) });
      }
      // GET /connector/grants → assistants approved to use the connector. DELETE /connector/grants/:id signs one out.
      if (seg[0] === "connector" && seg[1] === "grants") {
        if (seg.length === 2 && req.method === "GET") return json({ url: `${url.origin}/mcp`, grants: await listGrants(env) });
        if (seg.length === 3 && req.method === "DELETE") { await revokeGrant(env, seg[2]); return json({ ok: true }); }
      }
      if (seg[0] === "google" && seg[1] === "start" && req.method === "POST") {
        try { return json({ url: await startGoogle(env, url.origin) }); }
        catch (e) { return json({ error: (e as Error).message }, 400); }
      }
      if (seg[0] === "google" && seg[1] === "disconnect" && req.method === "POST") {
        if (credentialsSource(env) === "secrets") return json({ error: sw("google_server_secrets") }, 400);
        await disconnectGoogle(env);
        return json({ ok: true });
      }

      // POST /capture {transcript, now, tz?, forced_project_id?, capture_id?}
      // Call repeatedly with the same capture_id while the user is still speaking (live cards).
      if (seg[0] === "capture" && seg.length === 1 && req.method === "POST") {
        if (!body.transcript || !body.now) return json({ error: "transcript and now are required" }, 400);
        // Each call is one Claude request (live capture calls repeatedly), so the daily limit counts calls.
        if ((await bump(env, claudeKey(), 2 * 86400)) > claudeLimit(env))
          return json({ error: sw("daily_limit", { limit: claudeLimit(env) }) }, 429);
        const tasks = await parseTranscript({
          apiKey: env.ANTHROPIC_API_KEY, model: env.MODEL, transcript: body.transcript,
          now: body.now, tz: body.tz || env.TZ, projects: await projects(env), forced: body.forced_project_id,
        });
        const id: string = body.capture_id || crypto.randomUUID();
        await env.DB.prepare(
          `INSERT INTO captures (id, transcript, forced_project_id, result_json) VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET transcript = excluded.transcript, forced_project_id = excluded.forced_project_id,
           result_json = excluded.result_json, updated_at = excluded.updated_at`,
        ).bind(id, body.transcript, body.forced_project_id ?? null, JSON.stringify(tasks)).run();
        return json({ capture_id: id, tasks });
      }

      // POST /onboarding/plan {answers, now, tz?} — first-run questions → draft projects for the user to review.
      // Nothing is saved here; the app sends the approved drafts to POST /projects/import.
      if (seg[0] === "onboarding" && seg[1] === "plan" && req.method === "POST") {
        if (!body.answers || typeof body.answers !== "object" || !/^\d{4}-\d{2}-\d{2}/.test(String(body.now ?? ""))) return json({ error: "answers and now (YYYY-MM-DDTHH:MM) are required" }, 400);
        if (!env.ANTHROPIC_API_KEY) return json({ error: sw("onboarding_no_key") }, 400);
        if ((await bump(env, claudeKey(), 2 * 86400)) > claudeLimit(env))
          return json({ error: sw("daily_limit", { limit: claudeLimit(env) }) }, 429);
        const projects = await proposePlan({
          apiKey: env.ANTHROPIC_API_KEY, model: env.MODEL, answers: body.answers, today: String(body.now).slice(0, 10), tz: body.tz || env.TZ,
          notes: await getSetting(env, "planning_guidelines"),
        });
        return json({ projects });
      }

      // POST /projects/chat {messages: [{role, text}], draft?, template_id?, now, tz?} — one turn of the new-project
      // chat. Returns {reply, options, draft}; draft is null unless the assistant proposed or changed the project.
      // Nothing is saved; the app sends the approved draft to POST /projects/import.
      if (seg[0] === "projects" && seg[1] === "chat" && seg.length === 2 && req.method === "POST") {
        const messages = cleanMessages(body.messages);
        if (!messages.length || messages[messages.length - 1].role !== "user" || !/^\d{4}-\d{2}-\d{2}/.test(String(body.now ?? "")))
          return json({ error: "messages (ending with the user's) and now (YYYY-MM-DDTHH:MM) are required" }, 400);
        if (!env.ANTHROPIC_API_KEY) return json({ error: sw("onboarding_no_key") }, 400);
        if ((await bump(env, claudeKey(), 2 * 86400)) > claudeLimit(env))
          return json({ error: sw("daily_limit", { limit: claudeLimit(env) }) }, 429);
        const templates = (await env.DB.prepare("SELECT id, name, body_json FROM templates ORDER BY name").all<TemplateRow>()).results;
        const others = (await env.DB.prepare("SELECT name, color, description FROM projects WHERE deleted_at IS NULL ORDER BY sort").all<ProjectInfo>()).results;
        return json(await chatTurn({
          apiKey: env.ANTHROPIC_API_KEY, model: env.MODEL, messages, today: String(body.now).slice(0, 10), tz: body.tz || env.TZ,
          notes: await getSetting(env, "planning_guidelines"), templates, templateId: typeof body.template_id === "string" ? body.template_id : null,
          projects: others, draft: body.draft ?? null,
        }));
      }

      // POST /projects/:id/template {name?, anchor_task_id?, today?} — save a project as a template (day offsets from
      // the anchor task's date; default anchor: the last milestone, else the latest date).
      if (seg[0] === "projects" && seg[2] === "template" && seg.length === 3 && req.method === "POST") {
        const p = await env.DB.prepare("SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL").bind(seg[1]).first<{ id: string; name: string }>();
        if (!p) return json({ error: "unknown project" }, 404);
        const sections = (await env.DB.prepare("SELECT id, name, sort FROM sections WHERE project_id = ? AND deleted_at IS NULL").bind(p.id).all<SectionRow>()).results;
        const tasks = (await env.DB.prepare("SELECT * FROM tasks WHERE project_id = ? AND deleted_at IS NULL").bind(p.id).all<TplTaskRow>()).results;
        if (!tasks.length) return json({ error: sw("template_empty") }, 400);
        const deps = (await env.DB.prepare("SELECT d.task_id, d.depends_on_id FROM deps d JOIN tasks t ON t.id = d.task_id WHERE t.project_id = ?").bind(p.id).all<{ task_id: string; depends_on_id: string }>()).results;
        const anchor = (typeof body.anchor_task_id === "string" ? tasks.find((t) => t.id === body.anchor_task_id && (t.due_date || t.deadline)) : undefined) ?? defaultAnchor(tasks);
        const today = isDay(body.today) ? body.today : nowIso().slice(0, 10);
        const tpl = fromProject(sections, tasks, deps, anchor, today, sw("template_anchor_default"));
        const name = (typeof body.name === "string" && body.name.trim() ? body.name.trim() : p.name).slice(0, 120);
        const id = crypto.randomUUID();
        await env.DB.prepare("INSERT INTO templates (id, name, body_json, updated_at) VALUES (?, ?, ?, ?)").bind(id, name, JSON.stringify(tpl), nowIso()).run();
        return json(await env.DB.prepare("SELECT * FROM templates WHERE id = ?").bind(id).first(), 201);
      }

      // GET/PUT /settings/guidelines {text} — the user's own planning notes, added to the shipped guidelines.
      if (seg[0] === "settings" && seg[1] === "guidelines" && seg.length === 2) {
        if (req.method === "GET") return json({ text: (await getSetting(env, "planning_guidelines")) ?? "", builtin: guidelinesText() });
        if (req.method === "PUT") {
          if (typeof body.text !== "string" || body.text.length > MAX_NOTES) return json({ error: `text is required, at most ${MAX_NOTES} characters` }, 400);
          await setSetting(env, "planning_guidelines", body.text.trim() || null);
          return json({ text: body.text.trim() });
        }
      }

      // POST /capture/:id/save {tasks: DraftTask[]} — the (possibly edited) cards the user confirmed.
      if (seg[0] === "capture" && seg[2] === "save" && req.method === "POST") {
        // A retried save (phone lost the response) returns what the first one saved instead of duplicating.
        const prev = await env.DB.prepare("SELECT status FROM captures WHERE id = ?").bind(seg[1]).first<{ status: string }>();
        if (prev?.status === "saved") {
          const r = await env.DB.prepare("SELECT * FROM tasks WHERE capture_id = ? AND deleted_at IS NULL").bind(seg[1]).all();
          return json({ tasks: r.results, calendar_errors: [] });
        }
        const ids: string[] = [];
        // Tolerate a save without a prior /capture call (e.g. offline transcript processed later).
        await env.DB.prepare("INSERT OR IGNORE INTO captures (id, transcript) VALUES (?, '')").bind(seg[1]).run();
        // Cards for a new project (project_id "new" + new_project name) create it first; one project per name.
        const created = new Map<string, string>();
        for (const t of (body.tasks ?? []) as DraftTask[]) {
          if (t.project_id === "new") {
            const name = String(t.new_project ?? "").trim().slice(0, 80);
            const key = name.toLowerCase();
            if (!name) t.project_id = "inbox";
            else {
              if (!created.has(key)) created.set(key, await createProjectFromCapture(env, name));
              t.project_id = created.get(key)!;
            }
          }
          ids.push(await insertTask(env, { ...t, status: "todo" }, { source: "voice", capture_id: seg[1] }));
        }
        await env.DB.prepare("UPDATE captures SET status = 'saved', updated_at = ? WHERE id = ?").bind(nowIso(), seg[1]).run();
        const errors = (await Promise.all(ids.map((i) => syncCalendar(env, i)))).filter(Boolean);
        const saved = await Promise.all(ids.map((i) => getTask(env, i)));
        const newProjects = await Promise.all([...created.values()].map((i) => env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(i).first()));
        return json({ tasks: saved, calendar_errors: errors, projects: newProjects });
      }

      // POST /capture/:id/undo — "Undo all" after saving.
      if (seg[0] === "capture" && seg[2] === "undo" && req.method === "POST") {
        const now = nowIso();
        const r = await env.DB.prepare("UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE capture_id = ? AND deleted_at IS NULL RETURNING id")
          .bind(now, now, seg[1]).all<{ id: string }>();
        await env.DB.prepare("UPDATE captures SET status = 'undone', updated_at = ? WHERE id = ?").bind(now, seg[1]).run();
        ctx.waitUntil(Promise.all(r.results.map((x) => syncCalendar(env, x.id))));
        return json({ undone: r.results.length });
      }

      // POST /projects/import — a project's sections, tasks and dependencies in one go (templates, dotpm import).
      // Re-running with the same ids changes nothing. Calendar events are not made here (too many requests for one
      // call); the response lists the dated task ids and the client sends them to POST /calendar/sync in small batches.
      if (seg[0] === "projects" && seg[1] === "import" && req.method === "POST") {
        const b = body as BulkBody;
        const err = validateBulk(b);
        if (err) return json({ error: err }, 400);
        let projectId = b.project_id;
        const stmts: D1PreparedStatement[] = [];
        if (projectId) {
          if (!(await env.DB.prepare("SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL").bind(projectId).first())) return json({ error: "unknown project" }, 400);
        } else {
          const base = slug(b.project!.name);
          projectId = base;
          for (let i = 2; await env.DB.prepare("SELECT id FROM projects WHERE id = ?").bind(projectId).first(); i++) projectId = `${base}-${i}`;
          const sort = ((await env.DB.prepare("SELECT MAX(sort) AS m FROM projects").first<{ m: number | null }>())?.m ?? 0) + 1;
          const kw = Array.isArray(b.project!.keywords) ? b.project!.keywords.filter((k) => typeof k === "string").slice(0, 20) : [];
          stmts.push(env.DB.prepare("INSERT INTO projects (id, name, color, description, keywords, sort) VALUES (?, ?, ?, ?, ?, ?)")
            .bind(projectId, b.project!.name, b.project!.color ?? null, typeof b.project!.description === "string" ? b.project!.description : "", JSON.stringify(kw), sort));
        }
        const source = b.source === "manual" ? "manual" : "template";
        (b.sections ?? []).forEach((sec, i) => stmts.push(
          env.DB.prepare("INSERT OR IGNORE INTO sections (id, project_id, name, sort) VALUES (?, ?, ?, ?)").bind(sec.id, projectId, sec.name, sec.sort ?? i)));
        // Parents first, so the parent_id foreign key is satisfied.
        const ordered = [...b.tasks].sort((x, y) => Number(Boolean(x.parent_id)) - Number(Boolean(y.parent_id)));
        ordered.forEach((t, i) => stmts.push(env.DB.prepare(
          `INSERT OR IGNORE INTO tasks (id, project_id, section_id, parent_id, title, notes, kind, status, start_date, due_date, due_time, deadline, priority, sort, source, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(t.id, projectId, t.section_id ?? null, t.parent_id ?? null, t.title, t.notes ?? "", t.kind ?? "task", t.status ?? "todo",
          t.start_date ?? null, t.due_date ?? null, t.due_time ?? null, t.deadline ?? null, t.priority ?? 4, t.sort ?? i, source,
          t.status === "done" ? nowIso() : null)));
        for (const [a, d] of b.deps ?? []) stmts.push(env.DB.prepare("INSERT OR IGNORE INTO deps (task_id, depends_on_id) VALUES (?, ?)").bind(a, d));
        if (stmts.length) await env.DB.batch(stmts); // all or nothing
        const ids = b.tasks.map((t) => t.id);
        const dated = b.tasks.filter((t) => (t.due_date || t.deadline) && t.status !== "done" && t.status !== "cancelled").map((t) => t.id);
        return json({ project: await env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(projectId).first(), task_ids: ids, calendar_pending: dated }, 201);
      }

      // Templates: {id, name, body_json}. body_json is whatever the desktop app stores (sections + tasks with day
      // offsets from an anchor date); the server doesn't interpret it.
      if (seg[0] === "templates") {
        if (req.method === "GET" && seg.length === 1) {
          return json((await env.DB.prepare("SELECT * FROM templates ORDER BY name").all()).results);
        }
        if (req.method === "POST" && seg.length === 1) {
          if (!body.name || !body.body) return json({ error: "name and body are required" }, 400);
          const id = body.id && CLIENT_ID.test(body.id) ? body.id : crypto.randomUUID();
          const text = JSON.stringify(body.body);
          if (text.length > 200_000) return json({ error: "template too large" }, 400);
          await env.DB.prepare("INSERT INTO templates (id, name, body_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, body_json = excluded.body_json, updated_at = excluded.updated_at")
            .bind(id, String(body.name), text, nowIso()).run();
          return json(await env.DB.prepare("SELECT * FROM templates WHERE id = ?").bind(id).first(), 201);
        }
        if (req.method === "DELETE" && seg[1]) {
          await env.DB.prepare("DELETE FROM templates WHERE id = ?").bind(seg[1]).run();
          return json({ deleted: seg[1] });
        }
      }

      // POST /calendar/sync {ids} — bring up to 20 tasks' events in line (after a bulk import).
      if (seg[0] === "calendar" && seg[1] === "sync" && req.method === "POST") {
        const ids = Array.isArray(body.ids) ? body.ids.slice(0, 20).map(String) : [];
        const errors: string[] = [];
        for (const id of ids) {
          const e = await syncCalendar(env, id);
          if (e) errors.push(`${id}: ${e}`);
        }
        return json({ synced: ids.length, errors });
      }

      // Projects
      if (seg[0] === "projects") {
        if (req.method === "GET" && seg.length === 1) {
          return json((await env.DB.prepare("SELECT * FROM projects WHERE deleted_at IS NULL ORDER BY sort").all()).results);
        }
        if (req.method === "POST" && seg.length === 1) {
          if (!body.name) return json({ error: "name is required" }, 400);
          let id: string = body.id || body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
          if (!body.id) {
            // A deleted project keeps its row (for Undo), so a new project with the same name gets "-2", "-3", ...
            const base = id;
            for (let i = 2; await env.DB.prepare("SELECT id FROM projects WHERE id = ?").bind(id).first(); i++) id = `${base}-${i}`;
          }
          await env.DB.prepare("INSERT INTO projects (id, name, color, description, keywords, sort) VALUES (?, ?, ?, ?, ?, ?)")
            .bind(id, body.name, body.color ?? null, body.description ?? "", JSON.stringify(body.keywords ?? []), body.sort ?? 99).run();
          if (body.calendar === 0 || body.calendar === false) await env.DB.prepare("UPDATE projects SET calendar = 0 WHERE id = ?").bind(id).run();
          return json(await env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first(), 201);
        }
        // DELETE /projects/:id?tasks=inbox|delete — soft delete. Its sections go with it. Its tasks either move to
        // Inbox (default; they lose their section) or are deleted too. Inbox itself can't be deleted.
        // The response lists the moved tasks with their old section so the client can offer Undo.
        if (req.method === "DELETE" && seg[1] && seg.length === 2) {
          const id = seg[1];
          const mode = url.searchParams.get("tasks") === "delete" ? "delete" : "inbox";
          if (id === "inbox") return json({ error: sw("inbox_delete") }, 400);
          const p = await env.DB.prepare("SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL").bind(id).first<{ calendar: number }>();
          if (!p) return json({ error: "unknown project" }, 404);
          const inbox = await env.DB.prepare("SELECT calendar FROM projects WHERE id = 'inbox'").first<{ calendar: number }>();
          const live = (await env.DB.prepare("SELECT id, section_id, gcal_event_id, gcal_deadline_event_id, due_date, deadline FROM tasks WHERE project_id = ? AND deleted_at IS NULL")
            .bind(id).all<{ id: string; section_id: string | null; gcal_event_id: string | null; gcal_deadline_event_id: string | null; due_date: string | null; deadline: string | null }>()).results;
          const now = nowIso();
          await env.DB.batch([
            mode === "delete"
              ? env.DB.prepare("UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE project_id = ? AND deleted_at IS NULL").bind(now, now, id)
              : env.DB.prepare("UPDATE tasks SET project_id = 'inbox', section_id = NULL, updated_at = ? WHERE project_id = ? AND deleted_at IS NULL").bind(now, id),
            env.DB.prepare("UPDATE sections SET deleted_at = ?, updated_at = ? WHERE project_id = ? AND deleted_at IS NULL").bind(now, now, id),
            env.DB.prepare("UPDATE projects SET deleted_at = ?, updated_at = ? WHERE id = ?").bind(now, now, id),
          ]);
          // Calendar: deleted tasks lose their events. Moved tasks only change if Inbox's calendar switch differs.
          const onCal = (t: (typeof live)[number]) => Boolean(t.gcal_event_id || t.gcal_deadline_event_id);
          const resync = mode === "delete" ? live.filter(onCal)
            : (p.calendar ?? 1) === (inbox?.calendar ?? 1) ? [] : live.filter((t) => onCal(t) || t.due_date || t.deadline);
          if (resync.length) ctx.waitUntil((async () => { for (const t of resync) await syncCalendar(env, t.id); })());
          return json({
            deleted: id, deleted_at: now, tasks: mode,
            moved: mode === "inbox" ? live.map((t) => ({ id: t.id, section_id: t.section_id })) : [],
            deleted_tasks: mode === "delete" ? live.length : 0,
          });
        }
        // POST /projects/:id/restore {moved?: [{id, section_id}]} — Undo a project delete. Brings back the project,
        // the sections and tasks deleted with it (same deleted_at), and moves the listed tasks back out of Inbox.
        if (req.method === "POST" && seg[2] === "restore") {
          const id = seg[1];
          const p = await env.DB.prepare("SELECT deleted_at FROM projects WHERE id = ?").bind(id).first<{ deleted_at: string | null }>();
          if (!p) return json({ error: "unknown project" }, 404);
          const ids: string[] = [];
          if (p.deleted_at) {
            const stamp = p.deleted_at;
            const now = nowIso();
            const moved = (Array.isArray(body.moved) ? body.moved : []).slice(0, 5000)
              .filter((m: any) => m && typeof m.id === "string") as Array<{ id: string; section_id?: string | null }>;
            const [, , restored] = await env.DB.batch([
              env.DB.prepare("UPDATE projects SET deleted_at = NULL, updated_at = ? WHERE id = ?").bind(now, id),
              env.DB.prepare("UPDATE sections SET deleted_at = NULL, updated_at = ? WHERE project_id = ? AND deleted_at = ?").bind(now, id, stamp),
              env.DB.prepare("UPDATE tasks SET deleted_at = NULL, updated_at = ? WHERE project_id = ? AND deleted_at = ? RETURNING id").bind(now, id, stamp),
              // Only tasks still sitting in Inbox go back; one moved elsewhere since then stays where it is.
              ...moved.map((m) => env.DB.prepare(
                "UPDATE tasks SET project_id = ?, section_id = (SELECT id FROM sections WHERE id = ? AND project_id = ?), updated_at = ? WHERE id = ? AND project_id = 'inbox' AND deleted_at IS NULL",
              ).bind(id, m.section_id ?? null, id, now, m.id)),
            ]);
            ids.push(...(restored.results as Array<{ id: string }>).map((r) => r.id), ...moved.map((m) => m.id));
            ctx.waitUntil((async () => { for (const t of ids) await syncCalendar(env, t); })());
          }
          return json({ project: await env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first(), restored_tasks: ids.length });
        }
        if (req.method === "PATCH" && seg[1]) {
          const cols = PROJECT_FIELDS.filter((k) => k in body);
          if (cols.length) {
            const vals = cols.map((k) =>
              k === "keywords" && Array.isArray(body[k]) ? JSON.stringify(body[k]) : k === "calendar" ? (body[k] ? 1 : 0) : body[k]);
            await env.DB.prepare(`UPDATE projects SET ${cols.map((c) => `${c} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
              .bind(...vals, nowIso(), seg[1]).run();
          }
          if ("calendar" in body) {
            // Add or remove this project's events in the background, one task at a time.
            const r = await env.DB.prepare("SELECT id FROM tasks WHERE project_id = ?").bind(seg[1]).all<{ id: string }>();
            ctx.waitUntil((async () => { for (const { id } of r.results) await syncCalendar(env, id); })());
          }
          return json(await env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(seg[1]).first());
        }
      }

      // Tasks
      if (seg[0] === "tasks") {
        if (req.method === "GET" && seg.length === 1) {
          const where = ["deleted_at IS NULL"];
          const binds: string[] = [];
          if (url.searchParams.get("project")) { where.push("project_id = ?"); binds.push(url.searchParams.get("project")!); }
          if (url.searchParams.get("status")) { where.push("status = ?"); binds.push(url.searchParams.get("status")!); }
          const q = `SELECT * FROM tasks WHERE ${where.join(" AND ")} ORDER BY COALESCE(due_date, deadline, '9999') , sort`;
          return json((await env.DB.prepare(q).bind(...binds).all()).results);
        }
        if (req.method === "POST" && seg.length === 1) {
          if (!body.title) return json({ error: "title is required" }, 400);
          if (body.id) {
            const existing = await getTask(env, String(body.id));
            if (existing) return json({ task: existing, calendar_error: null });
          }
          const id = await insertTask(env, { project_id: "inbox", ...body }, { source: "manual", id: body.id });
          const err = await syncCalendar(env, id);
          return json({ task: await getTask(env, id), calendar_error: err }, 201);
        }
        if (req.method === "PATCH" && seg[1]) {
          if (body.project_id && body.project_id !== "inbox" &&
            !(await env.DB.prepare("SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL").bind(body.project_id).first())) {
            body.project_id = "inbox"; body.section_id = null; // moved offline into a project deleted meanwhile
          }
          const cols = TASK_FIELDS.filter((k) => k in body);
          const sets = cols.map((c) => `${c} = ?`);
          const vals = cols.map((k) => body[k]);
          if ("status" in body) { sets.push("completed_at = ?"); vals.push(body.status === "done" ? nowIso() : null); }
          if (sets.length) {
            await env.DB.prepare(`UPDATE tasks SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).bind(...vals, nowIso(), seg[1]).run();
          }
          const err = cols.some((c) => CAL_FIELDS.has(c)) ? await syncCalendar(env, seg[1]) : null;
          return json({ task: await getTask(env, seg[1]), calendar_error: err });
        }
        if (req.method === "DELETE" && seg[1]) {
          const now = nowIso();
          await env.DB.prepare("UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ?").bind(now, now, seg[1]).run();
          ctx.waitUntil(syncCalendar(env, seg[1]));
          return json({ deleted: seg[1] });
        }
      }

      // POST /tasks/:id/restore — undo a delete.
      if (seg[0] === "tasks" && seg[2] === "restore" && req.method === "POST") {
        await env.DB.prepare(
          `UPDATE tasks SET deleted_at = NULL, updated_at = ?,
             section_id = CASE WHEN project_id IN (SELECT id FROM projects WHERE deleted_at IS NULL) THEN section_id ELSE NULL END,
             project_id = CASE WHEN project_id IN (SELECT id FROM projects WHERE deleted_at IS NULL) THEN project_id ELSE 'inbox' END
           WHERE id = ?`,
        ).bind(nowIso(), seg[1]).run();
        const err = await syncCalendar(env, seg[1]);
        return json({ task: await getTask(env, seg[1]), calendar_error: err });
      }

      // Sections (workstreams inside a project). Clients may pick the id, like tasks.
      if (seg[0] === "sections") {
        if (req.method === "POST" && seg.length === 1) {
          if (!body.name || !body.project_id) return json({ error: "name and project_id are required" }, 400);
          const id = body.id && CLIENT_ID.test(body.id) ? body.id : crypto.randomUUID();
          await env.DB.prepare("INSERT OR IGNORE INTO sections (id, project_id, name, sort) VALUES (?, ?, ?, ?)")
            .bind(id, body.project_id, String(body.name), Number(body.sort ?? 0)).run();
          return json(await env.DB.prepare("SELECT * FROM sections WHERE id = ?").bind(id).first(), 201);
        }
        if (req.method === "PATCH" && seg[1]) {
          const cols = (["name", "sort"] as const).filter((k) => k in body);
          if (cols.length) {
            await env.DB.prepare(`UPDATE sections SET ${cols.map((c) => `${c} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
              .bind(...cols.map((k) => body[k]), nowIso(), seg[1]).run();
          }
          return json(await env.DB.prepare("SELECT * FROM sections WHERE id = ?").bind(seg[1]).first());
        }
        if (req.method === "DELETE" && seg[1]) {
          // Tasks keep their project and lose the section.
          const now = nowIso();
          await env.DB.batch([
            env.DB.prepare("UPDATE tasks SET section_id = NULL, updated_at = ? WHERE section_id = ?").bind(now, seg[1]),
            env.DB.prepare("UPDATE sections SET deleted_at = ?, updated_at = ? WHERE id = ?").bind(now, now, seg[1]),
          ]);
          return json({ deleted: seg[1] });
        }
      }

      // Dailies: a short list of things to do every day. Clients may pick the id.
      // POST /dailies {title, id?, sort?}, PATCH /dailies/:id {title?, sort?}, DELETE /dailies/:id (soft),
      // PUT /dailies/:id/checks/:date {done} — check or uncheck one day (YYYY-MM-DD, the user's local day).
      if (seg[0] === "dailies") {
        if (req.method === "POST" && seg.length === 1) {
          const title = String(body.title ?? "").trim();
          if (!title) return json({ error: "title is required" }, 400);
          const id = body.id && CLIENT_ID.test(body.id) ? body.id : crypto.randomUUID();
          const sort = body.sort ?? ((await env.DB.prepare("SELECT MAX(sort) AS m FROM dailies").first<{ m: number | null }>())?.m ?? 0) + 1;
          const sched = dailySchedule(body);
          if ("error" in sched) return json(sched, 400);
          await env.DB.prepare("INSERT OR IGNORE INTO dailies (id, title, sort, days, per_week, color) VALUES (?, ?, ?, ?, ?, ?)")
            .bind(id, title, Number(sort), sched.days ?? "1111111", sched.per_week ?? null, sched.color ?? null).run();
          return json(await env.DB.prepare("SELECT * FROM dailies WHERE id = ?").bind(id).first(), 201);
        }
        if (((req.method === "PATCH" && seg.length === 2) || (req.method === "POST" && seg[2] === "restore"))
          && !(await env.DB.prepare("SELECT id FROM dailies WHERE id = ?").bind(seg[1]).first())) return json({ error: "unknown daily" }, 404);
        if (req.method === "PATCH" && seg.length === 2) {
          const sched = dailySchedule(body);
          if ("error" in sched) return json(sched, 400);
          const vals: Record<string, unknown> = { ...sched };
          if ("title" in body) vals.title = String(body.title).trim();
          if ("sort" in body) vals.sort = Number(body.sort);
          if ("pauses" in body) {
            const ok = Array.isArray(body.pauses) && body.pauses.every((p: unknown) =>
              Array.isArray(p) && p.length === 2 && isDay(p[0]) && (p[1] === null || isDay(p[1])));
            if (!ok) return json({ error: "pauses must be [[from, to|null], ...] with YYYY-MM-DD dates" }, 400);
            vals.pauses = JSON.stringify(body.pauses);
          }
          const cols = Object.keys(vals);
          if (cols.length) {
            await env.DB.prepare(`UPDATE dailies SET ${cols.map((c) => `${c} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
              .bind(...cols.map((k) => vals[k]), nowIso(), seg[1]).run();
          }
          return json(await env.DB.prepare("SELECT * FROM dailies WHERE id = ?").bind(seg[1]).first());
        }
        if (req.method === "DELETE" && seg.length === 2) {
          const now = nowIso();
          await env.DB.prepare("UPDATE dailies SET deleted_at = ?, updated_at = ? WHERE id = ?").bind(now, now, seg[1]).run();
          return json({ deleted: seg[1] });
        }
        if (req.method === "POST" && seg[2] === "restore") {
          await env.DB.prepare("UPDATE dailies SET deleted_at = NULL, updated_at = ? WHERE id = ?").bind(nowIso(), seg[1]).run();
          return json(await env.DB.prepare("SELECT * FROM dailies WHERE id = ?").bind(seg[1]).first());
        }
        if (req.method === "PUT" && seg[2] === "checks" && seg[3]) {
          if (!isDay(seg[3])) return json({ error: "date must be YYYY-MM-DD" }, 400);
          if (!(await env.DB.prepare("SELECT id FROM dailies WHERE id = ?").bind(seg[1]).first())) return json({ error: "unknown daily" }, 404);
          const done = body.done === false || body.done === 0 ? 0 : 1;
          const now = nowIso();
          await env.DB.prepare(
            "INSERT INTO daily_checks (daily_id, date, done, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (daily_id, date) DO UPDATE SET done = excluded.done, updated_at = excluded.updated_at",
          ).bind(seg[1], seg[3], done, now).run();
          return json({ daily_id: seg[1], date: seg[3], done, updated_at: now });
        }
      }

      // Dependencies (finish-to-start): POST/DELETE /deps {task_id, depends_on_id}
      if (seg[0] === "deps" && seg.length === 1 && (req.method === "POST" || req.method === "DELETE")) {
        const { task_id, depends_on_id } = req.method === "POST" ? body : Object.fromEntries(url.searchParams);
        if (!task_id || !depends_on_id || task_id === depends_on_id) return json({ error: "task_id and depends_on_id are required and must differ" }, 400);
        const q = req.method === "POST"
          ? "INSERT OR IGNORE INTO deps (task_id, depends_on_id) VALUES (?, ?)"
          : "DELETE FROM deps WHERE task_id = ? AND depends_on_id = ?";
        await env.DB.prepare(q).bind(task_id, depends_on_id).run();
        // Touch the task so other clients pick up the change through /sync.
        await env.DB.prepare("UPDATE tasks SET updated_at = ? WHERE id = ?").bind(nowIso(), task_id).run();
        return json({ ok: true });
      }

      // POST /calendar/resync — push every live task with a date to Google Calendar. Run once after
      // setting up Google (tasks saved before that have no events), or any time the calendar looks wrong.
      if (seg[0] === "calendar" && seg[1] === "resync" && req.method === "POST") {
        if (!calendarEnabled(env)) return json({ error: sw("calendar_not_configured") }, 400);
        const r = await env.DB.prepare(
          "SELECT id FROM tasks WHERE (due_date IS NOT NULL OR deadline IS NOT NULL OR gcal_event_id IS NOT NULL OR gcal_deadline_event_id IS NOT NULL)",
        ).all<{ id: string }>();
        const errors: string[] = [];
        for (const { id } of r.results) { // one at a time: stays far below Google's rate limits
          const err = await syncCalendar(env, id);
          if (err) errors.push(`${id}: ${err}`);
        }
        return json({ checked: r.results.length, errors });
      }

      // GET /sync?since=ISO — everything changed since the phone last synced, including deletions.
      if (seg[0] === "sync" && req.method === "GET") {
        const since = url.searchParams.get("since") || "1970-01-01";
        // The next `since` is taken before reading, minus a margin: a write that commits while this request runs
        // (its updated_at is set a moment before it commits) is then picked up next time instead of being missed.
        // Rows may arrive twice; clients upsert, so that's harmless.
        const next = new Date(Date.now() - 10_000).toISOString();
        const [p, s, t, d, dl, dc] = await Promise.all([
          env.DB.prepare("SELECT * FROM projects WHERE updated_at > ?").bind(since).all(),
          env.DB.prepare("SELECT * FROM sections WHERE updated_at > ?").bind(since).all(),
          env.DB.prepare("SELECT * FROM tasks WHERE updated_at > ?").bind(since).all(),
          // deps has no timestamps; it is small, so send all of it when anything changed (or on a full sync).
          env.DB.prepare("SELECT task_id, depends_on_id FROM deps").all(),
          env.DB.prepare("SELECT * FROM dailies WHERE updated_at > ?").bind(since).all(),
          env.DB.prepare("SELECT * FROM daily_checks WHERE updated_at > ?").bind(since).all(),
        ]);
        const changed = since === "1970-01-01" || p.results.length + s.results.length + t.results.length > 0;
        return json({
          now: next, projects: p.results, sections: s.results, tasks: t.results, ...(changed ? { deps: d.results } : {}),
          dailies: dl.results, daily_checks: dc.results,
        });
      }

      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
