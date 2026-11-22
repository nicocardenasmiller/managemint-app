<script lang="ts">
  import { tr } from "../lib/wording";
  import { store } from "../lib/store.svelte";
  import { ui } from "../lib/ui.svelte";
  import { addDays, today } from "../lib/dates";
  import { byWhen, isOpen, projectList, sectionsOf, tasksInScope, visible, whenOf } from "../lib/query";
  import { hueOf, hueVars } from "../lib/colors";
  import TaskRow from "../components/TaskRow.svelte";
  import type { Task } from "../lib/types";

  interface Group { key: string; title: string; hue?: string; projectId?: string; sectionId?: string | null; tasks: Task[]; sub?: boolean; danger?: boolean }

  let byDate = $derived(ui.scope === "today" || ui.scope === "upcoming" || ui.listGroup === "date");
  let single = $derived(ui.scope.startsWith("p:") || ui.scope === "inbox");

  let groups = $derived.by((): Group[] => {
    const tasks = tasksInScope(ui.scope).filter((t) => visible(t, ui.hideOldDone));
    if (byDate) {
      const t0 = today(), tom = addDays(t0, 1), wk = addDays(t0, 7);
      const open = tasks.filter(isOpen).sort(byWhen);
      const b: Group[] = [
        { key: "overdue", title: tr("list.overdue"), tasks: [], danger: true },
        { key: "today", title: tr("list.today"), tasks: [] },
        { key: "tomorrow", title: tr("list.tomorrow"), tasks: [] },
        { key: "week", title: tr("list.week"), tasks: [] },
        { key: "later", title: tr("list.later"), tasks: [] },
        { key: "none", title: tr("list.no_date"), tasks: [] },
      ];
      for (const t of open) {
        const w = whenOf(t);
        const g = !w ? 5 : w < t0 ? 0 : w === t0 ? 1 : w === tom ? 2 : w <= wk ? 3 : 4;
        b[g].tasks.push(t);
      }
      return b.filter((g) => g.tasks.length);
    }
    const out: Group[] = [];
    const projects = single ? projectList().filter((p) => `p:${p.id}` === ui.scope || (ui.scope === "inbox" && p.id === "inbox")) : projectList();
    for (const p of projects) {
      const mine = tasks.filter((t) => t.project_id === p.id);
      if (!single && !mine.length) continue;
      const order = (a: Task, b: Task) => Number(a.status === "done") - Number(b.status === "done") || byWhen(a, b);
      const hue = hueVars(hueOf(p.id, p.color));
      if (!single) out.push({ key: p.id, title: p.name, hue, projectId: p.id, tasks: [] });
      const loose = mine.filter((t) => !t.section_id || !store.sections[t.section_id]).sort(order);
      out.push({ key: `${p.id}/-`, title: single ? "" : "", hue, projectId: p.id, sectionId: null, tasks: loose, sub: true });
      for (const s of sectionsOf(p.id)) {
        out.push({ key: s.id, title: s.name, hue, projectId: p.id, sectionId: s.id, tasks: mine.filter((t) => t.section_id === s.id).sort(order), sub: true });
      }
    }
    return out;
  });

  $effect(() => { ui.order = groups.flatMap((g) => g.tasks.map((t) => t.id)); });

  let adding = $state<string | null>(null);
  let newTitle = $state("");
  let newSection = $state<string | null>(null);
  let sectionName = $state("");

  function add(g: Group) {
    const title = newTitle.trim();
    if (title && g.projectId) {
      store.createTask({ title, project_id: g.projectId, section_id: g.sectionId ?? null });
      newTitle = "";
    } else adding = null;
  }
  function focusEl(el: HTMLInputElement) { el.focus(); }
  async function addSection(projectId: string) {
    const name = sectionName.trim();
    newSection = null; sectionName = "";
    if (name) await store.createSection(projectId, name);
  }
</script>

<div class="list">
  {#if !groups.some((g) => g.tasks.length) && !single}
    <div class="empty">
      <p class="page-title">{ui.scope === "today" ? tr("list.empty_today") : tr("list.empty")}</p>
      <p class="meta">{tr("list.empty_hint")} <span class="kbd">Q</span> {tr("list.empty_hint_after")}</p>
    </div>
  {/if}
  {#each groups as g (g.key)}
    {#if !g.sub}
      <h2 class="proj" style={g.hue}><span class="bar"></span>{g.title}</h2>
    {:else if g.sectionId}
      <h3 class="sec">
        <span>{g.title}</span><span class="n">{g.tasks.filter(isOpen).length || ""}</span>
        <span class="sp"></span>
        <button class="btn ghost tiny" onclick={() => { const n = prompt(tr("list.rename_prompt"), g.title); if (n?.trim()) store.renameSection(g.sectionId!, n.trim()); }}>{tr("list.rename")}</button>
        <button class="btn ghost tiny" onclick={() => { if (confirm(tr("list.delete_confirm", { name: g.title }))) store.deleteSection(g.sectionId!); }}>{tr("list.delete")}</button>
      </h3>
    {:else if g.title}
      <h3 class="sec" class:danger={g.danger}>{g.title} <span class="n">{g.tasks.length}</span></h3>
    {/if}
    <div style={g.hue}>
      {#each g.tasks as t (t.id)}
        <TaskRow task={t} showProject={byDate} />
      {/each}
      {#if g.projectId && g.sub && !byDate}
        {#if adding === g.key}
          <form class="addrow" onsubmit={(e) => { e.preventDefault(); add(g); }}>
            <input class="input" placeholder={tr("list.task_placeholder")} bind:value={newTitle} use:focusEl
              onkeydown={(e) => { e.stopPropagation(); if (e.key === "Escape") adding = null; }} onblur={() => !newTitle && (adding = null)} />
          </form>
        {:else}
          <button class="addbtn" onclick={() => { adding = g.key; newTitle = ""; }}>{tr("list.add_task")}</button>
        {/if}
      {/if}
    </div>
    {#if g.projectId && g.sub && !byDate && (sectionsOf(g.projectId).at(-1)?.id ?? null) === (g.sectionId ?? null)}
      {#if newSection === g.projectId}
        <form class="addrow" onsubmit={(e) => { e.preventDefault(); addSection(g.projectId!); }}>
          <input class="input" placeholder={tr("list.section_placeholder")} bind:value={sectionName} use:focusEl
            onkeydown={(e) => { e.stopPropagation(); if (e.key === "Escape") newSection = null; }} onblur={() => addSection(g.projectId!)} />
        </form>
      {:else}
        <button class="addbtn sec-add" onclick={() => (newSection = g.projectId!)}>{tr("list.add_section")}</button>
      {/if}
    {/if}
  {/each}
</div>

<style>
  .list { padding: 16px 24px 120px; max-width: 980px; overflow-y: auto; height: 100%; }
  .proj { display: flex; align-items: center; gap: 8px; font: 600 15px/22px var(--font-ui); margin: 20px 0 4px; }
  .proj:first-child { margin-top: 0; }
  .bar { width: 3px; height: 16px; border-radius: 2px; background: var(--h-solid); }
  .sec { display: flex; align-items: center; gap: 6px; font: 600 13px/18px var(--font-ui); color: var(--text-2); margin: 14px 0 2px; padding: 0 12px 4px; border-bottom: 1px solid var(--border); }
  .sec .n { color: var(--text-3); font-weight: 400; }
  .sec .sp { flex: 1; }
  .tiny { font-size: 12px; padding: 0 6px; color: var(--text-3); opacity: 0; }
  .sec:hover .tiny { opacity: 1; }
  .danger { color: var(--danger); }
  .addbtn { border: 0; background: none; color: var(--text-3); font-size: 13px; padding: 4px 12px 4px 40px; border-radius: var(--r-md); }
  .addbtn:hover { color: var(--accent); }
  .sec-add { padding-left: 12px; margin-top: 4px; }
  .addrow { padding: 2px 12px 2px 40px; }
  .addrow input { width: 100%; }
  .empty { padding: 80px 0; text-align: center; }
  .empty p { margin: 6px 0; }
</style>
