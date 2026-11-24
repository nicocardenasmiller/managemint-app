// Templates on the server: the same body format as desktop/src/lib/templates.ts (sections + tasks with dates as day
// offsets from one anchor date). Used to save a project as a template (POST /projects/:id/template, so the phone
// needs no copy of this logic) and to show saved templates to the assistant in the new-project chat.

export interface TemplateTask {
  key: string; title: string; notes: string; kind: "task" | "milestone"; section: string | null; parent: string | null; priority: number;
  start: number | null; due: number | null; deadline: number | null; due_time: string | null;
}
export interface TemplateBody { v: 1; anchorLabel: string; sections: Array<{ key: string; name: string }>; tasks: TemplateTask[]; deps: Array<[string, string]> }

export interface SectionRow { id: string; name: string; sort: number }
export interface TaskRow {
  id: string; title: string; notes: string | null; kind: string; status: string; section_id: string | null; parent_id: string | null;
  priority: number | null; start_date: string | null; due_date: string | null; deadline: string | null; due_time: string | null; sort: number | null;
}

const day = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
export const diffDays = (a: string, b: string) => Math.round((day(a) - day(b)) / 86_400_000);

const when = (t: TaskRow) => (t.due_date ?? t.deadline)!;

/** Default anchor: the last milestone, else the latest due date or deadline (same rule as the desktop app). */
export function defaultAnchor(tasks: TaskRow[]): TaskRow | undefined {
  const dated = tasks.filter((t) => t.status !== "cancelled" && (t.due_date || t.deadline));
  const ms = dated.filter((t) => t.kind === "milestone").sort((a, b) => when(b).localeCompare(when(a)));
  return ms[0] ?? [...dated].sort((a, b) => when(b).localeCompare(when(a)))[0];
}

/** Build a template from a project. Done tasks are kept as open steps (a template is a plan); cancelled ones are dropped. */
export function fromProject(sections: SectionRow[], tasks: TaskRow[], deps: Array<{ task_id: string; depends_on_id: string }>, anchor: TaskRow | undefined, today: string, fallbackLabel: string): TemplateBody {
  const live = tasks.filter((t) => t.status !== "cancelled").sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  const anchorDate = anchor ? when(anchor) : today;
  const key = new Map(live.map((t, i) => [t.id, `t${i + 1}`]));
  const skey = new Map([...sections].sort((a, b) => a.sort - b.sort).map((s, i) => [s.id, `s${i + 1}`]));
  const off = (d: string | null) => (d ? diffDays(d, anchorDate) : null);
  return {
    v: 1, anchorLabel: anchor?.title ?? fallbackLabel,
    sections: [...sections].sort((a, b) => a.sort - b.sort).map((s) => ({ key: skey.get(s.id)!, name: s.name })),
    tasks: live.map((t) => ({
      key: key.get(t.id)!, title: t.title, notes: t.notes ?? "", kind: t.kind === "milestone" ? "milestone" : "task",
      section: t.section_id ? skey.get(t.section_id) ?? null : null,
      parent: t.parent_id ? key.get(t.parent_id) ?? null : null,
      priority: t.priority ?? 4, start: off(t.start_date), due: off(t.due_date), deadline: off(t.deadline), due_time: t.due_time,
    })),
    deps: deps.filter((d) => key.has(d.task_id) && key.has(d.depends_on_id)).map((d) => [key.get(d.task_id)!, key.get(d.depends_on_id)!]),
  };
}

const span = (t: TemplateTask) => {
  const end = t.due ?? t.deadline;
  if (end === null) return "no date";
  return t.start !== null && t.start < end ? `days ${t.start} to ${end}` : `day ${end}`;
};

/** A saved template as short text for the assistant. Bad bodies give "". */
export function outline(name: string, bodyJson: string): string {
  let b: TemplateBody;
  try { b = JSON.parse(bodyJson); } catch { return ""; }
  if (!b || !Array.isArray(b.tasks)) return "";
  const sec = new Map((b.sections ?? []).map((s) => [s.key, s.name]));
  const lines = b.tasks.slice(0, 40).map((t) =>
    `- ${t.title}${t.section && sec.has(t.section) ? ` [${sec.get(t.section)}]` : ""} (${span(t)})${t.kind === "milestone" ? " [milestone]" : ""}${t.deadline !== null && t.deadline !== undefined ? " [deadline]" : ""}${t.notes ? `: ${t.notes.slice(0, 200)}` : ""}`);
  return `### ${name} (day 0 = ${b.anchorLabel || "anchor date"})\nSections: ${[...sec.values()].join(", ") || "none"}\n${lines.join("\n")}`;
}
