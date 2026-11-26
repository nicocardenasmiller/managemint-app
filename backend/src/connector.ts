// Assistant connector: a small MCP server (Streamable HTTP, JSON responses, no sessions) that an AI assistant such as
// Claude adds as a custom connector. It can find and read tasks and edit their checklists (subtasks), nothing else:
// no deleting, no moving, no editing top-level tasks or projects.
//
// Sign-in is OAuth (oauth.ts): the person approves each assistant app on this server, and can remove it on the setup page.
import type { AccessEnv } from "./access";
import { VERSION } from "./version";

/** Limits so a confused assistant can't flood a task. */
export const MAX_ITEMS_PER_CALL = 30;
export const MAX_ITEMS_PER_TASK = 100;
export const MAX_TITLE = 300;
const MAX_RESULTS = 30;

// ---------- MCP (JSON-RPC 2.0) ----------

const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

// Instructions and tool descriptions are read by the assistant, not shown to people, so they stay in code.
const INSTRUCTIONS =
  "Managemint is the user's task planner. Use find_tasks to locate a task (search by words in its title), then get_task to see its " +
  "notes and current checklist before changing anything. add_checklist adds items to the end of a task's checklist; prefer short, " +
  "concrete steps (one action each, a few words to one line). Don't add items that are already on the checklist. " +
  "If several tasks match, ask the user which one they mean instead of guessing.";

type Json = Record<string, unknown>;
const str = { type: "string" } as const;

export const TOOLS = [
  {
    name: "find_tasks",
    description: "Find tasks by words in their title (case-insensitive). Without a query, lists open tasks, soonest due first. " +
      "Returns each task's id, title, project, status, dates and checklist progress. Checklist items themselves are not listed.",
    inputSchema: {
      type: "object",
      properties: {
        query: { ...str, description: "Words from the task title, e.g. \"chapter 2 draft\"." },
        project: { ...str, description: "Only tasks in this project (its id or name)." },
        include_done: { type: "boolean", description: "Also return done tasks. Default false." },
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
    name: "add_checklist",
    description: `Add checklist items to the end of a task's checklist (at most ${MAX_ITEMS_PER_CALL} per call). Works on top-level tasks only. ` +
      "Returns the task's full checklist afterwards.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { ...str, description: "The task id from find_tasks." },
        items: { type: "array", items: str, minItems: 1, maxItems: MAX_ITEMS_PER_CALL, description: "Item titles, in order." },
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
        title: { ...str, description: "New title." },
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

async function findTasks(env: AccessEnv, a: Json) {
  const names = await projectNames(env);
  const where = ["t.deleted_at IS NULL", "t.parent_id IS NULL", "t.status != 'cancelled'"];
  const binds: unknown[] = [];
  if (!a.include_done) where.push("t.status != 'done'");
  if (typeof a.project === "string" && a.project.trim()) {
    const want = a.project.trim().toLowerCase();
    const id = [...names].find(([pid, name]) => pid.toLowerCase() === want || name.toLowerCase() === want)?.[0];
    if (!id) throw new ToolError(`No project called "${a.project}". Use list_projects to see them.`);
    where.push("t.project_id = ?"); binds.push(id);
  }
  const words = typeof a.query === "string" ? a.query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8) : [];
  for (const w of words) { where.push("LOWER(t.title) LIKE ? ESCAPE '\\'"); binds.push(`%${likeEscape(w)}%`); }
  const r = await env.DB.prepare(
    `SELECT t.id, t.title, t.project_id, t.status, t.start_date, t.due_date, t.deadline,
            (SELECT COUNT(*) FROM tasks s WHERE s.parent_id = t.id AND s.deleted_at IS NULL AND s.status != 'cancelled') AS items,
            (SELECT COUNT(*) FROM tasks s WHERE s.parent_id = t.id AND s.deleted_at IS NULL AND s.status = 'done') AS items_done
     FROM tasks t WHERE ${where.join(" AND ")}
     ORDER BY t.status = 'done', COALESCE(t.due_date, t.deadline, '9999'), t.sort LIMIT ${MAX_RESULTS + 1}`,
  ).bind(...binds).all<Json & { project_id: string; items: number; items_done: number }>();
  const tasks = r.results.slice(0, MAX_RESULTS).map(({ project_id, items, items_done, ...t }) =>
    ({ ...t, project: names.get(project_id) ?? project_id, checklist: items ? `${items_done}/${items} done` : "none" }));
  return { tasks, more: r.results.length > MAX_RESULTS };
}

async function getTask(env: AccessEnv, a: Json) {
  const t = await liveTask(env, a.task_id);
  const names = await projectNames(env);
  const parent = t.parent_id ? await env.DB.prepare("SELECT id, title FROM tasks WHERE id = ?").bind(t.parent_id).first() : null;
  return {
    id: t.id, title: t.title, project: names.get(t.project_id) ?? t.project_id, status: t.status, kind: t.kind,
    start_date: t.start_date, due_date: t.due_date, due_time: t.due_time, deadline: t.deadline, notes: t.notes,
    ...(parent ? { checklist_item_of: parent } : { checklist: await checklist(env, t.id) }),
  };
}

async function addChecklist(env: AccessEnv, a: Json) {
  const t = await liveTask(env, a.task_id);
  if (t.parent_id) throw new ToolError("That's a checklist item, not a task. Add items to its task instead (checklist_item_of in get_task).");
  if (!Array.isArray(a.items) || !a.items.length) throw new ToolError("items must be a non-empty list of titles.");
  if (a.items.length > MAX_ITEMS_PER_CALL) throw new ToolError(`At most ${MAX_ITEMS_PER_CALL} items per call.`);
  const titles = a.items.map(cleanTitle).filter(Boolean);
  if (!titles.length) throw new ToolError("All the item titles were empty.");
  const existing = await env.DB.prepare("SELECT COUNT(*) AS n, MAX(sort) AS m FROM tasks WHERE parent_id = ? AND deleted_at IS NULL")
    .bind(t.id).first<{ n: number; m: number | null }>();
  if ((existing?.n ?? 0) + titles.length > MAX_ITEMS_PER_TASK) throw new ToolError(`A checklist can have at most ${MAX_ITEMS_PER_TASK} items.`);
  let sort = existing?.n ? (existing.m ?? 0) + 1 : 0;
  const now = nowIso();
  await env.DB.batch(titles.map((title) => env.DB.prepare(
    `INSERT INTO tasks (id, project_id, section_id, parent_id, title, sort, calendar, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 'manual', ?, ?)`,
  ).bind(crypto.randomUUID(), t.project_id, t.section_id, t.id, title, sort++, now, now)));
  return { task_id: t.id, title: t.title, added: titles.length, checklist: await checklist(env, t.id) };
}

async function updateItem(env: AccessEnv, a: Json) {
  const s = await liveTask(env, a.item_id);
  if (!s.parent_id) throw new ToolError("That's a task, not a checklist item. This connector only changes checklist items.");
  const sets: string[] = [], vals: unknown[] = [];
  if (typeof a.done === "boolean") { sets.push("status = ?", "completed_at = ?"); vals.push(a.done ? "done" : "todo", a.done ? nowIso() : null); }
  if (a.title !== undefined) {
    const title = cleanTitle(a.title);
    if (!title) throw new ToolError("title can't be empty.");
    sets.push("title = ?"); vals.push(title);
  }
  if (!sets.length) throw new ToolError("Nothing to change: give done and/or title.");
  await env.DB.prepare(`UPDATE tasks SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).bind(...vals, nowIso(), s.id).run();
  return { task_id: s.parent_id, checklist: await checklist(env, s.parent_id) };
}

const HANDLERS: Record<string, (env: AccessEnv, a: Json) => Promise<unknown>> = {
  find_tasks: findTasks,
  list_projects: async (env) => ({ projects: [...(await projectNames(env))].map(([id, name]) => ({ id, name })) }),
  get_task: getTask,
  add_checklist: addChecklist,
  update_checklist_item: updateItem,
};

interface RpcRequest { jsonrpc?: string; id?: string | number | null; method?: unknown; params?: Json }

const rpcResult = (id: RpcRequest["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id: RpcRequest["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/** One JSON-RPC message. Returns null for notifications (no id), which get no reply. */
export async function handleRpc(env: AccessEnv, msg: RpcRequest): Promise<Json | null> {
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
export async function handleMcp(req: Request, env: AccessEnv): Promise<Response> {
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
