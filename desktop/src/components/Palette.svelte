<script lang="ts">
  import { tr } from "../lib/wording";
  import { store } from "../lib/store.svelte";
  import { ui, ZOOMS, type Scope } from "../lib/ui.svelte";
  import { projectList } from "../lib/query";
  import { label } from "../lib/dates";

  interface Item { id: string; kind: "Task" | "Project" | "Command"; text: string; meta?: string; run: () => void }
  let q = $state("");
  let idx = $state(0);
  let input: HTMLInputElement | undefined = $state();
  $effect(() => { if (ui.palette) { q = ""; idx = 0; } });
  const focusEl = (el: HTMLElement) => el.focus();

  const commands = (): Item[] => [
    { id: "c-add", kind: "Command", text: tr("palette.new_task"), meta: "Q", run: () => (ui.quickAdd = true) },
    { id: "c-proj", kind: "Command", text: tr("palette.new_project"), run: () => (ui.newProject = true) },
    { id: "c-tpl", kind: "Command", text: tr("palette.new_from_template"), run: () => (ui.templates = "use") },
    { id: "c-onboard", kind: "Command", text: tr("palette.onboarding"), run: () => (ui.onboarding = true) },
    { id: "c-guidelines", kind: "Command", text: tr("palette.guidelines"), run: () => (ui.guidelines = true) },
    ...(ui.scope.startsWith("p:") ? [
      { id: "c-save-tpl", kind: "Command" as const, text: tr("palette.save_template"), run: () => (ui.templates = { save: ui.scope.slice(2) }) },
      { id: "c-del-proj", kind: "Command" as const, text: tr("palette.delete_project"), run: () => (ui.deleteProject = ui.scope.slice(2)) },
    ] : []),
    { id: "c-feed", kind: "Command", text: tr("palette.calendar_link"), run: () => (ui.calendarFeed = true) },
    { id: "c-cal", kind: "Command", text: tr("palette.sync_calendar"), run: () => store.resyncCalendar() },
    ...(["timeline", "board", "list"] as const).map((v, i) => ({ id: `c-${v}`, kind: "Command" as const, text: tr({ timeline: "palette.show_timeline", board: "palette.show_board", list: "palette.show_list" }[v]), meta: String(i + 1), run: () => (ui.view = v) })),
    ...([["inbox", tr("scope.inbox")], ["today", tr("scope.today")], ["upcoming", tr("scope.upcoming")], ["all", tr("scope.all")]] as Array<[Scope, string]>)
      .map(([s, n]) => ({ id: `c-go-${s}`, kind: "Command" as const, text: tr("palette.go_to", { name: n }), run: () => ui.go(s) })),
    ...ZOOMS.map((z) => ({ id: `c-z-${z}`, kind: "Command" as const, text: tr({ week: "palette.zoom_week", month: "palette.zoom_month", quarter: "palette.zoom_quarter", semester: "palette.zoom_semester" }[z]), run: () => { ui.zoom = z; ui.view = "timeline"; ui.save(); } })),
    { id: "c-old", kind: "Command", text: ui.hideOldDone ? tr("palette.show_old") : tr("palette.hide_old"), meta: "H", run: () => { ui.hideOldDone = !ui.hideOldDone; ui.save(); } },
    { id: "c-theme", kind: "Command", text: tr("palette.theme"), run: () => { ui.theme = ui.theme === "system" ? "light" : ui.theme === "light" ? "dark" : "system"; ui.save(); store.toast(tr({ system: "palette.theme_system", light: "palette.theme_light", dark: "palette.theme_dark" }[ui.theme]), undefined, 2000); } },
    { id: "c-sync", kind: "Command", text: tr("palette.sync_now"), run: () => store.syncNow() },
    { id: "c-help", kind: "Command", text: tr("palette.shortcuts"), meta: "?", run: () => (ui.help = true) },
    { id: "c-out", kind: "Command", text: tr("palette.sign_out"), run: () => { if (confirm(tr("palette.sign_out_confirm"))) { localStorage.clear(); location.reload(); } } },
  ];

  /** Subsequence match with a score: earlier, contiguous and word-start matches rank higher. */
  function score(text: string, query: string): number {
    const t = text.toLowerCase(), qq = query.toLowerCase();
    if (!qq) return 1;
    const sub = t.indexOf(qq);
    if (sub >= 0) return 100 - sub + (sub === 0 || t[sub - 1] === " " ? 50 : 0);
    let ti = 0, s = 0, run = 0;
    for (const c of qq) {
      const f = t.indexOf(c, ti);
      if (f < 0) return 0;
      run = f === ti ? run + 1 : 0;
      s += 1 + run;
      ti = f + 1;
    }
    return s;
  }

  let items = $derived.by(() => {
    const all: Item[] = [
      ...commands(),
      ...projectList().map((p) => ({ id: `p-${p.id}`, kind: "Project" as const, text: p.name, run: () => ui.go(`p:${p.id}`) })),
      ...Object.values(store.tasks).filter((t) => t.status !== "cancelled").map((t) => ({
        id: t.id, kind: "Task" as const, text: t.title,
        meta: [store.projects[t.project_id]?.name, t.due_date && label(t.due_date), t.status === "done" ? tr("palette.task_done") : ""].filter(Boolean).join(" · "),
        run: () => ui.open(t.id),
      })),
    ];
    if (!q.trim()) {
      const recent = Object.values(store.tasks).sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 6).map((t) => t.id);
      return [...all.filter((i) => recent.includes(i.id)), ...commands().slice(0, 6)];
    }
    return all.map((i) => ({ i, s: score(i.text, q.trim()) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 12).map((x) => x.i);
  });

  function pick(i: Item) { ui.palette = false; i.run(); }
  function key(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === "Escape") ui.palette = false;
    else if (e.key === "ArrowDown") { e.preventDefault(); idx = Math.min(items.length - 1, idx + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); idx = Math.max(0, idx - 1); }
    else if (e.key === "Enter" && items[idx]) { e.preventDefault(); pick(items[idx]); }
  }
</script>

{#if ui.palette}
  <div class="scrim" role="presentation" onclick={() => (ui.palette = false)}></div>
  <div class="dialog" role="dialog" aria-modal="true" aria-label={tr("palette.label")}>
    <input bind:this={input} use:focusEl bind:value={q} oninput={() => (idx = 0)} onkeydown={key} placeholder={tr("palette.placeholder")}
      role="combobox" aria-expanded="true" aria-controls="pal-list" aria-activedescendant={items[idx] ? `pal-${items[idx].id}` : undefined} />
    <ul id="pal-list" role="listbox">
      {#each items as it, i (it.id)}
        <li id="pal-{it.id}" role="option" aria-selected={i === idx} class:on={i === idx} onmousemove={() => (idx = i)} onclick={() => pick(it)} onkeydown={() => {}}>
          <span class="k">{tr({ Task: "palette.kind_task", Project: "palette.kind_project", Command: "palette.kind_command" }[it.kind])}</span><span class="t">{it.text}</span>{#if it.meta}<span class="meta">{it.meta}</span>{/if}
        </li>
      {:else}
        <li class="meta none">{tr("palette.no_matches")}</li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; background: rgb(0 0 0 / .18); z-index: 40; }
  .dialog { position: fixed; top: 14vh; left: 50%; transform: translateX(-50%); width: min(600px, 92vw); z-index: 41; background: var(--surface-raised); border-radius: var(--r-lg); box-shadow: var(--shadow-float), 0 0 0 1px var(--border); overflow: hidden; }
  input { width: 100%; border: 0; border-bottom: 1px solid var(--border); background: none; padding: 14px 16px; font-size: 16px; outline: none; }
  ul { list-style: none; margin: 0; padding: 6px; max-height: 50vh; overflow-y: auto; }
  li { display: flex; gap: 10px; align-items: center; padding: 7px 10px; border-radius: var(--r-md); font-size: 13px; cursor: default; }
  li.on { background: var(--hover); }
  .k { width: 64px; flex: none; font-size: 11px; color: var(--text-3); }
  .t { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .none { padding: 12px; }
</style>
