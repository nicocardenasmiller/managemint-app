<script lang="ts">
  import { tr } from "../lib/wording";
  import { store } from "../lib/store.svelte";
  import { ui } from "../lib/ui.svelte";
  import { byWhen, priorityMark, tasksInScope, visible } from "../lib/query";
  import { hueOf, hueVars, projectCode } from "../lib/colors";
  import { deadlineState, label, today } from "../lib/dates";
  import type { Status, Task } from "../lib/types";

  const COLS: Array<[Status, string]> = [["todo", tr("board.col_todo")], ["doing", tr("board.col_doing")], ["done", tr("board.col_done")]];
  let t0 = $derived(today());
  let tasks = $derived(tasksInScope(ui.scope).filter((t) => visible(t, ui.hideOldDone)));
  let cols = $derived(COLS.map(([s, name]) => ({
    status: s, name,
    tasks: tasks.filter((t) => t.status === s).sort(s === "done" ? (a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? "") : byWhen),
  })));
  $effect(() => { ui.order = cols.flatMap((c) => c.tasks.map((t) => t.id)); });

  let dragging = $state<string | null>(null);
  let over = $state<Status | null>(null);
  function drop(s: Status) {
    if (dragging && store.tasks[dragging]?.status !== s) store.setStatus(dragging, s);
    dragging = null; over = null;
  }
  const single = $derived(ui.scope.startsWith("p:"));
  const sectionName = (t: Task) => (t.section_id ? store.sections[t.section_id]?.name : "") ?? "";
</script>

<div class="board">
  {#each cols as c (c.status)}
    <section class="col" class:over={over === c.status} aria-label={c.name}
      ondragover={(e) => { e.preventDefault(); over = c.status; }} ondragleave={() => over === c.status && (over = null)} ondrop={(e) => { e.preventDefault(); drop(c.status); }}>
      <h2><span>{c.name}</span><span class="n">{c.tasks.length}</span></h2>
      <div class="cards">
        {#each c.tasks as t (t.id)}
          {@const p = store.projects[t.project_id]}
          {@const dl = t.deadline && t.status !== "done" ? deadlineState(t.deadline, t0) : null}
          <div class="card" class:sel={ui.selected === t.id && ui.panel} class:fresh={store.fresh[t.id]} class:faded={t.status === "done"} style={hueVars(hueOf(t.project_id, p?.color))}
            draggable="true" ondragstart={(e) => { dragging = t.id; e.dataTransfer?.setData("text/plain", t.id); }} ondragend={() => { dragging = null; over = null; }}
            onclick={() => ui.open(t.id)} onkeydown={(e) => e.key === "Enter" && ui.open(t.id)} role="button" tabindex="0">
            <div class="title">
              {#if t.kind === "milestone"}<span class="dia">◆</span>{/if}
              {#if priorityMark(t.priority)}<b class="prio">{priorityMark(t.priority)}</b>{/if}
              {#if t.status === "done"}✓ {/if}{t.title}
            </div>
            <div class="chips">
              {#if !single && p}<span class="code">{projectCode(p.name)}</span>{/if}
              {#if sectionName(t)}<span class="meta small">{sectionName(t)}</span>{/if}
              {#if t.due_date}<span class="chip" class:danger={t.status !== "done" && t.due_date < t0}>{label(t.due_date, t0)}{t.due_time ? ` ${t.due_time}` : ""}</span>{/if}
              {#if dl?.danger && t.deadline !== t.due_date}<span class="chip danger">⚑ {dl.text}</span>{/if}
              {#if t.status === "done" && t.completed_at}<span class="meta small">{tr("board.done_on", { date: label(t.completed_at.slice(0, 10), t0) })}</span>{/if}
            </div>
          </div>
        {/each}
      </div>
    </section>
  {/each}
</div>

<style>
  .board { display: grid; grid-template-columns: repeat(3, minmax(240px, 1fr)); gap: 16px; padding: 16px 24px; height: 100%; overflow: auto; align-items: start; }
  .col { background: var(--surface-sunken); border-radius: var(--r-lg); padding: 10px; min-height: 200px; transition: box-shadow var(--dur-effects); }
  .col.over { box-shadow: inset 0 0 0 2px var(--focus); }
  h2 { display: flex; justify-content: space-between; font: 600 13px/18px var(--font-ui); padding: 2px 6px 10px; color: var(--text-2); }
  .n { color: var(--text-3); font-weight: 400; }
  .cards { display: grid; gap: 8px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-left: 3px solid var(--h-solid); border-radius: var(--r-md); padding: 8px 10px; display: grid; gap: 6px; cursor: grab; }
  .card:hover { border-color: var(--border-strong); border-left-color: var(--h-solid); }
  .card.sel { box-shadow: 0 0 0 2px var(--focus); }
  .card.faded { opacity: .6; }
  .title { font-size: 13px; line-height: 18px; }
  .dia { color: var(--h-solid); font-size: 11px; }
  .prio { color: var(--accent); }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .chip { font-size: 11px; line-height: 16px; padding: 0 6px; border-radius: 8px; border: 1px solid var(--border-strong); color: var(--text-2); }
  .chip.danger { border-color: var(--danger); color: var(--danger); }
  .danger { color: var(--danger); }
  .small { font-size: 11px; }
</style>
