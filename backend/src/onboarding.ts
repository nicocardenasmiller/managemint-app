// First-run "set up your first project" conversation (docs/sharing-plan.md §5): the answers go to Claude, which
// proposes projects built from the PhD templates; this file checks and cleans the result into /projects/import bodies.
import PROMPT from "../../prompt/onboarding_prompt.md";
import GUIDELINES from "../../prompt/planning_guidelines.md";
import { addDays, fmtDate, parseDate } from "./postprocess";
import { templateOutlines } from "./phd-templates";
import type { BulkBody } from "./bulk";

export const COLORS = ["clay", "ochre", "olive", "sage", "teal", "slate", "iris", "plum"] as const;
export const MAX_PROJECTS = 4;
export const MAX_TASKS = 15;

export interface Answers { stage?: string; focus?: string; dates?: string; other?: string[]; semester_end?: string }
export interface ProposedTask { title: string; section: string | null; kind: "task" | "milestone"; start_date?: string | null; due_date: string | null; deadline: string | null; notes: string }
export interface ProposedProject { name: string; color: string; description: string; keywords: string[]; sections: string[]; tasks: ProposedTask[] }
export type DraftProject = BulkBody & { project: { name: string; color: string; description: string; keywords: string[] } };

const TOOL = {
  name: "propose_plan",
  description: "Propose the student's first projects.",
  input_schema: {
    type: "object", additionalProperties: false, required: ["projects"],
    properties: {
      projects: {
        type: "array", maxItems: MAX_PROJECTS,
        items: {
          type: "object", additionalProperties: false, required: ["name", "color", "description", "keywords", "sections", "tasks"],
          properties: {
            name: { type: "string" },
            color: { type: "string", enum: [...COLORS] },
            description: { type: "string" },
            keywords: { type: "array", items: { type: "string" } },
            sections: { type: "array", items: { type: "string" } },
            tasks: {
              type: "array", maxItems: MAX_TASKS,
              items: {
                type: "object", additionalProperties: false, required: ["title", "section", "kind", "due_date", "deadline", "notes"],
                properties: {
                  title: { type: "string" },
                  section: { type: ["string", "null"], description: "One of this project's sections" },
                  kind: { type: "string", enum: ["task", "milestone"] },
                  due_date: { type: ["string", "null"], description: "YYYY-MM-DD" },
                  deadline: { type: ["string", "null"], description: "YYYY-MM-DD, only for a real external cutoff" },
                  notes: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
  },
};

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const wd = (d: Date) => WEEKDAYS[(d.getUTCDay() + 6) % 7];

export const MAX_NOTES = 4000;

/** The shipped guidelines plus the user's own notes (settings key planning_guidelines), which win on conflict. */
export function guidelinesText(userNotes?: string | null): string {
  const base = GUIDELINES.slice(Math.max(0, GUIDELINES.indexOf("\n## ") + 1)).trim(); // drop the title and intro
  const own = typeof userNotes === "string" ? userNotes.replace(/[\u0000-\u0008\u000b-\u001f]/g, " ").trim().slice(0, MAX_NOTES) : "";
  return own ? `${base}\n\n### This student's own notes (these win where they disagree with the above)\n${own}` : base;
}

export function buildPrompt(today: string, tz: string, userNotes?: string | null): string {
  const t0 = parseDate(today);
  const calendar = Array.from({ length: 14 }, (_, i) => `- ${wd(addDays(t0, i))} ${fmtDate(addDays(t0, i))}`).join("\n");
  return PROMPT.replace("{{today}}", today).replace("{{weekday}}", wd(t0)).replace("{{tz}}", tz)
    .replace("{{calendar}}", calendar).replace("{{guidelines}}", () => guidelinesText(userNotes)).replace("{{templates}}", () => templateOutlines());
}

export const clean = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "");

export function answersText(a: Answers): string {
  const lines = [
    ["Stage of the program", clean(a.stage, 200)],
    ["Main thing this semester", clean(a.focus, 1000)],
    ["Fixed dates coming up", clean(a.dates, 1000)],
    ["Also takes their time", Array.isArray(a.other) ? a.other.map((x) => clean(x, 60)).filter(Boolean).join(", ") : ""],
    ["Semester ends", clean(a.semester_end, 40)],
  ].filter(([, v]) => v);
  return lines.map(([k, v]) => `${k}: ${v}`).join("\n");
}

/** A date that is valid, not before today and within two years; a past date without care moves to next year. */
export function fixDate(v: unknown, today: string): string | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  let d = parseDate(v);
  if (isNaN(d.getTime()) || fmtDate(d) !== v) return null;
  const t = parseDate(today);
  while (d < t) d = new Date(Date.UTC(d.getUTCFullYear() + 1, d.getUTCMonth(), d.getUTCDate()));
  if (d > addDays(t, 730)) return null;
  return fmtDate(d);
}

/** Turns the model's proposal into /projects/import bodies with fresh ids. Drops anything malformed. */
export function toDrafts(projects: unknown, today: string, newId: () => string = () => crypto.randomUUID()): DraftProject[] {
  if (!Array.isArray(projects)) return [];
  const used = new Set<string>();
  return projects.slice(0, MAX_PROJECTS).flatMap((p: Partial<ProposedProject>): DraftProject[] => {
    const name = clean(p?.name, 80);
    if (!name || /^(inbox|personal)$/i.test(name)) return [];
    let color = COLORS.includes(p.color as (typeof COLORS)[number]) && !used.has(p.color!) ? p.color! : COLORS.find((c) => !used.has(c)) ?? "slate";
    used.add(color);
    const sectionNames = Array.isArray(p.sections) ? [...new Set(p.sections.map((s) => clean(s, 60)).filter(Boolean))].slice(0, 8) : [];
    const sections = sectionNames.map((s, i) => ({ id: newId(), name: s, sort: i }));
    const sid = new Map(sections.map((s) => [s.name, s.id]));
    const tasks = (Array.isArray(p.tasks) ? p.tasks : []).slice(0, MAX_TASKS).flatMap((t: Partial<ProposedTask>, i) => {
      const title = clean(t?.title, 200);
      if (!title) return [];
      const due = fixDate(t.due_date, today), deadline = fixDate(t.deadline, today);
      // A start date only makes sense before the end it leads to; milestones have none.
      const end = due ?? deadline;
      const start = t.kind === "milestone" ? null : fixDate(t.start_date, today);
      return [{
        id: newId(), title, notes: clean(t.notes, 1000), kind: t.kind === "milestone" ? "milestone" as const : "task" as const,
        section_id: t.section ? sid.get(clean(t.section, 60)) ?? null : null, due_date: due, deadline, sort: i,
        ...(start && end && start < end ? { start_date: start } : {}),
      }];
    });
    if (!tasks.length) return [];
    const keywords = Array.isArray(p.keywords) ? p.keywords.map((k) => clean(k, 40)).filter(Boolean).slice(0, 10) : [];
    return [{ project: { name, color, description: clean(p.description, 300), keywords }, sections, tasks, deps: [], source: "template" }];
  });
}

export async function proposePlan(opts: { apiKey: string; model: string; answers: Answers; today: string; tz: string; notes?: string | null }): Promise<DraftProject[]> {
  const text = answersText(opts.answers);
  if (!text) return [];
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": opts.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: opts.model, max_tokens: 4096, system: buildPrompt(opts.today, opts.tz, opts.notes),
      tools: [TOOL], tool_choice: { type: "tool", name: "propose_plan" },
      messages: [{ role: "user", content: `The student's answers:\n${text}` }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { content: Array<{ type: string; input?: { projects?: unknown } }> };
  return toDrafts(data.content.find((b) => b.type === "tool_use")?.input?.projects, opts.today);
}
