// Assistant connector: a small MCP server (Streamable HTTP, JSON responses, no sessions) that an AI assistant such as
// Claude adds as a custom connector. It can find and read tasks, add new tasks, and edit checklists (subtasks).
// Nothing else: no deleting, no editing existing tasks or projects.
//
// Sign-in is OAuth (oauth.ts): the person approves each assistant app on this server, and can remove it on the setup page.
import type { AccessEnv } from "./access";

/** What the connector needs: the database, the user's time zone, and a hook to put a new task on the calendar. */
export interface ConnectorEnv extends AccessEnv {
  TZ?: string;
  /** Called after a task with dates is created (Google Calendar sync on servers that have it). */
  onTaskCreated?: (id: string) => Promise<unknown>;
}
import { VERSION } from "./version";

/** Limits so a confused assistant can't flood a task. */
export const MAX_ITEMS_PER_CALL = 30;
export const MAX_ITEMS_PER_TASK = 100;
export const MAX_TITLE = 300;
const MAX_RESULTS = 30;
/** New tasks per day through the connector, so a runaway assistant can't flood the planner. */
export const MAX_NEW_TASKS_PER_DAY = 100;

/** Today's date (YYYY-MM-DD) in the user's time zone. */
export function todayIn(tz: string | undefined, now = new Date()): string {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(now); }
  catch { return now.toISOString().slice(0, 10); }
}

/** A real calendar date in YYYY-MM-DD form. */
export function isDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
const isTime = (s: unknown): s is string => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const PRIORITY: Record<string, number> = { high: 1, medium: 2, none: 4 };
const priorityName = (p: number) => (p === 1 ? "high" : p === 2 || p === 3 ? "medium" : "none");

// ---------- MCP (JSON-RPC 2.0) ----------

const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

// Instructions and tool descriptions are read by the assistant, not shown to people, so they stay in code.
/** How checklists should read, so they fit the app's checklist card (docs/design/checklists.md). Shared by the
 *  instructions and the add_task / add_checklist descriptions. */
export const CHECKLIST_STYLE =
  "A checklist item is one concrete step the user can tick off in one sitting. Start each item with a verb " +
  "(\"Email Maria the draft\", not \"Draft\" or \"Maria\"). Keep items short: about 3 to 8 words, under 60 characters, one line on a phone; " +
  "put explanations in the task's notes, not in items. No numbering, bullets, checkboxes, emoji or trailing periods. " +
  "List items in the order they will be done. Aim for 3 to 10 items; if a task needs more than about 12, suggest splitting it into " +
  "separate tasks instead. Don't repeat items already on the checklist (the server skips exact repeats) and don't add an item that " +
  "just restates the task title. Don't tick items or rename them unless the user asks. add_checklist appends to the end; " +
  "it can't reorder or remove items, so tell the user when they need to do that in the app.";

const INSTRUCTIONS =
  "Managemint is the user's task planner. Use find_tasks to locate a task (search by words in its title), then get_task to see its " +
  "notes and current checklist before changing anything. If several tasks match, ask the user which one they mean instead of guessing. " +
  "Checklists: " + CHECKLIST_STYLE + " " +
  "Dates are YYYY-MM-DD in the user's time zone; find_tasks returns today's date. To answer questions like \"what's due this week\" " +
  "use find_tasks with due_from/due_to, or overdue. add_task creates a new task: use due_date for when the user plans to do it and " +
  "deadline only when they say it's a hard deadline (\"deadline\", \"has to be done by\", \"must\"). Before adding several tasks, " +
  "check with find_tasks that they don't already exist, and tell the user what you added.";

type Json = Record<string, unknown>;
const str = { type: "string" } as const;

export const TOOLS = [
  {
    name: "find_tasks",
    description: "Find tasks by words in their title (case-insensitive), by date and by status. Without filters, lists open tasks, " +
      "soonest due first. Returns today's date and each task's id, title, project, status, priority, dates and checklist progress. " +
      "A task matches a date range if its due date or its deadline falls in it. Checklist items themselves are not listed.",
    inputSchema: {
      type: "object",
      properties: {
        query: { ...str, description: "Words from the task title, e.g. \"chapter 2 draft\"." },
        project: { ...str, description: "Only tasks in this project (its id or name)." },
        include_done: { type: "boolean", description: "Also return done tasks. Default false." },
        status: { type: "string", enum: ["todo", "doing", "done"], description: "Only tasks with this status." },
        due_from: { ...str, description: "Only tasks due (or with a deadline) on or after this date, YYYY-MM-DD." },
        due_to: { ...str, description: "Only tasks due (or with a deadline) on or before this date, YYYY-MM-DD." },
        overdue: { type: "boolean", description: "Only open tasks whose due date or deadline is before today." },
      },
      additionalProperties: false,
    },
    annotations: { title: "Find tasks", readOnlyHint: true },
  },
  {
    name: "list_projects",
    description: "List the user's projects (id and name).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { title: "List projects", readOnlyHint: true },
  },
  {
    name: "get_task",
    description: "Get one task with its notes, dates and checklist (each item's id, title and whether it's done).",
    inputSchema: { type: "object", properties: { task_id: { ...str, description: "The task id from find_tasks." } }, required: ["task_id"], additionalProperties: false },
    annotations: { title: "Get task", readOnlyHint: true },
  },
  {
    name: "add_task",
    description: "Create a new task. Without a project it goes to the Inbox. Returns the new task. " +
      "It appears on the user's phone, web app and calendar like any other task.",
    inputSchema: {
      type: "object",
      properties: {
        title: { ...str, description: "Short task title, starting with a verb where natural." },
        project: { ...str, description: "Project id or name (see list_projects). Default: Inbox." },
        notes: { ...str, description: "Optional notes." },
        start_date: { ...str, description: "YYYY-MM-DD: when work starts, for tasks that span several days." },
        due_date: { ...str, description: "YYYY-MM-DD: when the user plans to do or finish it." },
        due_time: { ...str, description: "HH:MM, 24-hour; needs due_date." },
        deadline: { ...str, description: "YYYY-MM-DD: hard deadline, only when the user says so." },
        priority: { type: "string", enum: ["high", "medium", "none"], description: "Default none." },
        checklist: { type: "array", items: str, maxItems: MAX_ITEMS_PER_CALL, description: "Optional checklist items, in the order they'll be done. Short verb-first steps (see the server instructions)." },
      },
      required: ["title"],
      additionalProperties: false,
    },
    annotations: { title: "Add task", readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: "add_checklist",
    description: `Add checklist items to the end of a task's checklist (at most ${MAX_ITEMS_PER_CALL} per call). Works on top-level tasks only. ` +
      "Returns the task's full checklist afterwards, and any items skipped because they were already on it. " + CHECKLIST_STYLE,
    inputSchema: {
      type: "object",
      properties: {
        task_id: { ...str, description: "The task id from find_tasks." },
        items: { type: "array", items: str, minItems: 1, maxItems: MAX_ITEMS_PER_CALL, description: "Item titles in the order they'll be done, e.g. [\"Reread Maria's comments\", \"Fix the coding table\", \"Send the draft to Maria\"]." },
      },
      required: ["task_id", "items"],
      additionalProperties: false,
    },
    annotations: { title: "Add checklist items", readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: "update_checklist_item",
    description: "Tick or untick a checklist item, or rename it. Only works on checklist items (ids from get_task), not on tasks.",
    inputSchema: {
      type: "object",
      properties: {
        item_id: { ...str, description: "The checklist item id from get_task." },
        done: { type: "boolean", description: "true to tick, false to untick." },
        title: { ...str, description: "New title: a short step starting with a verb." },
      },
      required: ["item_id"],
      additionalProperties: false,
    },
    annotations: { title: "Update checklist item", readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
];

interface TaskRow {
  id: string; project_id: string; section_id: string | null; parent_id: string | null; title: string; notes: string;
  kind: string; status: string; start_date: string | null; due_date: string | null; due_time: string | null; deadline: string | null;
  priority: number; sort: number; deleted_at: string | null;
}

class ToolError extends Error {}

const nowIso = () => new Date().toISOString();
const cleanTitle = (s: unknown) => (typeof s === "string" ? s.replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE) : "");
/** A checklist item title without list markers an assistant might add ("- ", "1. ", "[ ] ", "☐ "). Same markers as the apps' paste rule. */
const itemTitle = (s: unknown) => cleanTitle(typeof s === "string" ? s.replace(/^\s*(?:[-*•–]\s+|\d+[.)]\s+)?(?:\[[ xX]?\]\s*|[☐☑✓✔]\s*)?/, "") : s);
const sameItem = (s: string) => s.toLowerCase().replace(/[.!]+$/, "").trim();
/** Drop items already on the checklist (or repeated in the same call), ignoring case and a trailing period. */
function withoutRepeats(titles: string[], existing: string[]) {
  const seen = new Set(existing.map(sameItem));
  const keep: string[] = [], skipped: string[] = [];
  for (const t of titles) { const k = sameItem(t); (seen.has(k) ? skipped : keep).push(t); seen.add(k); }
  return { keep, skipped };
}

async function liveTask(env: AccessEnv, id: unknown): Promise<TaskRow> {
  if (typeof id !== "string" || !id) throw new ToolError("task_id is required.");
  const t = await env.DB.prepare("SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL").bind(id).first<TaskRow>();
  if (!t) throw new ToolError(`No task with id ${id}. Use find_tasks to look it up.`);
  return t;
}

async function checklist(env: AccessEnv, taskId: string) {
  const r = await env.DB.prepare(
    "SELECT id, title, status FROM tasks WHERE parent_id = ? AND deleted_at IS NULL AND status != 'cancelled' ORDER BY sort, created_at",
  ).bind(taskId).all<{ id: string; title: string; status: string }>();
  return r.results.map((s) => ({ id: s.id, title: s.title, done: s.status === "done" }));
}

async function projectNames(env: AccessEnv): Promise<Map<string, string>> {
  const r = await env.DB.prepare("SELECT id, name FROM projects WHERE deleted_at IS NULL ORDER BY sort").all<{ id: string; name: string }>();
  return new Map(r.results.map((p) => [p.id, p.name]));
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);

async function findTasks(env: ConnectorEnv, a: Json) {
  const names = await projectNames(env);
  const today = todayIn(env.TZ);
  const where = ["t.deleted_at IS NULL", "t.parent_id IS NULL", "t.status != 'cancelled'"];
  const binds: unknown[] = [];
  const status = typeof a.status === "string" && ["todo", "doing", "done"].includes(a.status) ? a.status : null;
  if (a.status !== undefined && !status) throw new ToolError("status must be todo, doing or done.");
  if (status) { where.push("t.status = ?"); binds.push(status); }
  else if (!a.include_done) where.push("t.status != 'done'");
  for (const k of ["due_from", "due_to"]) if (a[k] !== undefined && !isDate(a[k])) throw new ToolError(`${k} must be a date like ${today}.`);
  if (a.due_from || a.due_to) {
    const from = (a.due_from as string) ?? "0000-01-01", to = (a.due_to as string) ?? "9999-12-31";
    where.push("((t.due_date BETWEEN ? AND ?) OR (t.deadline BETWEEN ? AND ?))"); binds.push(from, to, from, to);
  }
  if (a.overdue) { where.push("t.status IN ('todo','doing') AND (t.due_date < ? OR t.deadline < ?)"); binds.push(today, today); }
  if (typeof a.project === "string" && a.project.trim()) {
    const want = a.project.trim().toLowerCase();
    const id = [...names].find(([pid, name]) => pid.toLowerCase() === want || name.toLowerCase() === want)?.[0];
    if (!id) throw new ToolError(`No project called "${a.project}". Use list_projects to see them.`);
    where.push("t.project_id = ?"); binds.push(id);
  }
  const words = typeof a.query === "string" ? a.query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8) : [];
  for (const w of words) { where.push("LOWER(t.title) LIKE ? ESCAPE '\\'"); binds.push(`%${likeEscape(w)}%`); }
  const r = await env.DB.prepare(
    `SELECT t.id, t.title, t.project_id, t.status, t.priority, t.start_date, t.due_date, t.due_time, t.deadline,
            (SELECT COUNT(*) FROM tasks s WHERE s.parent_id = t.id AND s.deleted_at IS NULL AND s.status != 'cancelled') AS items,
            (SELECT COUNT(*) FROM tasks s WHERE s.parent_id = t.id AND s.deleted_at IS NULL AND s.status = 'done') AS items_done
     FROM tasks t WHERE ${where.join(" AND ")}
     ORDER BY t.status = 'done', COALESCE(t.due_date, t.deadline, '9999'), t.sort LIMIT ${MAX_RESULTS + 1}`,
  ).bind(...binds).all<Json & { project_id: string; priority: number; items: number; items_done: number }>();
  const tasks = r.results.slice(0, MAX_RESULTS).map(({ project_id, priority, items, items_done, ...t }) =>
    ({ ...t, priority: priorityName(priority), project: names.get(project_id) ?? project_id, checklist: items ? `${items_done}/${items} done` : "none" }));
  return { today, tasks, more: r.results.length > MAX_RESULTS };
}

async function getTask(env: AccessEnv, a: Json) {
  const t = await liveTask(env, a.task_id);
  const names = await projectNames(env);
  const parent = t.parent_id ? await env.DB.prepare("SELECT id, title FROM tasks WHERE id = ?").bind(t.parent_id).first() : null;
  return {
    id: t.id, title: t.title, project: names.get(t.project_id) ?? t.project_id, status: t.status, kind: t.kind, priority: priorityName(t.priority),
    start_date: t.start_date, due_date: t.due_date, due_time: t.due_time, deadline: t.deadline, notes: t.notes,
    ...(parent ? { checklist_item_of: parent } : { checklist: await checklist(env, t.id) }),
  };
}

async function projectId(env: AccessEnv, want: unknown): Promise<string> {
  if (want === undefined || want === null || want === "") return "inbox";
  if (typeof want !== "string") throw new ToolError("project must be a project id or name.");
  const w = want.trim().toLowerCase();
  const hit = [...(await projectNames(env))].find(([id, name]) => id.toLowerCase() === w || name.toLowerCase() === w);
  if (!hit) throw new ToolError(`No project called "${want}". Use list_projects to see them, or leave project out for the Inbox.`);
  return hit[0];
}

async function addTask(env: ConnectorEnv, a: Json) {
  const title = cleanTitle(a.title);
  if (!title) throw new ToolError("title is required.");
  const pid = await projectId(env, a.project);
  for (const k of ["start_date", "due_date", "deadline"]) if (a[k] !== undefined && a[k] !== null && !isDate(a[k])) throw new ToolError(`${k} must be a date like ${todayIn(env.TZ)}.`);
  if (a.due_time !== undefined && a.due_time !== null && !isTime(a.due_time)) throw new ToolError("due_time must be HH:MM, 24-hour.");
  if (a.due_time && !a.due_date) throw new ToolError("due_time needs a due_date.");
  const end = (a.due_date ?? a.deadline) as string | undefined;
  if (a.start_date && end && (a.start_date as string) > end) throw new ToolError("start_date is after the due date.");
  if (a.priority !== undefined && !(typeof a.priority === "string" && a.priority in PRIORITY)) throw new ToolError("priority must be high, medium or none.");
  const items = a.checklist === undefined ? [] : Array.isArray(a.checklist) ? withoutRepeats(a.checklist.map(itemTitle).filter(Boolean), []).keep : null;
  if (!items) throw new ToolError("checklist must be a list of item titles.");
  if (items.length > MAX_ITEMS_PER_CALL) throw new ToolError(`At most ${MAX_ITEMS_PER_CALL} checklist items.`);
  const day = new Date().toISOString().slice(0, 10);
  const made = await env.DB.prepare("SELECT COUNT(*) AS n FROM tasks WHERE id LIKE 'ai-%' AND created_at >= ?")
    .bind(day).first<{ n: number }>();
  if ((made?.n ?? 0) >= MAX_NEW_TASKS_PER_DAY) throw new ToolError(`The assistant can add at most ${MAX_NEW_TASKS_PER_DAY} tasks a day.`);
  const sort = ((await env.DB.prepare("SELECT MAX(sort) AS m FROM tasks WHERE project_id = ? AND parent_id IS NULL").bind(pid).first<{ m: number | null }>())?.m ?? 0) + 1;
  // Tasks the assistant makes get ids starting "ai-", which the daily limit above counts.
  const id = "ai-" + crypto.randomUUID();
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO tasks (id, project_id, title, notes, start_date, due_date, due_time, deadline, priority, sort, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)`,
  ).bind(id, pid, title, typeof a.notes === "string" ? a.notes.slice(0, 10000) : "", a.start_date ?? null, a.due_date ?? null, a.due_time ?? null,
    a.deadline ?? null, PRIORITY[(a.priority as string) ?? "none"], sort, now, now).run();
  if (items.length) await insertItems(env, { id, project_id: pid, section_id: null }, items, 0);
  if ((a.due_date || a.deadline) && env.onTaskCreated) await env.onTaskCreated(id).catch(() => null);
  return getTask(env, { task_id: id });
}

async function insertItems(env: AccessEnv, t: { id: string; project_id: string; section_id: string | null }, titles: string[], firstSort: number) {
  let sort = firstSort;
  const now = nowIso();
  await env.DB.batch(titles.map((title) => env.DB.prepare(
    `INSERT INTO tasks (id, project_id, section_id, parent_id, title, sort, calendar, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 'manual', ?, ?)`,
  ).bind(crypto.randomUUID(), t.project_id, t.section_id, t.id, title, sort++, now, now)));
}

async function addChecklist(env: AccessEnv, a: Json) {
  const t = await liveTask(env, a.task_id);
  if (t.parent_id) throw new ToolError("That's a checklist item, not a task. Add items to its task instead (checklist_item_of in get_task).");
  if (!Array.isArray(a.items) || !a.items.length) throw new ToolError("items must be a non-empty list of titles.");
  if (a.items.length > MAX_ITEMS_PER_CALL) throw new ToolError(`At most ${MAX_ITEMS_PER_CALL} items per call.`);
  const cleaned = a.items.map(itemTitle).filter(Boolean);
  if (!cleaned.length) throw new ToolError("All the item titles were empty.");
  const rows = (await env.DB.prepare("SELECT title, sort FROM tasks WHERE parent_id = ? AND deleted_at IS NULL")
    .bind(t.id).all<{ title: string; sort: number }>()).results ?? [];
  const { keep: titles, skipped } = withoutRepeats(cleaned, rows.map((r) => r.title));
  if (rows.length + titles.length > MAX_ITEMS_PER_TASK) throw new ToolError(`A checklist can have at most ${MAX_ITEMS_PER_TASK} items.`);
  if (titles.length) await insertItems(env, t, titles, rows.length ? Math.max(...rows.map((r) => r.sort)) + 1 : 0);
  return { task_id: t.id, title: t.title, added: titles.length, ...(skipped.length ? { skipped_already_on_checklist: skipped } : {}), checklist: await checklist(env, t.id) };
}

async function updateItem(env: AccessEnv, a: Json) {
  const s = await liveTask(env, a.item_id);
  if (!s.parent_id) throw new ToolError("That's a task, not a checklist item. This connector only changes checklist items.");
  const sets: string[] = [], vals: unknown[] = [];
  if (typeof a.done === "boolean") { sets.push("status = ?", "completed_at = ?"); vals.push(a.done ? "done" : "todo", a.done ? nowIso() : null); }
  if (a.title !== undefined) {
    const title = itemTitle(a.title);
    if (!title) throw new ToolError("title can't be empty.");
    sets.push("title = ?"); vals.push(title);
  }
  if (!sets.length) throw new ToolError("Nothing to change: give done and/or title.");
  await env.DB.prepare(`UPDATE tasks SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).bind(...vals, nowIso(), s.id).run();
  return { task_id: s.parent_id, checklist: await checklist(env, s.parent_id) };
}

const HANDLERS: Record<string, (env: ConnectorEnv, a: Json) => Promise<unknown>> = {
  find_tasks: findTasks,
  list_projects: async (env) => ({ projects: [...(await projectNames(env))].map(([id, name]) => ({ id, name })) }),
  get_task: getTask,
  add_task: addTask,
  add_checklist: addChecklist,
  update_checklist_item: updateItem,
};

interface RpcRequest { jsonrpc?: string; id?: string | number | null; method?: unknown; params?: Json }

const rpcResult = (id: RpcRequest["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id: RpcRequest["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/** One JSON-RPC message. Returns null for notifications (no id), which get no reply. */
export async function handleRpc(env: ConnectorEnv, msg: RpcRequest): Promise<Json | null> {
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return rpcError(msg?.id, -32600, "Invalid request");
  const isNote = msg.id === undefined;
  const p = (msg.params ?? {}) as Json;
  switch (msg.method) {
    case "initialize": {
      const asked = typeof p.protocolVersion === "string" ? p.protocolVersion : "";
      return rpcResult(msg.id, {
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "managemint", title: "Managemint", version: VERSION },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping": return isNote ? null : rpcResult(msg.id, {});
    case "tools/list": return rpcResult(msg.id, { tools: TOOLS });
    case "tools/call": {
      const handler = typeof p.name === "string" ? HANDLERS[p.name] : undefined;
      if (!handler) return rpcError(msg.id, -32602, `Unknown tool: ${String(p.name)}`);
      try {
        const out = await handler(env, (p.arguments ?? {}) as Json);
        return rpcResult(msg.id, { content: [{ type: "text", text: JSON.stringify(out, null, 1) }], structuredContent: out });
      } catch (e) {
        if (e instanceof ToolError) return rpcResult(msg.id, { content: [{ type: "text", text: e.message }], isError: true });
        throw e;
      }
    }
    default:
      if (isNote) return null; // notifications/initialized, notifications/cancelled, ...
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

const HEADERS = { "content-type": "application/json", "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };

/** POST /mcp after the connector token was checked. GET (server-sent events) isn't offered: every reply is plain JSON. */
export async function handleMcp(req: Request, env: ConnectorEnv): Promise<Response> {
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
  // No CORS headers on purpose: a web page can't read the replies. The token in the path is the only key.
  const body = await req.json().catch(() => undefined);
  if (body === undefined) return new Response(JSON.stringify(rpcError(null, -32700, "Parse error")), { status: 400, headers: HEADERS });
  const batch = Array.isArray(body);
  const msgs = (batch ? body : [body]) as RpcRequest[];
  if (!msgs.length || msgs.length > 20) return new Response(JSON.stringify(rpcError(null, -32600, "Invalid request")), { status: 400, headers: HEADERS });
  const replies: Json[] = [];
  for (const m of msgs) {
    try { const r = await handleRpc(env, m); if (r) replies.push(r); }
    catch { replies.push(rpcError(m?.id, -32603, "Internal error")); }
  }
  if (!replies.length) return new Response(null, { status: 202 });
  return new Response(JSON.stringify(batch ? replies : replies[0]), { headers: HEADERS });
}
