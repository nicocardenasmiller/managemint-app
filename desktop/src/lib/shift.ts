import { addDays } from "./dates";
import type { Task, TaskPatch } from "./types";

export type DragMode = "move" | "start" | "end" | "deadline";

/**
 * New dates when a task is dragged `days` on the timeline (or moved with [ / ]).
 * move: start and due shift together; a milestone shifts its date. The deadline stays put (it's a hard date)
 * unless it is the only date. start / end: resize, never past the other end. deadline: only the ⚑.
 */
export function shiftPatch(t: Pick<Task, "kind" | "start_date" | "due_date" | "deadline">, mode: DragMode, days: number): TaskPatch {
  if (!days) return {};
  const p: TaskPatch = {};
  if (mode === "deadline") {
    if (t.deadline) p.deadline = addDays(t.deadline, days);
    return p;
  }
  if (mode === "move") {
    if (t.start_date) p.start_date = addDays(t.start_date, days);
    if (t.due_date) p.due_date = addDays(t.due_date, days);
    if (!t.start_date && !t.due_date && t.deadline) p.deadline = addDays(t.deadline, days);
    return p;
  }
  const due = t.due_date ?? t.start_date;
  const start = t.start_date ?? t.due_date;
  if (!due || !start) return p;
  if (mode === "start") {
    const s = addDays(start, days);
    p.start_date = s > due ? due : s;
  } else {
    const d = addDays(due, days);
    if (t.due_date || !t.start_date) p.due_date = d < start ? start : d;
    else p.due_date = d < start ? start : d; // start-only task gets a due date
  }
  return p;
}

/** Apply a patch's dates to a task for previewing. */
export function withDates<T extends Pick<Task, "start_date" | "due_date" | "deadline">>(t: T, p: TaskPatch): T {
  return { ...t, ...("start_date" in p ? { start_date: p.start_date } : {}), ...("due_date" in p ? { due_date: p.due_date } : {}), ...("deadline" in p ? { deadline: p.deadline } : {}) };
}
