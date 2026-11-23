<script lang="ts">
  import { tr } from "../lib/wording";
  import { store } from "../lib/store.svelte";
  import { ui } from "../lib/ui.svelte";
  import { projectList } from "../lib/query";
  import { hueOf, hueVars } from "../lib/colors";
  import { isDate } from "../lib/dates";
  import type { DraftTask } from "../lib/types";

  let text = $state("");
  let busy = $state(false);
  let error = $state("");
  let drafts = $state<DraftTask[]>([]);
  let captureId = $state<string | null>(null);
  let input: HTMLTextAreaElement | undefined = $state();

  let scopeProject = $derived(ui.scope.startsWith("p:") ? ui.scope.slice(2) : ui.scope === "inbox" ? "inbox" : null);
  let forced = $state<string | null>(null);
  $effect(() => { if (ui.quickAdd) forced = scopeProject; });
  const focusEl = (el: HTMLElement) => el.focus();

  function close() { ui.quickAdd = false; text = ""; drafts = []; captureId = null; error = ""; }

  /** Enter: let the AI split and date it (same rules as the phone). */
  async function parse() {
    if (!text.trim() || busy) return;
    busy = true; error = "";
    try {
      const r = await store.capture(text.trim(), forced, captureId ?? undefined);
      captureId = r.capture_id; drafts = r.tasks;
      if (!drafts.length) error = tr("quickadd.no_tasks");
    } catch (e: any) {
      error = e?.status ? tr("quickadd.parse_failed", { error: e.message }) : tr("quickadd.offline");
    } finally { busy = false; }
  }

  /** Shift+Enter: add exactly as typed, no AI. */
  function plain() {
    if (!text.trim()) return;
    store.createTask({ title: text.trim(), project_id: forced ?? "inbox" });
    close();
  }

  async function saveAll() {
    if (!captureId || !drafts.length || busy) return;
    busy = true;
    try {
      await store.saveCapture(captureId, $state.snapshot(drafts) as DraftTask[]);
      close();
    } catch (e: any) { error = tr("quickadd.save_failed", { error: e?.message ?? tr("quickadd.offline_short") }); }
    finally { busy = false; }
  }

  function key(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && drafts.length) { e.preventDefault(); saveAll(); }
    else if (e.key === "Enter" && e.shiftKey && (e.target as HTMLElement).tagName === "TEXTAREA") { e.preventDefault(); plain(); }
    else if (e.key === "Enter" && (e.target as HTMLElement).tagName === "TEXTAREA") { e.preventDefault(); parse(); }
  }
  const setDate = (d: DraftTask, k: "due_date" | "deadline" | "start_date", v: string) => { d[k] = isDate(v) ? v : null; if (k === "due_date" && !d.due_date) d.due_time = null; };
</script>

{#if ui.quickAdd}
  <div class="scrim" role="presentation" onclick={close}></div>
  <div class="dialog" role="dialog" aria-modal="true" aria-label={tr("quickadd.label")} tabindex="-1" onkeydown={key}>
    <textarea bind:this={input} use:focusEl bind:value={text} rows="2" placeholder={tr("quickadd.placeholder")}
      aria-label={tr("quickadd.input_label")} oninput={() => { drafts = []; }}></textarea>
    <div class="bar">
      <select class="input" bind:value={forced} aria-label={tr("quickadd.project_label")}>
        <option value={null}>{tr("quickadd.auto_project")}</option>
        {#each projectList() as p}<option value={p.id}>{p.name}</option>{/each}
      </select>
      <span class="hint meta"><span class="kbd">↵</span> {tr("quickadd.hint")} · <span class="kbd">⇧↵</span> {tr("quickadd.hint_plain")} · <span class="kbd">Esc</span></span>
      <button class="btn primary" disabled={!text.trim() || busy} onclick={parse}>{busy && !drafts.length ? tr("quickadd.reading") : tr("quickadd.preview")}</button>
    </div>
    {#if error}<p class="danger meta" role="alert">{error}</p>{/if}

    {#if drafts.length}
      <ul class="cards">
        {#each drafts as d, i}
          {@const p = store.projects[d.project_id]}
          <li class="card" style={hueVars(hueOf(d.project_id, p?.color))}>
            <div class="r1">
              <button class="kind" title={tr("quickadd.toggle_milestone")} aria-label={d.kind === "milestone" ? tr("quickadd.milestone") : tr("quickadd.task")} onclick={() => (d.kind = d.kind === "milestone" ? "task" : "milestone")}>{d.kind === "milestone" ? "◆" : "○"}</button>
              <input class="t" bind:value={d.title} aria-label={tr("quickadd.title_label")} />
              <button class="rm" aria-label={tr("quickadd.remove")} onclick={() => drafts.splice(i, 1)}>×</button>
            </div>
            <div class="r2">
              <select class="input" bind:value={d.project_id} aria-label={tr("quickadd.project_label")}>
                {#if d.new_project}<option value="new">{tr("quickadd.new_project", { name: d.new_project })}</option>{/if}
                {#each projectList() as pp}<option value={pp.id}>{pp.name}</option>{/each}
              </select>
              <label>{tr("quickadd.due")} <input class="input" type="date" value={d.due_date ?? ""} onchange={(e) => setDate(d, "due_date", e.currentTarget.value)} /></label>
              <input class="input time" type="time" aria-label={tr("quickadd.time")} value={d.due_time ?? ""} disabled={!d.due_date} onchange={(e) => (d.due_time = e.currentTarget.value || null)} />
              <label>⚑ <input class="input" type="date" aria-label={tr("quickadd.deadline")} value={d.deadline ?? ""} onchange={(e) => setDate(d, "deadline", e.currentTarget.value)} /></label>
            </div>
          </li>
        {/each}
      </ul>
      <div class="bar end">
        <span class="meta">{tr("quickadd.check_cards")} <span class="kbd">⌘↵</span></span>
        <button class="btn primary" disabled={busy} onclick={saveAll}>{drafts.length === 1 ? tr("quickadd.save_one") : tr("quickadd.save_all", { n: drafts.length })}</button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; background: rgb(0 0 0 / .18); z-index: 40; }
  .dialog { position: fixed; top: 12vh; left: 50%; transform: translateX(-50%); width: min(640px, 92vw); max-height: 76vh; overflow-y: auto; z-index: 41; background: var(--surface-raised); border-radius: var(--r-lg); box-shadow: var(--shadow-float), 0 0 0 1px var(--border); padding: 14px; display: grid; gap: 10px; animation: pop var(--dur-fast) var(--spring-fast); }
  @keyframes pop { from { transform: translate(-50%, 8px) scale(.98); opacity: 0; } }
  textarea { border: 0; background: none; resize: none; font-size: 16px; line-height: 24px; padding: 4px; outline: none; }
  .bar { display: flex; align-items: center; gap: 10px; }
  .bar .hint { flex: 1; font-size: 12px; }
  .end { justify-content: space-between; }
  .cards { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .card { border: 1px solid var(--border); border-left: 3px solid var(--h-solid); border-radius: var(--r-md); padding: 8px 10px; display: grid; gap: 6px; background: var(--surface); }
  .r1, .r2 { display: flex; align-items: center; gap: 8px; }
  .r2 { flex-wrap: wrap; font-size: 12px; color: var(--text-2); }
  .r2 label { display: flex; align-items: center; gap: 4px; }
  .t { flex: 1; border: 0; background: none; font-size: 14px; font-weight: 500; padding: 2px 0; outline: none; }
  .t:focus { box-shadow: 0 1px 0 var(--focus); }
  .kind { border: 0; background: none; color: var(--h-solid); font-size: 14px; width: 20px; }
  .rm { border: 0; background: none; color: var(--text-3); font-size: 16px; }
  .time { width: 96px; }
  .danger { color: var(--danger); margin: 0; }
  /* Phones have no keyboard shortcuts; give the row to the project picker and button. */
  @media (max-width: 700px) { .hint { display: none; } .dialog { top: max(12px, env(safe-area-inset-top)); } }
</style>
