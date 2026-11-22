// Subscribable calendar feed (iCalendar / .ics): the default calendar option, no Google sign-in needed.
// Apple Calendar, Google Calendar and Outlook subscribe to a secret link and re-read it on their own schedule
// (Apple every 5 to 15 minutes, Google up to a day). One-way: edits in the calendar don't come back.
// Same events as the Google sync (calendar.ts): a due date/time event, plus a separate "Deadline:" event.
import { nextDay, wantedEvents } from "./calendar";
import { getSetting, randomToken, setSetting, type AccessEnv } from "./access";
import { sameSecret } from "./auth";
import { serverWording as sw } from "./wording";

export const FEED_SETTING = "calendar_feed_token";
/** Feed links look like /calendar/<token>.ics; the token is 32 random bytes (43 characters). */
export const FEED_PATH = /^\/calendar\/([A-Za-z0-9_-]{40,64})\.ics$/;

export interface FeedTask {
  id: string;
  title: string;
  notes: string | null;
  kind: string;
  status: string;
  due_date: string | null;
  due_time: string | null;
  deadline: string | null;
  duration_min: number | null;
  updated_at: string | null;
  deleted_at: string | null;
  task_calendar: number | null;
  project_calendar: number | null;
  project_name: string | null;
}

/** The feed token, created the first time anyone asks for it. */
export async function feedToken(env: AccessEnv): Promise<string> {
  const t = await getSetting(env, FEED_SETTING);
  if (t) return t;
  const fresh = randomToken(32);
  await setSetting(env, FEED_SETTING, fresh);
  return fresh;
}

/** A new token: the old link stops working, so every calendar has to subscribe again. */
export async function resetFeedToken(env: AccessEnv): Promise<string> {
  const fresh = randomToken(32);
  await setSetting(env, FEED_SETTING, fresh);
  return fresh;
}

export async function feedTokenMatches(env: AccessEnv, token: string): Promise<boolean> {
  const t = await getSetting(env, FEED_SETTING);
  return Boolean(t) && sameSecret(token, t!);
}

export function feedLinks(origin: string, token: string) {
  const https = `${origin}/calendar/${token}.ics`;
  const webcal = https.replace(/^https?:/, "webcal:");
  return {
    url: https,
    webcal,
    // Google's "add by URL" page, with the link filled in. Works on a computer; Google's phone app can't subscribe.
    google: `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`,
  };
}

export async function feedTasks(env: AccessEnv): Promise<FeedTask[]> {
  const r = await env.DB.prepare(
    `SELECT t.id, t.title, t.notes, t.kind, t.status, t.due_date, t.due_time, t.deadline, t.duration_min, t.updated_at, t.deleted_at,
            t.calendar AS task_calendar, p.calendar AS project_calendar, p.name AS project_name
     FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
     WHERE t.deleted_at IS NULL AND t.status != 'cancelled' AND (t.due_date IS NOT NULL OR t.deadline IS NOT NULL)`,
  ).all<FeedTask>();
  return r.results;
}

// ---------- iCalendar text ----------

/** RFC 5545 text escaping. */
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Lines longer than 75 bytes are folded (CRLF + space), never inside a UTF-8 character. */
function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "", bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > (out.length ? 74 : 75)) { out.push(cur); cur = ""; bytes = 0; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const compact = (d: string) => d.replace(/-/g, "");

/** Minutes the zone is ahead of UTC at a given instant (New York in winter: -300). */
function zoneOffset(ms: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(ms));
  const v = (k: string) => Number(parts.find((p) => p.type === k)?.value);
  return (Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"), v("second")) - Math.floor(ms / 1000) * 1000) / 60000;
}

/** A wall-clock date and time in `tz` as a UTC instant (ms). */
export function localToUtc(date: string, time: string, tz: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, h, mi);
  let ms = wall - zoneOffset(wall, tz) * 60000;
  ms = wall - zoneOffset(ms, tz) * 60000; // second pass settles the hours around a clock change
  return ms;
}

const utcStamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

function stampOf(t: FeedTask): string {
  const ms = t.updated_at ? Date.parse(t.updated_at.replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(t.updated_at) ? "" : "Z")) : NaN;
  return utcStamp(Number.isFinite(ms) ? ms : Date.now());
}

function events(t: FeedTask, tz: string, host: string): string[][] {
  const want = wantedEvents({
    calendar_off: t.project_calendar === 0 || t.task_calendar === 0,
    deleted_at: t.deleted_at, status: t.status, kind: t.kind as "task" | "milestone", due_date: t.due_date, deadline: t.deadline,
  });
  const out: string[][] = [];
  const stamp = stampOf(t);
  const desc = [t.notes?.trim(), t.project_name ? sw("calendar_project", { name: t.project_name }) : ""].filter(Boolean).join("\n\n");
  if (want.due && t.due_date) {
    const prefix = t.status === "done" && t.kind === "milestone" ? "✓ " : "";
    const ev = ["BEGIN:VEVENT", `UID:${t.id}@${host}`, `DTSTAMP:${stamp}`, `SUMMARY:${esc(prefix + t.title)}`];
    if (t.due_time && /^\d\d:\d\d/.test(t.due_time)) {
      const start = localToUtc(t.due_date, t.due_time, tz);
      ev.push(`DTSTART:${utcStamp(start)}`, `DTEND:${utcStamp(start + (t.duration_min ?? 30) * 60000)}`);
    } else {
      ev.push(`DTSTART;VALUE=DATE:${compact(t.due_date)}`, `DTEND;VALUE=DATE:${compact(nextDay(t.due_date))}`, "TRANSP:TRANSPARENT");
    }
    if (desc) ev.push(`DESCRIPTION:${esc(desc)}`);
    ev.push("END:VEVENT");
    out.push(ev);
  }
  if (want.deadline && t.deadline) {
    const ev = ["BEGIN:VEVENT", `UID:${t.id}-deadline@${host}`, `DTSTAMP:${stamp}`, `SUMMARY:${esc(sw("calendar_deadline", { title: t.title }))}`,
      `DTSTART;VALUE=DATE:${compact(t.deadline)}`, `DTEND;VALUE=DATE:${compact(nextDay(t.deadline))}`, "TRANSP:TRANSPARENT"];
    if (desc) ev.push(`DESCRIPTION:${esc(desc)}`);
    ev.push("END:VEVENT");
    out.push(ev);
  }
  return out;
}

/** The whole calendar as iCalendar text (CRLF line endings, as the standard asks). */
export function buildIcs(tasks: FeedTask[], tz: string, host: string): string {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Managemint//Calendar feed//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:Managemint", `X-WR-TIMEZONE:${tz}`, "X-WR-CALDESC:Tasks\\, due dates and deadlines from Managemint",
    "REFRESH-INTERVAL;VALUE=DURATION:PT15M", "X-PUBLISHED-TTL:PT15M",
  ];
  for (const t of tasks) for (const ev of events(t, tz, host)) lines.push(...ev);
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
