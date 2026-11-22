// Templates: a project's sections and tasks with dates stored as day offsets from one anchor date
// (e.g. the defense = day 0, "draft to committee" = -16). design/desktop.md §4.
import { addDays, diffDays, weekday } from "./dates";
import type { Dep, Section, Task } from "./types";

export interface TemplateTask {
  key: string; title: string; notes: string; kind: Task["kind"]; section: string | null; parent: string | null; priority: number;
  start: number | null; due: number | null; deadline: number | null; due_time: string | null;
}
export interface TemplateBody { v: 1; anchorLabel: string; sections: Array<{ key: string; name: string }>; tasks: TemplateTask[]; deps: Array<[string, string]> }
export interface Template { id: string; name: string; body_json: string; updated_at: string }

/** Build a template from a project. Done and cancelled tasks are kept as open tasks (a template is a plan). */
export function fromProject(sections: Section[], tasks: Task[], deps: Dep[], anchorDate: string, anchorLabel: string): TemplateBody {
  const live = tasks.filter((t) => t.status !== "cancelled");
  const key = new Map(live.map((t, i) => [t.id, `t${i + 1}`]));
  const skey = new Map(sections.map((s, i) => [s.id, `s${i + 1}`]));
  const off = (d: string | null) => (d ? diffDays(d, anchorDate) : null);
  return {
    v: 1, anchorLabel,
    sections: sections.map((s) => ({ key: skey.get(s.id)!, name: s.name })),
    tasks: live.map((t) => ({
      key: key.get(t.id)!, title: t.title, notes: t.notes, kind: t.kind,
      section: t.section_id ? skey.get(t.section_id) ?? null : null,
      parent: t.parent_id ? key.get(t.parent_id) ?? null : null,
      priority: t.priority, start: off(t.start_date), due: off(t.due_date), deadline: off(t.deadline), due_time: t.due_time,
    })),
    deps: deps.filter((d) => key.has(d.task_id) && key.has(d.depends_on_id)).map((d) => [key.get(d.task_id)!, key.get(d.depends_on_id)!]),
  };
}

/** Saturday/Sunday → the Friday before. */
export const rollToFriday = (d: string) => (weekday(d) === 5 ? addDays(d, -1) : weekday(d) === 6 ? addDays(d, -2) : d);
export const onWeekend = (d: string | null) => d !== null && weekday(d) >= 5;

export interface PlannedTask extends TemplateTask { start_date: string | null; due_date: string | null; deadline_date: string | null; weekend: boolean }

/** Dates for every task given the anchor date. */
export function plan(body: TemplateBody, anchorDate: string, roll: boolean): PlannedTask[] {
  return body.tasks.map((t) => {
    const at = (o: number | null) => (o === null ? null : addDays(anchorDate, o));
    const raw = { start: at(t.start), due: at(t.due), deadline: at(t.deadline) };
    const weekend = onWeekend(raw.start) || onWeekend(raw.due) || onWeekend(raw.deadline);
    const r = (d: string | null) => (d && roll ? rollToFriday(d) : d);
    let start = r(raw.start);
    const due = r(raw.due);
    if (start && due && start > due) start = due;
    return { ...t, start_date: start, due_date: due, deadline_date: r(raw.deadline), weekend };
  });
}

/** The body for POST /projects/import, with fresh ids. */
export function importBody(body: TemplateBody, planned: PlannedTask[], project: { name: string; color: string }, newId: () => string = () => crypto.randomUUID()) {
  const sid = new Map(body.sections.map((s) => [s.key, newId()]));
  const tid = new Map(planned.map((t) => [t.key, newId()]));
  return {
    project, source: "template" as const,
    sections: body.sections.map((s, i) => ({ id: sid.get(s.key)!, name: s.name, sort: i })),
    tasks: planned.map((t, i) => ({
      id: tid.get(t.key)!, title: t.title, notes: t.notes, kind: t.kind, priority: t.priority, sort: i,
      section_id: t.section ? sid.get(t.section) ?? null : null, parent_id: t.parent ? tid.get(t.parent) ?? null : null,
      start_date: t.start_date, due_date: t.due_date, deadline: t.deadline_date, due_time: t.due_time,
    })),
    deps: body.deps.filter(([a, b]) => tid.has(a) && tid.has(b)).map(([a, b]) => [tid.get(a)!, tid.get(b)!] as [string, string]),
  };
}

/** Default anchor: the last milestone, else the latest due date or deadline. */
export function defaultAnchor(tasks: Task[]): Task | undefined {
  const dated = tasks.filter((t) => t.status !== "cancelled" && (t.due_date || t.deadline));
  const when = (t: Task) => (t.due_date ?? t.deadline)!;
  const ms = dated.filter((t) => t.kind === "milestone").sort((a, b) => when(b).localeCompare(when(a)));
  return ms[0] ?? dated.sort((a, b) => when(b).localeCompare(when(a)))[0];
}
