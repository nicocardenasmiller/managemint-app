<script lang="ts">
  import MathText from "./MathText.svelte";
  import { tr } from "../lib/wording";
  import { store } from "../lib/store.svelte";
  import { ui } from "../lib/ui.svelte";
  import { hueOf, hueVars, projectCode } from "../lib/colors";
  import { label, deadlineState, today, diffDays } from "../lib/dates";
  import { priorityMark, subtasksOf } from "../lib/query";
  import CheckRing from "./CheckRing.svelte";
  import type { Task } from "../lib/types";

  let { task, showProject = false, stacked = false }: { task: Task; showProject?: boolean; stacked?: boolean } = $props();
  let project = $derived(store.projects[task.project_id]);
  let hue = $derived(hueOf(task.project_id, project?.color));
  let editing = $state(false);
  let draft = $state("");
  let subs = $derived(subtasksOf(task.id));
  let t0 = $derived(today());
  let overdue = $derived(task.status !== "done" && task.due_date !== null && task.due_date < t0);
  let dl = $derived(task.deadline && task.deadline !== task.due_date ? deadlineState(task.deadline, t0) : null);
  let section = $derived(task.section_id ? store.sections[task.section_id] : null);

  function startEdit() { draft = task.title; editing = true; }
  function commit() {
    editing = false;
    const v = draft.trim();
    if (v && v !== task.title) store.patchTask(task.id, { title: v });
  }
  function focusEl(el: HTMLInputElement) { el.focus(); el.select(); }
</script>

{#if stacked}
<!-- Phone row: status circle, title, then one meta line (project, section, date or deadline). -->
<div class="row stacked" class:sel={ui.selected === task.id} class:done={task.status === "done"} class:fresh={store.fresh[task.id]}
  style={hueVars(hue)} data-task={task.id} role="button" tabindex="-1"
  onclick={() => ui.open(task.id)} onkeydown={(e) => e.key === "Enter" && ui.open(task.id)}>
  <CheckRing status={task.status} title={task.title} onToggle={() => store.toggleDone(task.id)} />
  <div class="txt">
    <span class="title">
      {#if task.kind === "milestone"}<span class="diamond" aria-label={tr("taskrow.milestone")}>◆</span>{/if}
      {#if priorityMark(task.priority)}<b class="prio" title={tr("taskrow.priority")}>{priorityMark(task.priority)}</b>{/if}
      <MathText text={task.title} />
    </span>
    <span class="line">
      {#if showProject && project}<span class="pc" title={project.name}>{projectCode(project.name)}</span>{/if}
      {#if section && showProject}<span>{section.name}</span>{/if}
      {#if dl}<span class="dl" class:danger={dl.danger && task.status !== "done"}>⚑ {label(task.deadline!, t0)}{dl.text && task.status !== "done" ? ` · ${dl.text}` : ""}</span>{/if}
      {#if task.due_date && (overdue || task.due_date !== t0 || task.due_time)}
        <span class:danger={overdue}>{[task.due_date !== t0 ? label(task.due_date, t0) : "", task.due_time ?? "", overdue ? `· ${tr("taskrow.late", { n: diffDays(t0, task.due_date) })}` : ""].filter(Boolean).join(" ")}</span>
      {/if}
    </span>
  </div>
</div>
{:else}
<div class="row" class:sel={ui.selected === task.id} class:done={task.status === "done"} class:fresh={store.fresh[task.id]}
  style={hueVars(hue)} data-task={task.id} role="button" tabindex="-1"
  onclick={() => ui.open(task.id)} ondblclick={startEdit} onkeydown={(e) => e.key === "Enter" && ui.open(task.id)}>
  <CheckRing status={task.status} title={task.title} onToggle={() => store.toggleDone(task.id)} />
  {#if task.kind === "milestone"}<span class="diamond" title={tr("taskrow.milestone")} aria-label={tr("taskrow.milestone")}>◆</span>{/if}
  {#if editing}
    <input class="input title-edit" bind:value={draft} use:focusEl onblur={commit} onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => { e.stopPropagation(); if (e.key === "Enter") commit(); if (e.key === "Escape") editing = false; }} aria-label={tr("taskrow.title_label")} />
  {:else}
    <span class="title">
      {#if priorityMark(task.priority)}<b class="prio" title={tr("taskrow.priority")}>{priorityMark(task.priority)}</b>{/if}
      <MathText text={task.title} />
    </span>
  {/if}
  {#if subs.length}<span class="meta subs" title={tr("taskrow.subtasks")}>{subs.filter((s) => s.status === "done").length}/{subs.length}</span>{/if}
  {#if task.notes}<span class="meta" title={tr("taskrow.has_notes")} aria-label={tr("taskrow.has_notes")}>¶</span>{/if}
  {#if task.status === "doing"}<span class="doing">{tr("taskrow.in_progress")}</span>{/if}
  <span class="spacer"></span>
  {#if section && showProject}<span class="meta sec">{section.name}</span>{/if}
  {#if showProject && project}<span class="code" title={project.name}>{projectCode(project.name)}</span>{/if}
  {#if dl}
    <span class="dl" class:danger={dl.danger && task.status !== "done"} title={tr("taskrow.deadline", { date: task.deadline ?? "" })}>⚑ {label(task.deadline!, t0)}{dl.text && task.status !== "done" ? ` · ${dl.text}` : ""}</span>
  {/if}
  <span class="date" class:danger={overdue}>
    {#if task.due_date}{label(task.due_date, t0)}{#if task.due_time} {task.due_time}{/if}{#if overdue} · {tr("taskrow.late", { n: diffDays(t0, task.due_date) })}{/if}{/if}
  </span>
</div>
{/if}

<style>
  .row { display: flex; align-items: center; gap: 10px; min-height: 34px; padding: 4px 12px; border-radius: var(--r-md); cursor: default; position: relative; }
  .row:hover { background: var(--hover); }
  .row.sel { background: var(--accent-tint); }
  .row.sel .meta, .row.sel .date { color: var(--text-2); }
  .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .done .title { color: var(--text-2); }
  .prio { color: var(--accent); font-weight: 700; margin-right: 2px; }
  .diamond { color: var(--h-solid); font-size: 12px; }
  .title-edit { flex: 1; }
  .spacer { flex: 1; }
  .subs, .sec { white-space: nowrap; }
  .sec { color: var(--text-3); font-size: 12px; }
  .doing { font-size: 11px; color: var(--accent); border: 1px solid var(--accent); border-radius: 10px; padding: 0 6px; white-space: nowrap; }
  .dl { font-size: 12px; color: var(--text-2); white-space: nowrap; }
  .date { font-size: 13px; color: var(--text-2); min-width: 64px; text-align: right; white-space: nowrap; }
  .danger { color: var(--danger) !important; }
  .stacked { align-items: flex-start; gap: 12px; padding: 12px 16px; min-height: 60px; border-radius: 0; }
  .stacked :global(.ring) { margin-top: 2px; }
  .stacked .txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .stacked .title { font-size: 16px; line-height: 22px; font-weight: 500; white-space: normal; }
  .stacked .line { display: flex; flex-wrap: wrap; align-items: center; font-size: 13px; line-height: 18px; color: var(--text-3); }
  .stacked .line:empty { display: none; }
  .stacked .line > span + span::before { content: "·"; margin: 0 6px; color: var(--text-3); }
  .pc { color: var(--h-solid); font-weight: 600; font-size: 12px; }
  .pc::before { content: ""; display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--h-solid); margin-right: 5px; vertical-align: 1px; }
</style>
