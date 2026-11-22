import { tr } from "./wording";
import { store } from "./store.svelte";
import { addDays, diffDays, today } from "./dates";
import type { Project, Section, Task } from "./types";
import type { Scope } from "./ui.svelte";

export const projectList = (): Project[] =>
  Object.values(store.projects).filter((p) => p.status !== "done").sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));

export const sectionsOf = (projectId: string): Section[] =>
  Object.values(store.sections).filter((s) => s.project_id === projectId).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));

export const isOpen = (t: Task) => t.status === "todo" || t.status === "doing";
/** The date a task is "on" for lists: due date, else deadline. */
export const whenOf = (t: Task) => t.due_date ?? t.deadline ?? null;

/** Done tasks finished more than 14 days ago are hidden when `hideOld` (H toggles). */
export function visible(t: Task, hideOld: boolean): boolean {
  if (t.status === "cancelled") return false;
  if (hideOld && t.status === "done") {
    const done = t.completed_at?.slice(0, 10) ?? t.updated_at.slice(0, 10);
    if (diffDays(today(), done) > 14) return false;
  }
  return true;
}

export function tasksInScope(scope: Scope): Task[] {
  const all = Object.values(store.tasks).filter((t) => !t.parent_id);
  const t0 = today();
  switch (scope) {
    case "all": return all;
    case "inbox": return all.filter((t) => t.project_id === "inbox");
    case "today": return all.filter((t) => isOpen(t) && whenOf(t) !== null && whenOf(t)! <= t0);
    case "upcoming": return all.filter((t) => isOpen(t) && whenOf(t) !== null && whenOf(t)! <= addDays(t0, 14));
    default: return all.filter((t) => t.project_id === scope.slice(2));
  }
}

export const subtasksOf = (id: string): Task[] =>
  Object.values(store.tasks).filter((t) => t.parent_id === id).sort((a, b) => a.sort - b.sort || a.created_at.localeCompare(b.created_at));

export function byWhen(a: Task, b: Task): number {
  return (whenOf(a) ?? "9999").localeCompare(whenOf(b) ?? "9999") || (a.due_time ?? "99").localeCompare(b.due_time ?? "99") ||
    a.priority - b.priority || a.sort - b.sort || a.title.localeCompare(b.title);
}

export const priorityMark = (p: number) => (p === 1 ? "!!" : p === 2 || p === 3 ? "!" : "");

export function scopeTitle(scope: Scope): string {
  if (scope === "all") return tr("scope.all");
  if (scope === "inbox") return tr("scope.inbox");
  if (scope === "today") return tr("scope.today");
  if (scope === "upcoming") return tr("scope.upcoming");
  return store.projects[scope.slice(2)]?.name ?? tr("scope.project");
}
