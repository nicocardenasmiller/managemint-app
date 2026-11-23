import PROMPT from "../../prompt/system_prompt.md";
import { addDays, parseDate, postprocess, type DraftTask } from "./postprocess";

export interface ProjectRow {
  id: string;
  name: string;
  description: string;
  keywords: string; // JSON array
}

const TOOL = {
  name: "save_tasks",
  description: "Return the tasks extracted from the transcript.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["tasks"],
    properties: {
      tasks: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "notes", "project_id", "new_project", "kind", "start_date", "due_date", "due_time", "deadline", "date_phrase", "confidence"],
          properties: {
            title: { type: "string" },
            notes: { type: "string", description: "Extra detail or suggestions; empty string if none" },
            project_id: { type: "string", description: 'An id from the project list, or "new" with new_project set' },
            new_project: { type: "string", description: "Name of a new project the speaker explicitly asked for; empty string otherwise" },
            kind: { type: "string", enum: ["task", "milestone"] },
            start_date: { type: ["string", "null"], description: "YYYY-MM-DD" },
            due_date: { type: ["string", "null"], description: "YYYY-MM-DD" },
            due_time: { type: ["string", "null"], description: "HH:MM 24h" },
            deadline: { type: ["string", "null"], description: "YYYY-MM-DD; latest acceptable date, only if spoken as a deadline" },
            date_phrase: { type: "string" },
            confidence: { type: "number" },
          },
        },
      },
    },
  },
};

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const wd = (d: Date) => WEEKDAYS[(d.getUTCDay() + 6) % 7];

/** `now` is the phone's local time as "YYYY-MM-DDTHH:MM". */
export function buildSystemPrompt(now: string, tz: string, projects: ProjectRow[], forced?: string | null): string {
  const today = now.slice(0, 10);
  const time = now.slice(11, 16);
  const t0 = parseDate(today);
  const calendar = Array.from({ length: 14 }, (_, i) => {
    const d = addDays(t0, i);
    const tag = i === 0 ? " (today)" : i === 1 ? " (tomorrow)" : "";
    return `- ${wd(d)} ${d.toISOString().slice(0, 10)}${tag}`;
  }).join("\n");
  const plist = projects
    .map((p) => {
      const kw: string[] = JSON.parse(p.keywords || "[]");
      return `- ${p.id}: ${p.name}. ${p.description || ""}${kw.length ? ` Keywords: ${kw.join(", ")}.` : ""}`;
    })
    .join("\n");
  const forcedLine = forced ? `The user chose project '${forced}' for this capture. Put every task in it.` : "";
  return PROMPT.replace("{{today}}", today)
    .replace("{{weekday}}", wd(t0))
    .replace("{{time}}", time)
    .replace("{{tz}}", tz)
    .replace("{{calendar}}", calendar)
    .replace("{{projects}}", plist)
    .replace("{{forced}}", forcedLine);
}

export async function parseTranscript(opts: {
  apiKey: string;
  model: string;
  transcript: string;
  now: string;
  tz: string;
  projects: ProjectRow[];
  forced?: string | null;
}): Promise<DraftTask[]> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": opts.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: 1024,
      system: buildSystemPrompt(opts.now, opts.tz, opts.projects, opts.forced),
      tools: [TOOL],
      tool_choice: { type: "tool", name: "save_tasks" },
      messages: [{ role: "user", content: `Transcript:\n${opts.transcript}` }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { content: Array<{ type: string; input?: { tasks: DraftTask[] } }> };
  const tool = data.content.find((b) => b.type === "tool_use");
  const tasks = tool?.input?.tasks ?? [];

  resolveProjects(tasks, opts.projects, opts.forced);
  return postprocess(tasks, opts.now.slice(0, 10), opts.transcript);
}

/**
 * Guard against unknown project ids and forced destinations. A requested new project whose name matches an
 * existing one goes to that project; otherwise it stays as project_id "new" with its name in new_project.
 */
export function resolveProjects(tasks: DraftTask[], projects: Pick<ProjectRow, "id" | "name">[], forced?: string | null): DraftTask[] {
  const ids = new Set(projects.map((p) => p.id));
  const byName = new Map(projects.map((p) => [norm(p.name), p.id]));
  for (const t of tasks) {
    const name = (t.new_project ?? "").trim().slice(0, 80);
    t.new_project = "";
    if (forced) { t.project_id = forced; continue; }
    if (name) {
      const existing = byName.get(norm(name));
      if (existing) t.project_id = existing;
      else { t.project_id = "new"; t.new_project = name; }
    } else if (!ids.has(t.project_id)) {
      t.project_id = "inbox";
      t.confidence = Math.min(t.confidence ?? 0, 0.4);
    }
  }
  return tasks;
}

const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]+/g, " ").trim();
