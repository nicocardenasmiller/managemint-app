<script lang="ts">
  import { tr } from "../lib/wording";
  import { store } from "../lib/store.svelte";
  import { ui } from "../lib/ui.svelte";
  import { subtasksOf } from "../lib/query";
  import { splitPastedList } from "../lib/checklist";
  import { hasMath } from "../lib/math";
  import MathText from "./MathText.svelte";
  import type { Task } from "../lib/types";

  /** A task's checklist (its subtasks), in a card: square boxes, titles edited in place, drag to reorder,
   *  an add row at the bottom that takes a pasted list. Design notes: docs/design/checklists.md. */
  let { task }: { task: Task } = $props();

  let items = $derived(subtasksOf(task.id));
  let done = $derived(items.filter((s) => s.status === "done").length);
  let draft = $state("");

  function add(titles: string[]) {
    let sort = (items.at(-1)?.sort ?? -1) + 1;
    for (const title of titles) store.createTask({ title, project_id: task.project_id, section_id: task.section_id, parent_id: task.id, sort: sort++ });
  }
  function submit(e: Event) {
    e.preventDefault();
    const t = draft.trim();
    if (t) add([t]);
    draft = "";
  }
  function paste(e: ClipboardEvent) {
    const lines = splitPastedList(e.clipboardData?.getData("text") ?? "");
    if (lines.length < 2) return;
    e.preventDefault();
    add(lines);
  }
  function rename(s: Task, el: HTMLTextAreaElement) {
    const v = el.value.replace(/\s+/g, " ").trim();
    if (v && v !== s.title) store.patchTask(s.id, { title: v });
    else el.value = s.title;
  }
  function keys(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); (e.target as HTMLElement).blur(); }
  }

  // Items with LaTeX show as math until clicked, then the raw text (same as the panel's title).
  let editing = $state<string | null>(null);
  const focusIf = (el: HTMLElement, on: boolean) => { if (on) el.focus(); };

  // Drag to reorder: the dragged row moves before the row it's dropped on (or to the end).
  let dragging = $state<string | null>(null);
  let over = $state<string | null>(null);
  function drop(targetId: string | null) {
    const from = dragging;
    dragging = over = null;
    if (!from || from === targetId) return;
    const order = items.filter((s) => s.id !== from);
    const i = targetId ? order.findIndex((s) => s.id === targetId) : order.length;
    order.splice(i < 0 ? order.length : i, 0, items.find((s) => s.id === from)!);
    order.forEach((s, n) => { if (s.sort !== n) store.patchTask(s.id, { sort: n }, { undoable: false }); });
  }
</script>

<section class="checklist">
  <h3 class="label head"><span>{tr("detail.checklist")}</span>{#if items.length}<span class="count">{tr("detail.checklist_progress", { done, total: items.length })}</span>{/if}</h3>
  <div class="card">
    {#if items.length}<div class="bar" aria-hidden="true"><i style="width:{(done / items.length) * 100}%"></i></div>{/if}
    {#each items as s (s.id)}
      <div class="item" class:done={s.status === "done"} class:over={over === s.id && dragging !== s.id} role="listitem"
        ondragover={(e) => { if (dragging) { e.preventDefault(); over = s.id; } }} ondrop={(e) => { e.preventDefault(); drop(s.id); }}>
        <span class="handle" draggable="true" title={tr("detail.checklist_drag")} aria-hidden="true"
          ondragstart={(e) => { dragging = s.id; e.dataTransfer?.setData("text/plain", s.id); }} ondragend={() => (dragging = over = null)}>⋮⋮</span>
        <button class="box" class:on={s.status === "done"} role="checkbox" aria-checked={s.status === "done"} aria-label={s.title}
          onclick={() => store.toggleDone(s.id)}></button>
        {#if hasMath(s.title) && editing !== s.id}
          <div class="text shown" role="textbox" tabindex="0" aria-label={tr("detail.checklist_item")} title={tr("detail.math_edit")}
            onclick={() => (editing = s.id)} onkeydown={() => (editing = s.id)} onfocus={() => (editing = s.id)}><MathText text={s.title} /></div>
        {:else}
          <textarea class="text" rows="1" value={s.title} aria-label={tr("detail.checklist_item")} use:focusIf={editing === s.id}
            onblur={(e) => { rename(s, e.currentTarget); editing = null; }} onkeydown={keys}></textarea>
        {/if}
        <span class="tools">
          <button title={tr("detail.checklist_open")} aria-label={tr("detail.checklist_open")} onclick={() => ui.open(s.id)}>↗</button>
          <button title={tr("detail.checklist_remove")} aria-label={tr("detail.checklist_remove")} onclick={() => store.deleteTask(s.id)}>×</button>
        </span>
      </div>
    {/each}
    <form class="item add" class:over={over === "__end"} onsubmit={submit}
      ondragover={(e) => { if (dragging) { e.preventDefault(); over = "__end"; } }} ondrop={(e) => { e.preventDefault(); drop(null); }}>
      <span class="plus" aria-hidden="true">+</span>
      <input class="text" bind:value={draft} onpaste={paste} onkeydown={(e) => e.stopPropagation()}
        placeholder={items.length ? tr("detail.checklist_add") : tr("detail.checklist_add_first")} aria-label={tr("detail.checklist_add")} />
    </form>
  </div>
</section>

<style>
  .checklist { display: grid; gap: 6px; }
  .head { display: flex; justify-content: space-between; margin: 2px 0 0; }
  .card { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; background: var(--surface); }
  .bar { height: 3px; background: var(--surface-sunken); }
  .bar i { display: block; height: 100%; background: var(--accent); border-radius: 0 2px 2px 0; transition: width .25s ease; }
  .item { position: relative; display: flex; align-items: flex-start; gap: 9px; padding: 6px 6px 6px 12px; border-top: 1px solid var(--border); }
  .bar + .item, .card > .item:first-child { border-top: 0; }
  .item:hover { background: var(--bg); }
  .item.over { box-shadow: inset 0 2px 0 var(--accent); }
  .handle { position: absolute; left: 1px; top: 7px; font-size: 10px; letter-spacing: -2px; color: var(--text-3); cursor: grab; opacity: 0; padding: 0 2px; }
  .item:hover .handle { opacity: .7; }
  .box { flex: none; width: 15px; height: 15px; margin-top: 2px; padding: 0; border-radius: 4px; border: 1.5px solid var(--text-3); background: var(--surface); display: grid; place-items: center; cursor: pointer; transition: background .15s, border-color .15s, transform .15s; }
  .box:active { transform: scale(.88); }
  .box.on { background: var(--accent); border-color: var(--accent); }
  .box.on::after { content: ""; width: 7px; height: 3.5px; border: 1.6px solid var(--on-accent); border-top: 0; border-right: 0; transform: translateY(-1px) rotate(-45deg); }
  .text { flex: 1; min-width: 0; border: 0; background: none; padding: 0; margin: 0; resize: none; font: 400 13px/19px var(--font-ui); color: var(--text); field-sizing: content; overflow-wrap: anywhere; }
  .shown { cursor: text; white-space: pre-wrap; }
  .text:focus { outline: none; box-shadow: 0 1px 0 var(--accent); }
  .done .text { color: var(--text-3); text-decoration: line-through; text-decoration-color: var(--border-strong); }
  .tools { display: flex; gap: 2px; opacity: 0; }
  .item:hover .tools, .item:focus-within .tools { opacity: 1; }
  .tools button { border: 0; background: none; color: var(--text-3); width: 20px; padding: 0; font-size: 13px; line-height: 19px; border-radius: 4px; }
  .tools button:hover { background: var(--hover); color: var(--text); }
  .plus { flex: none; width: 15px; text-align: center; color: var(--accent); font: 500 16px/19px var(--font-ui); }
  .add .text::placeholder { color: var(--text-3); }
</style>
