<script lang="ts">
  import MathText from "./MathText.svelte";
  import { tr } from "../lib/wording";
  import { store } from "../lib/store.svelte";
  import { ui } from "../lib/ui.svelte";
  import { hueOf, hueVars } from "../lib/colors";
  import { deadlineState, isDate, label, today } from "../lib/dates";
  import { projectList, sectionsOf, subtasksOf } from "../lib/query";
  import CheckRing from "./CheckRing.svelte";
  import { hasMath } from "../lib/math";
  import type { Status, Task, TaskPatch } from "../lib/types";

  let task = $derived(ui.selected ? store.tasks[ui.selected] : undefined);
  let project = $derived(task ? store.projects[task.project_id] : undefined);
  let hue = $derived(hueOf(task?.project_id, project?.color));

  let notesTimer: ReturnType<typeof setTimeout> | undefined;
  // Local copies of text fields so typing isn't overwritten by a sync; saved on blur / pause.
  let title = $state("");
  let notes = $state("");
  let shownId = $state<string | null>(null);
  // Text with math shows rendered until clicked; then the raw text is edited, and it renders again on blur.
  let editTitle = $state(false);
  let editNotes = $state(false);
  const focusIf = (el: HTMLElement, on: boolean) => { if (on) el.focus(); };
  $effect(() => {
    if (task && task.id !== shownId) {
      // Switching tasks: save unsaved notes of the previous one first.
      const prev = shownId ? store.tasks[shownId] : undefined;
      clearTimeout(notesTimer);
      if (prev && notes !== prev.notes) store.patchTask(prev.id, { notes });
      shownId = task.id; title = task.title; notes = task.notes; editTitle = editNotes = false;
    }
  });

  const patch = (p: TaskPatch) => task && store.patchTask(task.id, p);
  function saveTitle() { const v = title.trim(); if (task && v && v !== task.title) patch({ title: v }); else if (task) title = task.title; }
  function notesInput() { clearTimeout(notesTimer); notesTimer = setTimeout(saveNotes, 800); }
  function saveNotes() { clearTimeout(notesTimer); if (task && notes !== task.notes) patch({ notes }); }
  function dateField(k: "start_date" | "due_date" | "deadline", v: string) {
    if (!task) return;
    const val = isDate(v) ? v : null;
    if (val === task[k]) return;
    const p: TaskPatch = { [k]: val };
    if (k === "due_date" && !val) p.due_time = null;
    patch(p);
  }

  const STATUSES: Array<[Status, string]> = [["todo", tr("detail.status_todo")], ["doing", tr("detail.status_doing")], ["done", tr("detail.status_done")], ["cancelled", tr("detail.status_cancelled")]];
  const PRIORITIES: Array<[number, string, string]> = [[4, tr("detail.priority_none"), tr("detail.priority_none_full")], [2, "!", tr("detail.priority_normal_full")], [1, "!!", tr("detail.priority_high_full")]];

  // Dependencies
  let depQuery = $state("");
  let blockedBy = $derived(task ? store.deps.filter((d) => d.task_id === task.id).map((d) => store.tasks[d.depends_on_id]).filter(Boolean) : []);
  let blocks = $derived(task ? store.deps.filter((d) => d.depends_on_id === task.id).map((d) => store.tasks[d.task_id]).filter(Boolean) : []);
  let depMatches = $derived.by(() => {
    const q = depQuery.trim().toLowerCase();
    if (!q || !task) return [];
    return Object.values(store.tasks)
      .filter((t) => t.id !== task.id && t.title.toLowerCase().includes(q) && !blockedBy.some((b) => b.id === t.id))
      .sort((a, b) => Number(b.project_id === task.project_id) - Number(a.project_id === task.project_id))
      .slice(0, 6);
  });

  // Subtasks
  let subs = $derived(task ? subtasksOf(task.id) : []);
  let newSub = $state("");
  function addSub(e: Event) {
    e.preventDefault();
    if (!task || !newSub.trim()) return;
    store.createTask({ title: newSub.trim(), project_id: task.project_id, section_id: task.section_id, parent_id: task.id, sort: subs.length });
    newSub = "";
  }

  let t0 = $derived(today());
  let created = $derived(task ? new Date(task.created_at).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
  const stop = (e: KeyboardEvent) => { e.stopPropagation(); if (e.key === "Escape") (e.target as HTMLElement).blur(); };
</script>

{#if ui.panel && task}
  <aside class="detail-panel" aria-label={tr("detail.label")} style={hueVars(hue)}>
    <div class="top">
      <CheckRing status={task.status} title={task.title} onToggle={() => store.toggleDone(task.id)} />
      {#if hasMath(title) && !editTitle}
        <div class="title shown" role="textbox" tabindex="0" aria-label={tr("detail.title_label")} title={tr("detail.math_edit")}
          onclick={() => (editTitle = true)} onkeydown={() => (editTitle = true)} onfocus={() => (editTitle = true)}><MathText text={title} /></div>
      {:else}
      <textarea class="title" rows="1" bind:value={title} use:focusIf={editTitle} onblur={() => { saveTitle(); editTitle = false; }} aria-label={tr("detail.title_label")}
        onkeydown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLElement).blur(); } else stop(e); }}></textarea>
      {/if}
      <button class="btn ghost x" aria-label={tr("detail.close")} title={tr("detail.close")} onclick={() => ui.close()}>×</button>
    </div>
    {#if task.parent_id && store.tasks[task.parent_id]}
      <button class="parent meta" onclick={() => ui.open(task.parent_id!)}>{tr("detail.subtask_of", { title: store.tasks[task.parent_id].title })}</button>
    {/if}

    <div class="grid">
      <label class="label" for="dp-project">{tr("detail.project")}</label>
      <select id="dp-project" class="input" value={task.project_id} onchange={(e) => patch({ project_id: e.currentTarget.value, section_id: null })}>
        {#each projectList() as p}<option value={p.id}>{p.name}</option>{/each}
      </select>

      <label class="label" for="dp-section">{tr("detail.section")}</label>
      <select id="dp-section" class="input" value={task.section_id ?? ""} onchange={async (e) => {
        const v = e.currentTarget.value;
        if (v === "__new") {
          const name = prompt(tr("detail.new_section_prompt"));
          if (name?.trim()) { const s = await store.createSection(task.project_id, name.trim()); if (s) patch({ section_id: s.id }); }
          else e.currentTarget.value = task.section_id ?? "";
        } else patch({ section_id: v || null });
      }}>
        <option value="">{tr("detail.section_none")}</option>
        {#each sectionsOf(task.project_id) as s}<option value={s.id}>{s.name}</option>{/each}
        <option value="__new">{tr("detail.new_section")}</option>
      </select>

      <span class="label">{tr("detail.kind")}</span>
      <div class="seg">
        <button class:on={task.kind === "task"} onclick={() => patch({ kind: "task" })}>{tr("detail.kind_task")}</button>
        <button class:on={task.kind === "milestone"} onclick={() => patch({ kind: "milestone" })}>{tr("detail.kind_milestone")}</button>
      </div>

      <span class="label">{tr("detail.status")}</span>
      <div class="seg">
        {#each STATUSES as [s, name]}<button class:on={task.status === s} onclick={() => patch({ status: s })}>{name}</button>{/each}
      </div>

      {#if task.kind === "task"}
        <label class="label" for="dp-start">{tr("detail.start")}</label>
        <input id="dp-start" class="input" type="date" value={task.start_date ?? ""} onchange={(e) => dateField("start_date", e.currentTarget.value)} />
      {/if}

      <label class="label" for="dp-due">{task.kind === "milestone" ? tr("detail.due_date") : tr("detail.due")}</label>
      <div class="pair">
        <input id="dp-due" class="input" type="date" value={task.due_date ?? ""} onchange={(e) => dateField("due_date", e.currentTarget.value)} />
        <input class="input time" type="time" aria-label={tr("detail.due_time")} value={task.due_time ?? ""} disabled={!task.due_date}
          onchange={(e) => patch({ due_time: e.currentTarget.value || null })} />
      </div>

      <label class="label" for="dp-deadline">{tr("detail.deadline")}</label>
      <div class="pair">
        <input id="dp-deadline" class="input" type="date" value={task.deadline ?? ""} onchange={(e) => dateField("deadline", e.currentTarget.value)} />
        {#if task.deadline && task.status !== "done"}
          {@const d = deadlineState(task.deadline, t0)}
          {#if d.text}<span class="meta" class:danger={d.danger}>{d.text}</span>{/if}
        {/if}
      </div>

      <span class="label">{tr("detail.priority")}</span>
      <div class="seg">
        {#each PRIORITIES as [p, name, full]}<button class:on={(task.priority === 3 ? 2 : task.priority) === p} title={full} onclick={() => patch({ priority: p })}>{name}</button>{/each}
      </div>

      <span class="label">{tr("detail.calendar")}</span>
      {#if project?.calendar === 0}
        <span class="meta">{tr("detail.calendar_off")}</span>
      {:else}
        <label class="meta cal"><input type="checkbox" checked={task.calendar !== 0} onchange={(e) => patch({ calendar: e.currentTarget.checked ? 1 : 0 })} /> {tr("detail.calendar_show")}</label>
      {/if}
    </div>

    <section>
      <h3 class="label">{tr("detail.blocked_by")}</h3>
      {#each blockedBy as b (b.id)}
        <div class="chip"><button class="link" onclick={() => ui.open(b.id)}><MathText text={b.title} /></button>{#if b.due_date}<span class="meta">{label(b.due_date, t0)}</span>{/if}
          <button class="rm" aria-label={tr("detail.remove_dep")} onclick={() => store.removeDep(task.id, b.id)}>×</button></div>
      {/each}
      <div class="depadd">
        <input class="input" placeholder={tr("detail.dep_placeholder")} bind:value={depQuery} onkeydown={stop} aria-label={tr("detail.dep_label")} />
        {#if depMatches.length}
          <ul class="menu">
            {#each depMatches as m (m.id)}
              <li><button onclick={() => { store.addDep(task.id, m.id); depQuery = ""; }}><MathText text={m.title} /> <span class="meta">{store.projects[m.project_id]?.name ?? ""}</span></button></li>
            {/each}
          </ul>
        {/if}
      </div>
      {#if blocks.length}
        <h3 class="label">{tr("detail.blocks")}</h3>
        {#each blocks as b (b.id)}<div class="chip"><button class="link" onclick={() => ui.open(b.id)}><MathText text={b.title} /></button></div>{/each}
      {/if}
    </section>

    {#if !task.parent_id}
      <section>
        <h3 class="label">{tr("detail.subtasks")} {#if subs.length}<span>{subs.filter((s) => s.status === "done").length}/{subs.length}</span>{/if}</h3>
        {#each subs as s (s.id)}
          <div class="sub">
            <CheckRing status={s.status} title={s.title} onToggle={() => store.toggleDone(s.id)} />
            <button class="link" class:faded={s.status === "done"} onclick={() => ui.open(s.id)}><MathText text={s.title} /></button>
          </div>
        {/each}
        <form onsubmit={addSub}><input class="input wide" placeholder={tr("detail.add_subtask")} bind:value={newSub} onkeydown={stop} /></form>
      </section>
    {/if}

    <section class="grow">
      <h3 class="label">{tr("detail.notes")}</h3>
      {#if hasMath(notes) && !editNotes}
        <div class="input notes shown" role="textbox" tabindex="0" aria-label={tr("detail.notes")} title={tr("detail.math_edit")}
          onclick={() => (editNotes = true)} onkeydown={() => (editNotes = true)} onfocus={() => (editNotes = true)}><MathText text={notes} block /></div>
      {:else}
      <textarea class="input notes" bind:value={notes} use:focusIf={editNotes} oninput={notesInput} onblur={() => { saveNotes(); editNotes = false; }} onkeydown={stop} placeholder={tr("detail.notes_placeholder")}></textarea>
      {/if}
    </section>

    <footer class="meta">
      <span>{tr("detail.created", { source: task.source === "voice" ? tr("detail.created_voice") : task.source === "template" ? tr("detail.created_template") : "", date: created })}</span>
      <button class="btn ghost del" onclick={() => { store.deleteTask(task.id); ui.close(); }}>{tr("detail.delete")}</button>
    </footer>
  </aside>
{/if}

<style>
  aside { width: 360px; flex: none; border-left: 1px solid var(--border); background: var(--surface); display: flex; flex-direction: column; gap: 14px; padding: 14px 16px; overflow-y: auto; }
  .top { display: flex; gap: 10px; align-items: flex-start; }
  .top :global(.ring) { margin-top: 4px; }
  .title { flex: 1; border: 0; background: none; resize: none; font: 600 17px/24px var(--font-ui); padding: 0; field-sizing: content; }
  .title:focus { outline: none; box-shadow: 0 1px 0 var(--focus); }
  .shown { cursor: text; white-space: pre-wrap; overflow-wrap: anywhere; }
  .notes.shown { overflow-y: auto; }
  .x { font-size: 18px; padding: 0 8px; color: var(--text-3); }
  .parent { border: 0; background: none; text-align: left; padding: 0; margin-top: -8px; }
  .grid { display: grid; grid-template-columns: 82px 1fr; gap: 8px 10px; align-items: center; }
  .pair { display: flex; gap: 6px; align-items: center; }
  .pair .input:first-child { flex: 1; }
  .time { width: 96px; }
  .cal { display: flex; align-items: center; gap: 6px; }
  .seg { display: flex; background: var(--surface-sunken); border-radius: var(--r-md); padding: 2px; }
  .seg button { flex: 1; border: 0; background: none; border-radius: 6px; padding: 3px 4px; font-size: 12px; color: var(--text-2); white-space: nowrap; }
  .seg button.on { background: var(--surface); color: var(--text); font-weight: 500; box-shadow: 0 0 0 1px var(--border); }
  section { display: grid; gap: 6px; }
  section h3 { margin-top: 2px; }
  .chip { display: flex; align-items: center; gap: 8px; padding: 2px 4px 2px 8px; border: 1px solid var(--border); border-radius: var(--r-md); font-size: 13px; }
  .link { border: 0; background: none; padding: 0; text-align: left; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
  .link:hover { text-decoration: underline; }
  .faded { color: var(--text-2); }
  .rm { border: 0; background: none; color: var(--text-3); font-size: 15px; }
  .depadd { position: relative; }
  .depadd .input, .wide { width: 100%; }
  .menu { position: absolute; left: 0; right: 0; top: 100%; z-index: 5; list-style: none; margin: 4px 0 0; padding: 4px; background: var(--surface-raised); border-radius: var(--r-md); box-shadow: var(--shadow-float); }
  .menu button { width: 100%; text-align: left; border: 0; background: none; padding: 5px 8px; border-radius: 6px; font-size: 13px; }
  .menu button:hover { background: var(--hover); }
  .sub { display: flex; gap: 8px; align-items: center; padding: 2px 0; }
  .grow { flex: 1; grid-template-rows: auto 1fr; }
  .notes { width: 100%; min-height: 120px; height: 100%; resize: vertical; font-size: 13px; line-height: 20px; }
  footer { display: flex; align-items: center; justify-content: space-between; border-top: 1px solid var(--border); padding-top: 10px; font-size: 12px; }
  .del { color: var(--danger); font-size: 12px; }
  .danger { color: var(--danger); }
</style>
