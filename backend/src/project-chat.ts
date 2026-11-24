// New-project chat: a short back-and-forth with the assistant that ends in one draft project the person can edit and
// create. Stateless: the app sends the whole conversation and the current draft each turn; nothing is saved here.
// The approved draft goes to POST /projects/import like the onboarding drafts.
import PROMPT from "../../prompt/project_chat_prompt.md";
import { addDays, fmtDate, parseDate } from "./postprocess";
import { COLORS, MAX_TASKS, clean, guidelinesText, toDrafts, wd, type DraftProject } from "./onboarding";
import { outline } from "./templates";

export const MAX_QUESTIONS = 4;
export const MAX_MESSAGES = 30;
const MAX_TEMPLATE_TEXT = 40_000;

export interface ChatMessage { role: "user" | "assistant"; text: string }
export interface ChatReply { reply: string; options: string[]; draft: DraftProject | null }
export interface TemplateRow { id: string; name: string; body_json: string }
export interface ProjectInfo { name: string; color: string | null; description?: string | null }

const TASK_SCHEMA = {
  type: "object", additionalProperties: false, required: ["title", "section", "kind", "start_date", "due_date", "deadline", "notes"],
  properties: {
    title: { type: "string" },
    section: { type: ["string", "null"], description: "One of this project's sections" },
    kind: { type: "string", enum: ["task", "milestone"] },
    start_date: { type: ["string", "null"], description: "YYYY-MM-DD, optional, for steps that take weeks" },
    due_date: { type: ["string", "null"], description: "YYYY-MM-DD" },
    deadline: { type: ["string", "null"], description: "YYYY-MM-DD, only for a real external cutoff" },
    notes: { type: "string" },
  },
};

export const TOOL = {
  name: "respond",
  description: "Your turn in the chat: a message, optional quick replies, and the full project whenever you propose or change it.",
  input_schema: {
    type: "object", additionalProperties: false, required: ["message", "options", "project"],
    properties: {
      message: { type: "string", description: "One question, or a short note on the draft. Plain words, at most 3 sentences." },
      options: { type: "array", maxItems: 4, items: { type: "string" }, description: "Short replies the student can tap." },
      project: {
        type: ["object", "null"], additionalProperties: false, required: ["name", "color", "description", "keywords", "sections", "tasks"],
        description: "The whole project when you propose or change it, else null.",
        properties: {
          name: { type: "string" },
          color: { type: "string", enum: [...COLORS] },
          description: { type: "string" },
          keywords: { type: "array", items: { type: "string" } },
          sections: { type: "array", items: { type: "string" } },
          tasks: { type: "array", maxItems: MAX_TASKS, items: TASK_SCHEMA },
        },
      },
    },
  },
};

/** Keeps the last MAX_MESSAGES well-formed turns, starting with the person, alternating roles. */
export function cleanMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatMessage[] = [];
  for (const m of raw.slice(-MAX_MESSAGES)) {
    const role = m?.role === "assistant" ? "assistant" : m?.role === "user" ? "user" : null;
    const text = typeof m?.text === "string" ? m.text.replace(/[\u0000-\u0008\u000b-\u001f]/g, " ").trim().slice(0, 2000) : "";
    if (!role || !text) continue;
    if (!out.length && role === "assistant") continue; // the app's own opening line isn't sent to the model as a turn
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].text += `\n${text}`;
    else out.push({ role, text });
  }
  return out;
}

/** The current draft as text, so the assistant revises what the person sees (including their own edits). */
export function draftText(d: unknown): string {
  const p = d as DraftProject | null;
  if (!p?.project?.name || !Array.isArray(p.tasks)) return "None yet.";
  const sec = new Map((p.sections ?? []).map((s) => [s.id, s.name]));
  const lines = p.tasks.slice(0, 60).map((t) => {
    const dates = [t.start_date && `start ${t.start_date}`, t.due_date && `due ${t.due_date}`, t.deadline && `deadline ${t.deadline}`].filter(Boolean).join(", ");
    return `- ${clean(t.title, 200)}${t.section_id && sec.has(t.section_id) ? ` [${clean(sec.get(t.section_id), 60)}]` : ""}${t.kind === "milestone" ? " [milestone]" : ""}${dates ? ` (${dates})` : " (no date)"}${t.notes ? `: ${clean(t.notes, 200)}` : ""}`;
  });
  return `Name: ${clean(p.project.name, 80)}\nColor: ${clean(p.project.color, 20)}\nDescription: ${clean(p.project.description, 300)}\n` +
    `Keywords: ${(p.project.keywords ?? []).map((k) => clean(k, 40)).join(", ")}\nSections: ${[...sec.values()].map((s) => clean(s, 60)).join(", ") || "none"}\n` +
    `Tasks (the student may have edited these; keep their edits unless asked):\n${lines.join("\n") || "none"}`;
}

export function buildChatPrompt(o: {
  today: string; tz: string; notes?: string | null; templates: TemplateRow[]; templateId?: string | null;
  projects: ProjectInfo[]; draft?: unknown; questionsAsked: number;
}): string {
  const t0 = parseDate(o.today);
  const calendar = Array.from({ length: 14 }, (_, i) => `- ${wd(addDays(t0, i))} ${fmtDate(addDays(t0, i))}`).join("\n");
  const chosen = o.templates.find((t) => t.id === o.templateId);
  // The chosen template first, so it survives the length cap.
  const ordered = chosen ? [chosen, ...o.templates.filter((t) => t !== chosen)] : o.templates;
  let templates = "";
  for (const t of ordered) {
    const text = outline(clean(t.name, 120), t.body_json);
    if (!text || templates.length + text.length > MAX_TEMPLATE_TEXT) continue;
    templates += (templates ? "\n\n" : "") + text;
  }
  const rule = chosen
    ? `- The student chose to start from the template "${clean(chosen.name, 120)}". Build the project from it: keep its steps and sections unless they say otherwise, and ask for its day-0 date (${outline(chosen.name, chosen.body_json).match(/day 0 = ([^)]*)/)?.[1] ?? "the anchor date"}) if you don't know it.`
    : "- Start from the closest template below when one fits and adapt it: rename steps to fit, drop steps that don't apply, add steps they mentioned. If none fits, plan from scratch.";
  const projects = o.projects.length
    ? o.projects.slice(0, 40).map((p) => `- ${clean(p.name, 80)}${p.description ? `: ${clean(p.description, 160)}` : ""}`).join("\n")
    : "None yet.";
  const used = [...new Set(o.projects.map((p) => p.color).filter(Boolean))].join(", ") || "none";
  let prompt = PROMPT.replace("{{today}}", o.today).replace("{{weekday}}", wd(t0)).replace("{{tz}}", o.tz)
    .replace("{{calendar}}", calendar).replace("{{max_questions}}", String(MAX_QUESTIONS)).replace("{{max_tasks}}", String(MAX_TASKS))
    .replace("{{template_rule}}", () => rule).replace("{{used_colors}}", used).replace("{{projects}}", () => projects)
    .replace("{{guidelines}}", () => guidelinesText(o.notes)).replace("{{templates}}", () => templates || "None.")
    .replace("{{draft}}", () => draftText(o.draft));
  // Hard stop on questions: the person came to make a project, not to fill in a form.
  if (!o.draft && o.questionsAsked >= MAX_QUESTIONS)
    prompt += "\n\n## Now\nYou have asked enough. Propose the project in this turn, guessing anything still unknown and saying what you guessed.";
  return prompt;
}

/** Turns the model's tool input into a reply for the app. A draft only comes back when the model proposed or changed one. */
export function toReply(input: unknown, today: string, newId?: () => string): ChatReply {
  const i = (input ?? {}) as { message?: unknown; options?: unknown; project?: unknown };
  const options = Array.isArray(i.options) ? [...new Set(i.options.map((x) => clean(x, 60)).filter(Boolean))].slice(0, 4) : [];
  const draft = i.project ? toDrafts([i.project], today, newId)[0] ?? null : null;
  if (draft) draft.source = "template";
  return { reply: clean(i.message, 1200), options: draft ? [] : options, draft };
}

export async function chatTurn(opts: {
  apiKey: string; model: string; messages: ChatMessage[]; today: string; tz: string; notes?: string | null;
  templates: TemplateRow[]; templateId?: string | null; projects: ProjectInfo[]; draft?: unknown;
}): Promise<ChatReply> {
  const asked = opts.messages.filter((m) => m.role === "assistant").length;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": opts.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: opts.model, max_tokens: 4096,
      system: buildChatPrompt({ ...opts, questionsAsked: asked }),
      tools: [TOOL], tool_choice: { type: "tool", name: "respond" },
      messages: opts.messages.map((m) => ({ role: m.role, content: m.text })),
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { content: Array<{ type: string; input?: unknown }> };
  return toReply(data.content.find((b) => b.type === "tool_use")?.input, opts.today);
}
