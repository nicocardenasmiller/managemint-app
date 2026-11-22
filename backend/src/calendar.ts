// Google Calendar sync: one-way, app -> calendar.
// Each task can own two events: its due date/time, and its deadline ("Deadline: ...").
import { serverWording as sw } from "./wording";

export interface CalEnv {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REFRESH_TOKEN?: string;
  GCAL_CALENDAR_ID?: string;
  TZ: string;
}

export interface CalTask {
  id: string;
  title: string;
  notes: string;
  kind: "task" | "milestone";
  status: string;
  due_date: string | null;
  due_time: string | null;
  deadline: string | null;
  duration_min: number | null;
  gcal_event_id: string | null;
  gcal_deadline_event_id: string | null;
  deleted_at?: string | null;
  /** The task's project is switched off the calendar. */
  calendar_off?: boolean;
}

export function calendarEnabled(env: CalEnv): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REFRESH_TOKEN && env.GCAL_CALENDAR_ID);
}

// Google access tokens last an hour. Reusing one within an isolate halves the requests per task, which matters
// for bulk work (resync, imports) under Cloudflare's 50-subrequests-per-request limit on the free plan.
let cachedToken: { token: string; until: number; key: string } | null = null;

async function accessToken(env: CalEnv): Promise<string> {
  const key = env.GOOGLE_REFRESH_TOKEN!;
  if (cachedToken && cachedToken.key === key && cachedToken.until > Date.now()) return cachedToken.token;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      refresh_token: env.GOOGLE_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google token ${res.status}: ${await res.text()}`);
  const r = (await res.json()) as { access_token: string; expires_in?: number };
  cachedToken = { token: r.access_token, until: Date.now() + Math.max(0, (r.expires_in ?? 3600) - 300) * 1000, key };
  return r.access_token;
}

export function nextDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

function addMinutes(date: string, time: string, minutes: number): string {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi + minutes));
  return t.toISOString().slice(0, 16) + ":00";
}

function dueEventBody(t: CalTask, tz: string) {
  const prefix = t.status === "done" && t.kind === "milestone" ? "✓ " : "";
  const base = { summary: prefix + t.title, description: t.notes || undefined, extendedProperties: { private: { managemintTask: t.id } } };
  if (t.due_time) {
    const start = `${t.due_date}T${t.due_time}:00`;
    return { ...base, start: { dateTime: start, timeZone: tz }, end: { dateTime: addMinutes(t.due_date!, t.due_time, t.duration_min ?? 30), timeZone: tz } };
  }
  return { ...base, start: { date: t.due_date }, end: { date: nextDay(t.due_date!) }, transparency: "transparent" };
}

function deadlineEventBody(t: CalTask) {
  return {
    summary: sw("calendar_deadline", { title: t.title }),
    start: { date: t.deadline },
    end: { date: nextDay(t.deadline!) },
    transparency: "transparent",
    extendedProperties: { private: { managemintTask: t.id, managemintDeadline: "1" } },
  };
}

async function gcal(env: CalEnv, token: string, method: string, path: string, body?: unknown): Promise<any> {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env.GCAL_CALENDAR_ID!)}/events${path}`;
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (method === "DELETE" && (res.status === 404 || res.status === 410)) return null; // already gone
  if (method === "PUT" && (res.status === 404 || res.status === 410)) return null; // deleted by hand in Google Calendar: caller recreates
  if (!res.ok) throw new Error(`Google Calendar ${method} ${res.status}: ${await res.text()}`);
  return method === "DELETE" ? null : res.json();
}

/** Update the event if it still exists, otherwise create it. Returns the event id. */
async function upsert(env: CalEnv, token: string, id: string | null, body: unknown): Promise<string> {
  if (id) {
    const updated = await gcal(env, token, "PUT", `/${id}`, body);
    if (updated) return updated.id;
  }
  return (await gcal(env, token, "POST", "", body)).id;
}

/** Which of a task's two events belong on a calendar. Shared by the Google sync and the subscribable feed (feed.ts). */
export function wantedEvents(t: Pick<CalTask, "calendar_off" | "deleted_at" | "status" | "kind" | "due_date" | "deadline">): { due: boolean; deadline: boolean } {
  const gone = Boolean(t.calendar_off) || Boolean(t.deleted_at) || t.status === "cancelled" || (t.status === "done" && t.kind !== "milestone");
  return { due: !gone && Boolean(t.due_date), deadline: !gone && Boolean(t.deadline) };
}

/**
 * Bring a task's calendar events in line with the task. Returns the event ids to store.
 * Rules (SPEC.md): due date -> event; deadline -> separate "Deadline:" event; milestones always;
 * done/cancelled/deleted -> remove events (done milestones keep theirs, marked ✓).
 */
export async function syncTaskEvents(env: CalEnv, t: CalTask): Promise<{ gcal_event_id: string | null; gcal_deadline_event_id: string | null }> {
  if (!calendarEnabled(env)) return { gcal_event_id: t.gcal_event_id, gcal_deadline_event_id: t.gcal_deadline_event_id };
  const { due: wantDue, deadline: wantDl } = wantedEvents(t);
  // Nothing on the calendar and nothing to put there: skip the Google round trip.
  if (!wantDue && !wantDl && !t.gcal_event_id && !t.gcal_deadline_event_id) {
    return { gcal_event_id: null, gcal_deadline_event_id: null };
  }
  const token = await accessToken(env);

  let dueId = t.gcal_event_id;
  if (wantDue) {
    dueId = await upsert(env, token, dueId, dueEventBody(t, env.TZ));
  } else if (dueId) {
    await gcal(env, token, "DELETE", `/${dueId}`);
    dueId = null;
  }

  let dlId = t.gcal_deadline_event_id;
  if (wantDl) {
    dlId = await upsert(env, token, dlId, deadlineEventBody(t));
  } else if (dlId) {
    await gcal(env, token, "DELETE", `/${dlId}`);
    dlId = null;
  }
  return { gcal_event_id: dueId, gcal_deadline_event_id: dlId };
}
