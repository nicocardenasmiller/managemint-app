// Dates are local "YYYY-MM-DD" strings in the server's time zone (its TZ setting; SPEC.md). Math is done in UTC on
// those strings, so the computer's own time zone never shifts a date.
import { tr } from "./wording";
export let TZ = "America/New_York";

/** Called once the server says which time zone this copy uses (friends' copies can differ). Ignores invalid names. */
export function setTimeZone(tz: unknown) {
  if (typeof tz !== "string" || !tz) return;
  try { new Intl.DateTimeFormat("en-CA", { timeZone: tz }); TZ = tz; } catch { /* keep the default */ }
}

const DAY = 86400000;
export const toNum = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / DAY;
};
export const fromNum = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);
export const addDays = (s: string, n: number) => fromNum(toNum(s) + n);
export const diffDays = (a: string, b: string) => toNum(a) - toNum(b);
/** Monday = 0 … Sunday = 6 */
export const weekday = (s: string) => (new Date(toNum(s) * DAY).getUTCDay() + 6) % 7;

/** Today in the server's time zone. */
export function today(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
/** "YYYY-MM-DDTHH:MM" local time, the format /capture expects. */
export function nowLocal(now = new Date()): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(now).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

const MONTHS = tr("dates.months").split(" ");
const WD = tr("dates.weekdays").split(" ");
export const monthName = (s: string) => MONTHS[Number(s.slice(5, 7)) - 1];
export const shortDate = (s: string) => `${monthName(s)} ${Number(s.slice(8, 10))}`;
export const weekdayName = (s: string) => WD[weekday(s)];

/** "Today", "Tomorrow", "Fri", "Mar 4", "Mar 4, 2028" relative to `t`. */
export function label(s: string, t = today()): string {
  const d = diffDays(s, t);
  if (d === 0) return tr("dates.today");
  if (d === 1) return tr("dates.tomorrow");
  if (d === -1) return tr("dates.yesterday");
  if (d > 1 && d < 7) return weekdayName(s);
  return s.slice(0, 4) === t.slice(0, 4) ? shortDate(s) : `${shortDate(s)}, ${s.slice(0, 4)}`;
}

/** Deadline wording from tokens.md §3: neutral until 7 days out, then "3d left"; past = "overdue 2d". */
export function deadlineState(deadline: string, t = today()): { danger: boolean; overdue: boolean; text: string } {
  const d = diffDays(deadline, t);
  if (d < 0) return { danger: true, overdue: true, text: tr("dates.overdue", { n: -d }) };
  if (d === 0) return { danger: true, overdue: false, text: tr("dates.due_today") };
  if (d <= 7) return { danger: true, overdue: false, text: tr("dates.left", { n: d }) };
  return { danger: false, overdue: false, text: "" };
}

export const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
