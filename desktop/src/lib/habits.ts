// Streak rules for Dailies. Android mirrors this in data/Habits.kt; keep the two identical and add a case to both
// test files (desktop/src/lib/habits.test.ts, android LogicTest.kt) for any change.
//
// - A daily is due on its weekdays (`days`, Mon..Sun "1111111"), or `per_week` times a week on any days.
// - Days it isn't due, and paused days, never break a streak. Checking an off day still counts.
// - One missed due day per week (Mon-Sun) is a rest day and doesn't break the streak.
// - Today never breaks a streak: until it's checked it is just "open".
// - Times-a-week dailies count streaks in weeks: a week counts when it reaches the target; the current
//   week only adds once it's reached.
// - Best = the longest run seen in the history we have (up to a year).
import { addDays, fromNum, toNum, weekday } from "./dates";

export type DayState = "done" | "rest" | "off" | "missed" | "open" | "paused" | "before" | "future";

export interface HabitInput {
  days: string;                       // "1111111", Mon..Sun
  per_week: number | null;
  pauses: Array<[string, string | null]>;
  created: string;                    // local date the daily was made
}

export interface HabitStats {
  streak: number;
  best: number;
  unit: "days" | "weeks";
  dueToday: boolean;                  // shows under Today in the Dailies tab
  doneToday: boolean;
  weekDone: number;                   // checks this week (Mon-Sun)
  rate: number;                       // 0..1, last 12 weeks
  state: (date: string) => DayState;
}

export const DAY_MILESTONES = [7, 30, 66, 100, 365];
export const WEEK_MILESTONES = [4, 12, 26, 52];
const HISTORY_DAYS = 366;

export const mondayOf = (d: string) => addDays(d, -weekday(d));

export function parsePauses(raw: unknown): Array<[string, string | null]> {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? (v as Array<[string, string | null]>) : [];
  } catch { return []; }
}
export const isPaused = (pauses: HabitInput["pauses"]) => pauses.some(([, to]) => to === null);
const pausedOn = (pauses: HabitInput["pauses"], d: string) => pauses.some(([from, to]) => d >= from && (to === null || d <= to));

/** [checked] holds the local dates this daily was checked. */
export function habitStats(h: HabitInput, checked: Set<string>, today: string): HabitStats {
  const earliest = [...checked].reduce((m, d) => (d < m ? d : m), h.created);
  const start = earliest < addDays(today, -HISTORY_DAYS) ? addDays(today, -HISTORY_DAYS) : earliest;
  const states = new Map<string, DayState>();
  const due = (d: string) => h.days[weekday(d)] === "1";
  let run = 0, best = 0;

  if (!h.per_week) {
    const restUsed = new Set<string>();
    for (let n = toNum(start), end = toNum(today); n <= end; n++) {
      const d = fromNum(n);
      if (pausedOn(h.pauses, d)) { states.set(d, checked.has(d) ? "done" : "paused"); continue; }
      if (checked.has(d)) { run++; states.set(d, "done"); }
      else if (!due(d)) states.set(d, "off");
      else if (d === today) states.set(d, "open");
      else if (!restUsed.has(mondayOf(d))) { restUsed.add(mondayOf(d)); states.set(d, "rest"); }
      else { run = 0; states.set(d, "missed"); }
      best = Math.max(best, run);
    }
  } else {
    const target = h.per_week;
    for (let w = mondayOf(start); w <= today; w = addDays(w, 7)) {
      let count = 0, pausedDays = 0;
      for (let i = 0; i < 7; i++) {
        const d = addDays(w, i);
        if (d < start || d > today) continue;
        if (checked.has(d)) { count++; states.set(d, "done"); }
        else if (pausedOn(h.pauses, d)) { pausedDays++; states.set(d, "paused"); }
        else states.set(d, d === today ? "open" : "off");
      }
      const current = w === mondayOf(today);
      if (count >= target) run++;
      else if (!current && pausedDays < 4 && w >= mondayOf(h.created)) run = 0;
      best = Math.max(best, run);
    }
  }

  // Share of due days done over the last 12 weeks (times-a-week: checks up to the target, per week).
  const from = addDays(mondayOf(today), -77);
  let hit = 0, total = 0;
  if (!h.per_week) {
    for (let n = toNum(from); n <= toNum(today); n++) {
      const s = states.get(fromNum(n));
      if (s === "done") hit++;
      if (s === "done" || s === "rest" || s === "missed") total++;
    }
  } else {
    for (let w = from; w <= today; w = addDays(w, 7)) {
      if (w < mondayOf(h.created)) continue;
      let c = 0;
      for (let i = 0; i < 7; i++) if (checked.has(addDays(w, i))) c++;
      hit += Math.min(c, h.per_week);
      if (w !== mondayOf(today) || c >= h.per_week) total += h.per_week;
    }
  }

  const monday = mondayOf(today);
  let weekDone = 0;
  for (let i = 0; i < 7; i++) if (checked.has(addDays(monday, i))) weekDone++;
  const doneToday = checked.has(today);
  const paused = pausedOn(h.pauses, today);
  return {
    streak: run, best, unit: h.per_week ? "weeks" : "days",
    dueToday: !paused && (doneToday || (h.per_week ? weekDone < h.per_week : due(today))),
    doneToday, weekDone, rate: total ? hit / total : 0,
    state: (d) => d > today ? "future" : d < start ? "before" : states.get(d) ?? "before",
  };
}

/** Did checking today just reach a milestone? */
export function milestone(s: HabitStats): number | null {
  const list = s.unit === "days" ? DAY_MILESTONES : WEEK_MILESTONES;
  return s.doneToday && list.includes(s.streak) ? s.streak : null;
}
