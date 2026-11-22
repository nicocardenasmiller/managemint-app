// Bulk create: one project's sections, tasks and dependencies in one request. Used by
// "New project from template" (desktop) and the one-off dotpm import (scripts/import-dotpm.mjs).
// Rows carry client ids, so running the same import twice changes nothing (INSERT OR IGNORE).

export interface BulkSection { id: string; name: string; sort?: number }
export interface BulkTask {
  id: string; title: string; section_id?: string | null; parent_id?: string | null; notes?: string;
  kind?: "task" | "milestone"; status?: "todo" | "doing" | "done" | "cancelled";
  start_date?: string | null; due_date?: string | null; due_time?: string | null; deadline?: string | null;
  priority?: number; sort?: number;
}
export interface BulkBody {
  project_id?: string;                               // add to an existing project…
  project?: { name: string; color?: string | null; description?: string; keywords?: string[] }; // …or create a new one
  sections?: BulkSection[];
  tasks: BulkTask[];
  deps?: Array<[string, string]>;                    // [task_id, depends_on_id]
  source?: "template" | "manual";
}

const ID = /^[A-Za-z0-9-]{8,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;
export const MAX_BULK_TASKS = 500;

/** Returns an error message, or null if the body is valid. */
export function validateBulk(b: BulkBody): string | null {
  if (!b || !Array.isArray(b.tasks)) return "tasks is required";
  if (!b.project_id && !b.project?.name) return "project_id or project.name is required";
  if (b.tasks.length > MAX_BULK_TASKS) return `at most ${MAX_BULK_TASKS} tasks`;
  const sections = new Set<string>();
  for (const s of b.sections ?? []) {
    if (!ID.test(s.id) || !s.name) return `bad section ${JSON.stringify(s).slice(0, 80)}`;
    sections.add(s.id);
  }
  const tasks = new Set(b.tasks.map((t) => t.id));
  for (const t of b.tasks) {
    if (!ID.test(t.id ?? "")) return `bad task id ${t.id}`;
    if (!t.title || typeof t.title !== "string") return `task ${t.id} has no title`;
    for (const k of ["start_date", "due_date", "deadline"] as const) if (t[k] != null && !DATE.test(t[k]!)) return `task ${t.id}: bad ${k}`;
    if (t.due_time != null && !TIME.test(t.due_time)) return `task ${t.id}: bad due_time`;
    if (t.section_id && !sections.has(t.section_id)) return `task ${t.id}: unknown section ${t.section_id}`;
    if (t.parent_id && !tasks.has(t.parent_id)) return `task ${t.id}: unknown parent ${t.parent_id}`;
    if (t.kind && t.kind !== "task" && t.kind !== "milestone") return `task ${t.id}: bad kind`;
    if (t.status && !["todo", "doing", "done", "cancelled"].includes(t.status)) return `task ${t.id}: bad status`;
    if (t.priority != null && ![1, 2, 3, 4].includes(t.priority)) return `task ${t.id}: bad priority`;
  }
  for (const d of b.deps ?? []) {
    if (!Array.isArray(d) || d.length !== 2 || !tasks.has(d[0]) || !tasks.has(d[1]) || d[0] === d[1]) return `bad dependency ${JSON.stringify(d)}`;
  }
  return null;
}

export const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
