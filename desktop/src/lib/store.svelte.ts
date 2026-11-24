import { tr } from "./wording";
import { api, ApiError, getToken } from "./api";
import { addDays, nowLocal, setTimeZone, today, TZ } from "./dates";
import { habitStats, parsePauses, type HabitStats } from "./habits";
import { ui } from "./ui.svelte";
import type { Daily, DailyCheck, DailyPatch, Dep, DraftTask, Project, Section, Task, TaskPatch } from "./types";
import type { Template, TemplateBody } from "./templates";

type SyncState = "ok" | "syncing" | "offline" | "error";
interface Toast { id: number; text: string; action?: { label: string; run: () => void } }
interface SyncResponse { now: string; projects: Project[]; sections: Section[]; tasks: Task[]; deps?: Dep[]; dailies?: Daily[]; daily_checks?: DailyCheck[] }

const CACHE_KEY = "managemint.cache.v1";
const POLL_MS = 5000;

/** All app data plus the sync loop. One instance, `store`, shared by every view. */
class Store {
  projects = $state<Record<string, Project>>({});
  sections = $state<Record<string, Section>>({});
  tasks = $state<Record<string, Task>>({});
  deps = $state<Dep[]>([]);
  dailies = $state<Record<string, Daily>>({});
  /** Checked days, keyed "dailyId|YYYY-MM-DD". Only done days are kept. */
  dailyChecks = $state<Record<string, true>>({});
  syncState = $state<SyncState>("ok");
  lastSync = $state<number | null>(null);
  syncError = $state<string | null>(null);
  loaded = $state(false);
  unauthorized = $state(false);
  /** Bumped when a token is saved, so the app leaves the sign-in screen. */
  signIns = $state(0);
  toasts = $state<Toast[]>([]);
  /** Task ids that arrived from another device, with arrival time; views glow them briefly. */
  fresh = $state<Record<string, number>>({});
  /** While a drag is in progress, remote changes wait so nothing moves under the cursor. */
  holdRemote = false;

  private since = "1970-01-01";
  private pending = new Map<string, number>();
  /** Daily checks: server time of the newest state we know per "dailyId|date", so a slow sync can't undo a newer save. */
  private checkStamps = new Map<string, string>();
  /** Daily checks being saved: the state the user wants now. Clicks during a save update this; the save loop sends it next. */
  private checkWant = new Map<string, boolean>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private held: SyncResponse[] = [];
  private undoStack: Array<() => Promise<void>> = [];
  private toastSeq = 0;

  constructor() {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
      if (c) {
        this.projects = c.projects; this.sections = c.sections; this.tasks = c.tasks; this.deps = c.deps ?? [];
        this.dailies = c.dailies ?? {}; this.dailyChecks = c.dailyChecks ?? {};
        this.since = c.since; this.loaded = true;
      }
    } catch { /* no cache */ }
  }

  // ---------- sync ----------
  start() {
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") this.syncNow(); });
    window.addEventListener("online", () => this.syncNow());
    // The server's time zone decides what "today" is. Older servers don't send it; the default stays.
    void api<{ tz?: string }>("GET", "/version").then((v) => setTimeZone(v.tz)).catch(() => undefined);
    this.syncNow();
  }

  syncNow() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    void this.sync().finally(() => this.schedule());
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    if (document.visibilityState !== "visible" || this.unauthorized) return; // paused while hidden
    const delay = this.failures ? Math.min(60000, POLL_MS * 2 ** this.failures) : POLL_MS;
    this.timer = setTimeout(() => this.syncNow(), delay);
  }

  private syncing = false;
  async sync(quiet = false) {
    if (this.syncing || !getToken()) return;
    this.syncing = true;
    const slow = setTimeout(() => { if (this.syncState === "ok") this.syncState = "syncing"; }, 500);
    try {
      const r = await api<SyncResponse>("GET", `/sync?since=${encodeURIComponent(this.since)}`);
      if (this.holdRemote) this.held.push(r);
      else this.apply(r, quiet);
      this.since = r.now;
      this.failures = 0;
      this.syncState = "ok"; this.syncError = null; this.lastSync = Date.now();
      this.unauthorized = false;
    } catch (e) {
      this.failures++;
      if (e instanceof ApiError && e.status === 401) { this.unauthorized = true; this.syncState = "error"; this.syncError = tr("store.token_rejected"); }
      else if (e instanceof ApiError) { this.syncState = "error"; this.syncError = e.message; }
      else { this.syncState = "offline"; this.syncError = "Offline"; }
    } finally {
      clearTimeout(slow);
      this.syncing = false;
    }
  }

  /** Called when a drag ends: apply whatever arrived meanwhile. */
  releaseRemote() {
    this.holdRemote = false;
    for (const r of this.held.splice(0)) this.apply(r);
  }

  private apply(r: SyncResponse, quiet = false) {
    const first = !this.loaded || quiet;
    let arrived = 0;
    for (const p of r.projects) {
      if (p.deleted_at) {
        delete this.projects[p.id];
        if (ui.scope === `p:${p.id}`) ui.go("inbox"); // deleted on another device while open here
        if (ui.focus === p.id) ui.focus = null;
      } else this.projects[p.id] = p;
    }
    for (const s of r.sections) {
      if (s.deleted_at) delete this.sections[s.id]; else this.sections[s.id] = s;
    }
    for (const t of r.tasks) {
      if (this.pending.has(t.id)) continue; // our own write is in flight; its response wins
      if (t.deleted_at) { delete this.tasks[t.id]; continue; }
      const known = this.tasks[t.id];
      if (known && known.updated_at > t.updated_at) continue; // older copy (sync overlap)
      if (!known && !first) { this.fresh[t.id] = Date.now(); arrived++; }
      this.tasks[t.id] = t;
    }
    if (r.deps) this.deps = r.deps;
    for (const d of r.dailies ?? []) {
      if (this.pending.has(d.id)) continue;
      const known = this.dailies[d.id];
      if (known && known.updated_at > d.updated_at) continue; // older copy (a sync that started before our save)
      if (d.deleted_at) delete this.dailies[d.id]; else this.dailies[d.id] = d;
    }
    for (const c of r.daily_checks ?? []) {
      const k = `${c.daily_id}|${c.date}`;
      if (this.pending.has(k)) continue;
      const seen = this.checkStamps.get(k);
      if (seen && seen > c.updated_at) continue; // older copy: would undo a check we just saved
      this.checkStamps.set(k, c.updated_at);
      if (c.done) this.dailyChecks[k] = true; else delete this.dailyChecks[k];
    }
    this.loaded = true;
    if (arrived) this.toast(arrived === 1 ? tr("store.arrived_one") : tr("store.arrived_other", { n: arrived }));
    this.saveCache();
  }

  private cacheTimer: ReturnType<typeof setTimeout> | null = null;
  private saveCache() {
    if (this.cacheTimer) return;
    this.cacheTimer = setTimeout(() => {
      this.cacheTimer = null;
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({
          since: this.since, projects: $state.snapshot(this.projects), sections: $state.snapshot(this.sections),
          tasks: $state.snapshot(this.tasks), deps: $state.snapshot(this.deps),
          dailies: $state.snapshot(this.dailies), dailyChecks: $state.snapshot(this.dailyChecks),
        }));
      } catch { /* storage full or blocked: cache is only a speed-up */ }
    }, 1000);
  }

  clearCache() {
    try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
    this.projects = {}; this.sections = {}; this.tasks = {}; this.deps = []; this.dailies = {}; this.dailyChecks = {}; this.checkStamps.clear(); this.since = "1970-01-01"; this.loaded = false;
  }

  // ---------- toasts ----------
  toast(text: string, action?: Toast["action"], ms = 6000) {
    const id = ++this.toastSeq;
    this.toasts.push({ id, text, action });
    setTimeout(() => this.dismiss(id), ms);
  }
  dismiss(id: number) { this.toasts = this.toasts.filter((t) => t.id !== id); }

  // ---------- writes (optimistic, rolled back on failure) ----------
  private async guard<T>(ids: string[], work: () => Promise<T>, rollback: () => void, retry: () => void): Promise<T | undefined> {
    for (const id of ids) this.pending.set(id, (this.pending.get(id) ?? 0) + 1);
    try {
      return await work();
    } catch (e) {
      rollback();
      this.toast(e instanceof ApiError ? tr("store.save_failed", { error: e.message }) : tr("store.save_failed_offline"), { label: tr("store.retry"), run: retry }, 10000);
      return undefined;
    } finally {
      for (const id of ids) {
        const n = (this.pending.get(id) ?? 1) - 1;
        if (n <= 0) this.pending.delete(id); else this.pending.set(id, n);
      }
      this.saveCache();
    }
  }

  async patchTask(id: string, patch: TaskPatch, opts: { undoable?: boolean } = { undoable: true }) {
    const before = this.tasks[id];
    if (!before) return;
    const old = $state.snapshot(before) as Task;
    const inverse = Object.fromEntries(Object.keys(patch).map((k) => [k, old[k as keyof Task]])) as TaskPatch;
    this.tasks[id] = { ...before, ...patch };
    if (opts.undoable !== false) this.pushUndo(() => this.patchTask(id, inverse, { undoable: false }));
    await this.guard([id],
      async () => {
        const r = await api<{ task: Task; calendar_error: string | null }>("PATCH", `/tasks/${id}`, patch);
        if (r.task) this.tasks[id] = r.task;
        if (r.calendar_error) this.toast(tr("store.calendar_not_updated"));
      },
      () => { this.tasks[id] = old; },
      () => this.patchTask(id, patch, opts));
  }

  setStatus(id: string, status: Task["status"]) {
    return this.patchTask(id, { status });
  }

  toggleDone(id: string) {
    const t = this.tasks[id];
    if (!t) return;
    const r = this.setStatus(id, t.status === "done" ? "todo" : "done");
    // Checking off the last task due today (or overdue) clears Today: a small celebration.
    const t0 = today();
    const dueBy = (x: Task) => { const w = x.due_date ?? x.deadline; return w !== null && w <= t0; };
    if (t.status !== "done" && !t.parent_id && dueBy(t)
      && !Object.values(this.tasks).some((x) => x.id !== id && !x.parent_id && !x.deleted_at && (x.status === "todo" || x.status === "doing") && dueBy(x))) ui.celebrate();
    return r;
  }

  async createTask(fields: TaskPatch & { title: string }): Promise<Task | undefined> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const local: Task = {
      id, project_id: "inbox", section_id: null, parent_id: null, notes: "", kind: "task", status: "todo",
      start_date: null, due_date: null, due_time: null, deadline: null, duration_min: null, priority: 4, sort: 0,
      source: "manual", capture_id: null, created_at: now, updated_at: now, completed_at: null, deleted_at: null, ...fields,
    };
    this.tasks[id] = local;
    this.pushUndo(() => this.deleteTask(id, false));
    return this.guard([id],
      async () => {
        const r = await api<{ task: Task }>("POST", "/tasks", { ...fields, id });
        this.tasks[id] = r.task;
        return r.task;
      },
      () => { delete this.tasks[id]; },
      () => void this.createTask(fields));
  }

  async deleteTask(id: string, offerUndo = true) {
    const old = this.tasks[id] && ($state.snapshot(this.tasks[id]) as Task);
    if (!old) return;
    delete this.tasks[id];
    const restore = async () => {
      this.tasks[id] = old;
      await this.guard([id], async () => {
        const r = await api<{ task: Task }>("POST", `/tasks/${id}/restore`);
        if (r.task) this.tasks[id] = r.task;
      }, () => { delete this.tasks[id]; }, () => void restore());
    };
    if (offerUndo) {
      this.pushUndo(restore);
      this.toast(tr("store.deleted_task", { title: old.title }), { label: tr("store.undo"), run: () => void restore() });
    }
    await this.guard([id], () => api("DELETE", `/tasks/${id}`), () => { this.tasks[id] = old; }, () => void this.deleteTask(id, offerUndo));
  }

  // ---------- undo (⌘Z) ----------
  private pushUndo(fn: () => Promise<void>) {
    this.undoStack.push(fn);
    if (this.undoStack.length > 30) this.undoStack.shift();
  }
  async undo() {
    const fn = this.undoStack.pop();
    if (fn) await fn(); else this.toast(tr("store.nothing_to_undo"), undefined, 2000);
  }

  // ---------- capture (quick add goes through the same AI + date rules as the phone) ----------
  capture(text: string, forced: string | null, captureId?: string) {
    return api<{ capture_id: string; tasks: DraftTask[] }>("POST", "/capture", {
      transcript: text, now: nowLocal(), tz: TZ, forced_project_id: forced ?? undefined, capture_id: captureId,
    });
  }
  async saveCapture(captureId: string, drafts: DraftTask[]) {
    const r = await api<{ tasks: Task[]; calendar_errors: string[]; projects?: Project[] }>("POST", `/capture/${captureId}/save`, { tasks: drafts });
    for (const p of r.projects ?? []) if (p) this.projects[p.id] = p;
    for (const t of r.tasks) if (t) this.tasks[t.id] = t;
    const undo = async () => {
      await api("POST", `/capture/${captureId}/undo`);
      for (const t of r.tasks) if (t) delete this.tasks[t.id];
    };
    this.pushUndo(undo);
    this.toast(r.tasks.length === 1 ? tr("store.added_one") : tr("store.added_other", { n: r.tasks.length }), { label: tr("store.undo_all"), run: () => void undo() }, 10000);
    if (r.calendar_errors?.length) this.toast(tr("store.calendar_not_updated"));
    return r.tasks;
  }

  // ---------- dailies ----------
  get dailyList(): Daily[] { return Object.values(this.dailies).sort((a, b) => a.sort - b.sort || a.created_at.localeCompare(b.created_at)); }
  isChecked(id: string, date: string) { return Boolean(this.dailyChecks[`${id}|${date}`]); }
  /** Streaks, today's state and history for one daily (rules in lib/habits.ts). */
  dailyStats(d: Daily, day = today()): HabitStats {
    const checked = new Set<string>();
    const prefix = `${d.id}|`;
    for (const k in this.dailyChecks) if (k.startsWith(prefix)) checked.add(k.slice(prefix.length));
    return habitStats({ days: d.days ?? "1111111", per_week: d.per_week ?? null, pauses: parsePauses(d.pauses), created: today(new Date(d.created_at)) }, checked, day);
  }
  async createDaily(title: string, sched: DailyPatch = {}) {
    const id = crypto.randomUUID();
    const sort = Math.max(0, ...Object.values(this.dailies).map((d) => d.sort + 1));
    const now = new Date().toISOString();
    this.dailies[id] = { id, title, sort, created_at: now, updated_at: now, deleted_at: null, days: sched.days ?? "1111111", per_week: sched.per_week ?? null, pauses: "[]" };
    await this.guard([id], async () => { this.dailies[id] = await api<Daily>("POST", "/dailies", { id, title, sort, ...sched }); },
      () => { delete this.dailies[id]; }, () => void this.createDaily(title, sched));
  }
  async updateDaily(id: string, patch: DailyPatch) {
    const old = this.dailies[id] && ($state.snapshot(this.dailies[id]) as Daily);
    if (!old) return;
    const { pauses, ...rest } = patch;
    this.dailies[id] = { ...old, ...rest, ...(pauses ? { pauses: JSON.stringify(pauses) } : {}) };
    await this.guard([id], async () => { this.dailies[id] = await api<Daily>("PATCH", `/dailies/${id}`, patch); },
      () => { this.dailies[id] = old; }, () => void this.updateDaily(id, patch));
  }
  renameDaily(id: string, title: string) { if (this.dailies[id]?.title !== title) return this.updateDaily(id, { title }); }
  /** Pause keeps the history; paused days never count against a streak. */
  setDailyPaused(id: string, paused: boolean) {
    const d = this.dailies[id]; if (!d) return;
    const list = parsePauses(d.pauses);
    const t = today();
    if (paused && !list.some(([, to]) => to === null)) list.push([t, null]);
    if (!paused) for (const p of list) if (p[1] === null) p[1] = addDays(t, -1) < p[0] ? p[0] : addDays(t, -1);
    // A pause that starts and ends before it covered a full day (paused and resumed today) is dropped.
    return this.updateDaily(id, { pauses: list.filter(([from, to]) => !(to !== null && from === t)) });
  }
  /** Swap with the neighbour above (-1) or below (+1) and renumber everything so sorts stay distinct. */
  async moveDaily(id: string, dir: -1 | 1) {
    const list = this.dailyList;
    const i = list.findIndex((d) => d.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    await Promise.all(list.map((d, n) => (d.sort !== n + 1 ? this.updateDaily(d.id, { sort: n + 1 }) : undefined)));
  }
  async deleteDaily(id: string) {
    const old = this.dailies[id] && ($state.snapshot(this.dailies[id]) as Daily);
    if (!old) return;
    delete this.dailies[id];
    await this.guard([id], () => api("DELETE", `/dailies/${id}`), () => { this.dailies[id] = old; }, () => void this.deleteDaily(id));
    const restore = async () => {
      this.dailies[id] = old;
      await this.guard([id], async () => { this.dailies[id] = await api<Daily>("POST", `/dailies/${id}/restore`); },
        () => { delete this.dailies[id]; }, () => void restore());
    };
    this.toast(tr("store.daily_deleted", { title: old.title }), { label: tr("store.undo"), run: () => void restore() });
  }
  toggleDaily(id: string, date: string) { return this.setDailyCheck(id, date, !this.dailyChecks[`${id}|${date}`]); }
  /** Checks or unchecks one day. Saves for the same day go one at a time, so quick check/uncheck clicks reach the
   *  server in order; clicks made while a save runs are folded into one follow-up save of the latest state. */
  async setDailyCheck(id: string, date: string, done: boolean) {
    const k = `${id}|${date}`;
    const set = (v: boolean) => { if (v) this.dailyChecks[k] = true; else delete this.dailyChecks[k]; };
    const saving = this.checkWant.has(k);
    this.checkWant.set(k, done);
    set(done);
    if (saving) return; // the running save picks this up
    let saved = !done; // what the server holds as far as we know
    await this.guard([k], async () => {
      try {
        while (this.checkWant.get(k) !== saved) {
          const want = this.checkWant.get(k)!;
          const r = await api<DailyCheck>("PUT", `/dailies/${id}/checks/${date}`, { done: want });
          saved = want;
          if (r?.updated_at) this.checkStamps.set(k, r.updated_at);
        }
      } finally {
        this.checkWant.delete(k);
      }
    }, () => set(saved), () => void this.setDailyCheck(id, date, !saved));
  }

  // ---------- sections ----------
  async createSection(projectId: string, name: string): Promise<Section | undefined> {
    const id = crypto.randomUUID();
    const sort = Math.max(0, ...Object.values(this.sections).filter((s) => s.project_id === projectId).map((s) => s.sort + 1));
    this.sections[id] = { id, project_id: projectId, name, sort, updated_at: new Date().toISOString(), deleted_at: null };
    return this.guard([], async () => {
      const s = await api<Section>("POST", "/sections", { id, project_id: projectId, name, sort });
      this.sections[id] = s;
      return s;
    }, () => { delete this.sections[id]; }, () => void this.createSection(projectId, name));
  }
  async renameSection(id: string, name: string) {
    const old = this.sections[id] && ($state.snapshot(this.sections[id]) as Section);
    if (!old) return;
    this.sections[id] = { ...old, name };
    await this.guard([], async () => { this.sections[id] = await api<Section>("PATCH", `/sections/${id}`, { name }); },
      () => { this.sections[id] = old; }, () => void this.renameSection(id, name));
  }
  async deleteSection(id: string) {
    const old = this.sections[id] && ($state.snapshot(this.sections[id]) as Section);
    if (!old) return;
    const moved = Object.values(this.tasks).filter((t) => t.section_id === id).map((t) => t.id);
    delete this.sections[id];
    for (const tid of moved) this.tasks[tid] = { ...this.tasks[tid], section_id: null };
    await this.guard(moved, () => api("DELETE", `/sections/${id}`), () => {
      this.sections[id] = old;
      for (const tid of moved) if (this.tasks[tid]) this.tasks[tid] = { ...this.tasks[tid], section_id: id };
    }, () => void this.deleteSection(id));
  }

  // ---------- dependencies ----------
  async addDep(taskId: string, dependsOn: string) {
    if (taskId === dependsOn || this.deps.some((d) => d.task_id === taskId && d.depends_on_id === dependsOn)) return;
    this.deps.push({ task_id: taskId, depends_on_id: dependsOn });
    await this.guard([], () => api("POST", "/deps", { task_id: taskId, depends_on_id: dependsOn }),
      () => { this.deps = this.deps.filter((d) => !(d.task_id === taskId && d.depends_on_id === dependsOn)); },
      () => void this.addDep(taskId, dependsOn));
  }
  async removeDep(taskId: string, dependsOn: string) {
    this.deps = this.deps.filter((d) => !(d.task_id === taskId && d.depends_on_id === dependsOn));
    await this.guard([], () => api("DELETE", `/deps?task_id=${encodeURIComponent(taskId)}&depends_on_id=${encodeURIComponent(dependsOn)}`),
      () => { this.deps.push({ task_id: taskId, depends_on_id: dependsOn }); }, () => void this.removeDep(taskId, dependsOn));
  }

  // ---------- templates and bulk import ----------
  templates = $state<Template[]>([]);
  async loadTemplates() {
    try { this.templates = await api<Template[]>("GET", "/templates"); } catch { /* shown as empty */ }
  }
  async saveTemplate(name: string, body: TemplateBody) {
    const t = await api<Template>("POST", "/templates", { name, body });
    this.templates = [...this.templates.filter((x) => x.id !== t.id), t].sort((a, b) => a.name.localeCompare(b.name));
    this.toast(tr("store.saved_template", { name }));
  }
  async deleteTemplate(id: string) {
    await api("DELETE", `/templates/${id}`);
    this.templates = this.templates.filter((t) => t.id !== id);
  }
  /** Create a project with its sections and tasks in one request, then put dated tasks on the calendar in small batches. */
  async importProject(body: unknown): Promise<Project> {
    const r = await api<{ project: Project; calendar_pending: string[] }>("POST", "/projects/import", body);
    this.projects[r.project.id] = r.project;
    await this.sync(true);
    void (async () => {
      let failed = 0;
      for (let i = 0; i < r.calendar_pending.length; i += 10) {
        try { failed += (await api<{ errors: string[] }>("POST", "/calendar/sync", { ids: r.calendar_pending.slice(i, i + 10) })).errors.length; }
        catch { failed += Math.min(10, r.calendar_pending.length - i); }
      }
      if (failed) this.toast(tr(failed === 1 ? "store.calendar_failed_one" : "store.calendar_failed_other", { n: failed }), undefined, 10000);
    })();
    return r.project;
  }
  async resyncCalendar() {
    this.toast(tr("store.calendar_updating"), undefined, 3000);
    try {
      const r = await api<{ checked: number; errors: string[] }>("POST", "/calendar/resync");
      this.toast(r.errors.length ? tr("store.calendar_some_failed", { n: r.errors.length, total: r.checked }) : tr("store.calendar_up_to_date", { n: r.checked }));
    } catch (e: any) { this.toast(tr("store.calendar_sync_failed", { error: e?.message ?? tr("store.offline") })); }
  }

  // ---------- projects ----------
  async createProject(name: string, color: string): Promise<Project | undefined> {
    const sort = Math.max(0, ...Object.values(this.projects).map((p) => p.sort + 1));
    return this.guard([], async () => {
      const p = await api<Project>("POST", "/projects", { name, color, sort });
      this.projects[p.id] = p;
      return p;
    }, () => {}, () => void this.createProject(name, color));
  }
  /**
   * Delete a project. Its tasks move to Inbox (`inbox`, they lose their section) or are deleted with it (`delete`).
   * Undo (toast or ⌘Z) brings back the project, its sections and its tasks.
   */
  async deleteProject(id: string, mode: "inbox" | "delete") {
    if (id === "inbox") return;
    const old = this.projects[id] && ($state.snapshot(this.projects[id]) as Project);
    if (!old) return;
    const oldSections = Object.values(this.sections).filter((s) => s.project_id === id).map((s) => $state.snapshot(s) as Section);
    const oldTasks = Object.values(this.tasks).filter((t) => t.project_id === id).map((t) => $state.snapshot(t) as Task);
    const taskIds = oldTasks.map((t) => t.id);
    const putBack = () => {
      this.projects[id] = old;
      for (const s of oldSections) this.sections[s.id] = s;
      for (const t of oldTasks) this.tasks[t.id] = t;
    };
    delete this.projects[id];
    for (const s of oldSections) delete this.sections[s.id];
    for (const t of oldTasks) {
      if (mode === "delete") delete this.tasks[t.id];
      else this.tasks[t.id] = { ...t, project_id: "inbox", section_id: null };
    }
    if (ui.scope === `p:${id}`) ui.go("inbox");
    if (ui.focus === id) ui.focus = null;
    const r = await this.guard(taskIds,
      () => api<{ moved: Array<{ id: string; section_id: string | null }> }>("DELETE", `/projects/${id}?tasks=${mode}`),
      putBack, () => void this.deleteProject(id, mode));
    if (!r) return;
    const restore = async () => {
      putBack();
      await this.guard(taskIds, async () => {
        await api("POST", `/projects/${id}/restore`, { moved: r.moved });
        await this.sync(true);
      }, () => {}, () => void restore());
    };
    this.pushUndo(restore);
    const n = taskIds.length;
    const what = !n ? "store.deleted_project" : mode === "delete" ? (n === 1 ? "store.deleted_project_and_one" : "store.deleted_project_and_other") : n === 1 ? "store.deleted_project_moved_one" : "store.deleted_project_moved_other";
    this.toast(tr(what, { name: old.name, n }), { label: tr("store.undo"), run: () => void restore() }, 12000);
  }

  async patchProject(id: string, patch: Partial<Pick<Project, "name" | "color" | "status" | "sort" | "description">>) {
    const old = this.projects[id] && ($state.snapshot(this.projects[id]) as Project);
    if (!old) return;
    this.projects[id] = { ...old, ...patch };
    await this.guard([], async () => { this.projects[id] = await api<Project>("PATCH", `/projects/${id}`, patch); },
      () => { this.projects[id] = old; }, () => void this.patchProject(id, patch));
  }
}

export const store = new Store();
