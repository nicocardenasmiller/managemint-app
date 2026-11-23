// Deterministic fixes applied after the model answers. Mirrors prompt/run_tests.py:postprocess,
// which passed 20/20 three times. Change both together.

export interface DraftTask {
  title: string;
  notes: string;
  project_id: string;
  kind: "task" | "milestone";
  start_date: string | null;
  due_date: string | null;
  due_time: string | null;
  deadline: string | null;
  date_phrase: string;
  confidence: number;
  /** Name of a project to create on save, when the speaker asked for a new one (project_id is then "new"). */
  new_project?: string;
}

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const DATE_FIELDS = ["start_date", "due_date", "deadline"] as const;

// Local-date helpers on "YYYY-MM-DD" strings (UTC math, no time zone drift).
export function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
export function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000);
}
/** Monday = 0 … Sunday = 6, like Python's weekday(). */
export function weekday(d: Date): number {
  return (d.getUTCDay() + 6) % 7;
}

export function postprocess(tasks: DraftTask[], todayStr: string, transcript = ""): DraftTask[] {
  const today = parseDate(todayStr);
  const said = transcript.toLowerCase();

  for (const t of tasks) {
    const phrase = (t.date_phrase || "").toLowerCase();

    // 1. No year spoken and the date is already past -> next year.
    for (const k of DATE_FIELDS) {
      const v = t[k];
      if (!v) continue;
      let dt = parseDate(v);
      if (dt < today && !/\b(19|20)\d\d\b/.test(phrase)) {
        const y = dt.getUTCFullYear() + 1;
        const m = dt.getUTCMonth();
        const day = Math.min(dt.getUTCDate(), m === 1 ? 28 : dt.getUTCDate());
        dt = new Date(Date.UTC(y, m, day));
        while (dt < today) dt = new Date(Date.UTC(dt.getUTCFullYear() + 1, m, day));
        t[k] = fmtDate(dt);
      }
    }

    // 2. A deadline only counts if the speaker used deadline language; otherwise it is a due date.
    if (t.deadline && !/deadline|has to|have to be done|must|needs to be done|no later than/.test(said)) {
      if (!t.due_date) t.due_date = t.deadline;
      t.deadline = null;
    }

    // 3. "next week" (no weekday) -> closest Monday; "end of next week" -> that week's Friday.
    const monday = addDays(today, (0 - weekday(today) + 7) % 7 || 7);
    const namesDay = /monday|tuesday|wednesday|thursday|friday|saturday|sunday/.test(phrase);
    if (phrase.includes("next week") && !namesDay) {
      const set = DATE_FIELDS.filter((k) => t[k]);
      if (set.length === 1) {
        const target = /end of next week/.test(phrase) ? addDays(monday, 4) : monday;
        t[set[0]] = fmtDate(target);
      } else if (set.length > 1) {
        // A range ("starting next week until the 15th"): fix only the end that "next week" names.
        if (t.start_date && /\b(start\w*|begin\w*|from) next week/.test(phrase)) t.start_date = fmtDate(monday);
        const end = t.due_date ? "due_date" : "deadline";
        if (t[end] && /end of next week/.test(phrase)) t[end] = fmtDate(addDays(monday, 4));
      }
    }

    // 4. Weekday names -> closest upcoming weekday unless the speaker said otherwise.
    const named = DAYS.map((d, i) => (new RegExp(`\\b${d}\\b`).test(phrase) ? i : -1)).filter((i) => i >= 0);
    const override =
      /after next|a week from|following|\b\d{1,2}(st|nd|rd|th)\b|\d+\/\d+|january|february|march|april|may|june|july|august|september|october|november|december/.test(
        phrase,
      );
    const setFields = DATE_FIELDS.filter((k) => t[k]);
    if (named.length === 1 && !override && setFields.length === 1) {
      const ahead = (named[0] - weekday(today) + 7) % 7 || 7;
      t[setFields[0]] = fmtDate(addDays(today, ahead));
    }

    // 5. A start after the due date means the two were swapped.
    if (t.start_date && t.due_date && t.start_date > t.due_date) {
      [t.start_date, t.due_date] = [t.due_date, t.start_date];
    }

    // 6. "at 6" with no am/morning -> evening for 1-7.
    if (t.due_time) {
      const [h, m] = t.due_time.split(":").map(Number);
      if (h >= 1 && h <= 7 && !/\b(am|a\.m\.|morning)\b/.test(phrase)) {
        t.due_time = `${String(h + 12).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      }
    }
  }
  return tasks;
}
