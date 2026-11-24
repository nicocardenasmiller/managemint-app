// Which open tasks are "ongoing" in Today, and in what order. Mirrored by android/.../data/Today.kt (same test cases).
//
// Ongoing = not done, not a milestone, not already overdue or due today (those have their own sections), and
// either marked "doing" or its start date has arrived. It stays in Today until it is checked off.
// Order: the one that ends soonest first (due date, else deadline; no end date last), then "doing" before
// "to do", then priority, then title. What has to be finished first sits at the top.
import type { Task } from "./types";

type T = Pick<Task, "status" | "kind" | "start_date" | "due_date" | "deadline" | "priority" | "title">;

export function isOngoing(t: T, today: string): boolean {
  if (t.status !== "todo" && t.status !== "doing") return false;
  if (t.kind === "milestone") return false;
  if ((t.due_date && t.due_date <= today) || (t.deadline && t.deadline <= today)) return false;
  return t.status === "doing" || (t.start_date !== null && t.start_date <= today);
}

export function byOngoing(a: T, b: T): number {
  return (a.due_date ?? a.deadline ?? "9999").localeCompare(b.due_date ?? b.deadline ?? "9999") ||
    Number(b.status === "doing") - Number(a.status === "doing") ||
    a.priority - b.priority || a.title.localeCompare(b.title);
}
