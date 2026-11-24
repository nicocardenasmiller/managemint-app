<script lang="ts">
  import { tr } from "./lib/wording";
  import { onMount } from "svelte";
  import { store } from "./lib/store.svelte";
  import { ui, ZOOMS } from "./lib/ui.svelte";
  import { getToken } from "./lib/api";
  import { shiftPatch } from "./lib/shift";
  import Setup from "./components/Setup.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import TopBar from "./components/TopBar.svelte";
  import DetailPanel from "./components/DetailPanel.svelte";
  import QuickAdd from "./components/QuickAdd.svelte";
  import Palette from "./components/Palette.svelte";
  import Help from "./components/Help.svelte";
  import NewProject from "./components/NewProject.svelte";
  import ProjectChat from "./components/ProjectChat.svelte";
  import Templates from "./components/Templates.svelte";
  import DeleteProject from "./components/DeleteProject.svelte";
  import Toasts from "./components/Toasts.svelte";
  import Onboarding from "./components/Onboarding.svelte";
  import Guidelines from "./components/Guidelines.svelte";
  import CalendarFeed from "./components/CalendarFeed.svelte";
  import ListView from "./views/ListView.svelte";
  import DailiesView from "./views/DailiesView.svelte";
  import Confetti from "./components/Confetti.svelte";
  import BoardView from "./views/BoardView.svelte";
  import TimelineView from "./views/TimelineView.svelte";
  import type { Status } from "./lib/types";
  import { scopeTitle } from "./lib/query";
  import { fullDate, today, weekdayLong } from "./lib/dates";

  // Phone layout (iPhone friends use the web app): lists only, tabs at the bottom, projects in a drawer.
  const PHONE = "(max-width: 700px)";
  let phone = $state(typeof matchMedia === "function" && matchMedia(PHONE).matches);
  let drawer = $state(false);
  let showDate = $state(false);
  onMount(() => {
    const m = matchMedia(PHONE);
    const on = () => (phone = m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  });
  // Picking a project in the drawer closes it.
  $effect(() => { void ui.scope; drawer = false; });
  const TABS = [["today", tr("scope.today")], ["dailies", tr("scope.dailies")], ["upcoming", tr("scope.upcoming")], ["inbox", tr("scope.inbox")]] as const;

  let hasToken = $state(Boolean(getToken()));
  $effect(() => { void store.signIns; hasToken = !store.unauthorized && Boolean(getToken()); });
  onMount(() => store.start());

  $effect(() => {
    const r = document.documentElement;
    if (ui.theme === "system") r.removeAttribute("data-theme"); else r.setAttribute("data-theme", ui.theme);
    if (ui.accent === "blue") r.removeAttribute("data-accent"); else r.setAttribute("data-accent", ui.accent);
  });
  // A deleted (or remotely deleted) task closes its panel.
  $effect(() => { if (ui.panel && ui.selected && !store.tasks[ui.selected]) ui.close(); });

  function typing(e: KeyboardEvent): boolean {
    const el = e.target as HTMLElement;
    return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
  }

  function step(dir: 1 | -1) {
    const order = ui.order;
    if (!order.length) return;
    const i = ui.selected ? order.indexOf(ui.selected) : -1;
    const next = order[Math.max(0, Math.min(order.length - 1, i < 0 ? 0 : i + dir))];
    ui.selected = next;
    document.querySelector(`[data-task="${next}"]`)?.scrollIntoView({ block: "nearest" });
  }

  const CYCLE: Status[] = ["todo", "doing", "done"];

  function key(e: KeyboardEvent) {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); ui.palette = !ui.palette; return; }
    if (ui.onboarding || ui.guidelines || ui.calendarFeed) return;
    if (ui.palette || ui.quickAdd || ui.help || ui.newProject || ui.templates || ui.deleteProject) {
      if (e.key === "Escape") { ui.help = false; ui.newProject = false; ui.templates = null; ui.deleteProject = null; }
      return;
    }
    if (typing(e)) return;
    const sel = ui.selected ? store.tasks[ui.selected] : undefined;

    if (mod) {
      if (e.key === "z" && !e.shiftKey) { e.preventDefault(); store.undo(); }
      else if (e.key === "Enter" && sel) { e.preventDefault(); store.toggleDone(sel.id); }
      else if (e.key === "\\") { e.preventDefault(); ui.sidebar = !ui.sidebar; ui.save(); }
      else if (e.key === "." ) { e.preventDefault(); ui.panel = !ui.panel; }
      else if (e.key === "=" || e.key === "+" || e.key === "-") {
        if (ui.view !== "timeline") return;
        e.preventDefault();
        const i = ZOOMS.indexOf(ui.zoom) + (e.key === "-" ? 1 : -1);
        if (i >= 0 && i < ZOOMS.length) { ui.zoom = ZOOMS[i]; ui.save(); }
      }
      return;
    }
    if (e.altKey) return;
    switch (e.key) {
      case "q": case "Q": e.preventDefault(); ui.quickAdd = true; break;
      case "?": ui.help = true; break;
      case "1": ui.view = "timeline"; break;
      case "2": ui.view = "board"; break;
      case "3": ui.view = "list"; break;
      case "j": case "ArrowDown": if (ui.view !== "timeline" || e.key === "j") { e.preventDefault(); step(1); } break;
      case "k": case "ArrowUp": if (ui.view !== "timeline" || e.key === "k") { e.preventDefault(); step(-1); } break;
      case "Enter": if (sel) ui.open(sel.id); break;
      case "Escape": if (ui.panel) ui.close(); else ui.selected = null; break;
      case "t": case "T": if (ui.view === "timeline") ui.scrollToToday++; break;
      case "h": case "H": ui.hideOldDone = !ui.hideOldDone; ui.save(); store.toast(ui.hideOldDone ? tr("app.hiding_old") : tr("app.showing_all"), undefined, 2500); break;
      case "f": case "F":
        if (ui.view === "timeline") ui.focus = ui.focus ? null : sel?.project_id ?? null;
        break;
      case "e": case "E":
        if (sel) { e.preventDefault(); ui.open(sel.id); setTimeout(() => (document.querySelector("aside textarea.title") as HTMLTextAreaElement | null)?.focus()); }
        break;
      case "s": case "S":
        if (sel) store.setStatus(sel.id, CYCLE[(CYCLE.indexOf(sel.status) + 1) % CYCLE.length]);
        break;
      case "Backspace": case "Delete":
        if (sel) { e.preventDefault(); store.deleteTask(sel.id); }
        break;
      case "[": case "]": case "{": case "}":
        if (sel) {
          const n = (e.key === "[" || e.key === "{" ? -1 : 1) * (e.shiftKey ? 7 : 1);
          const p = shiftPatch(sel, "move", n);
          if (Object.keys(p).length) store.patchTask(sel.id, p); else store.toast(tr("app.no_date_to_move"), undefined, 2000);
        }
        break;
    }
  }
</script>

<svelte:window onkeydown={key} />

{#if !hasToken}
  <Setup />
{:else if phone}
  <div class="phone">
    <header>
      <button class="btn ghost icon" aria-label={tr("app.projects")} onclick={() => (drawer = true)}>☰</button>
      {#if ui.scope === "today"}
        <!-- Today shows just the weekday; a tap reveals the full date. -->
        <button class="day" aria-expanded={showDate} title={tr("app.show_date")} onclick={() => (showDate = !showDate)}>
          <h1>{showDate ? fullDate(today()) : weekdayLong(today())}</h1>
        </button>
      {:else}
        <h1>{scopeTitle(ui.scope)}</h1>
      {/if}
      <button class="sync {store.syncState}" aria-label={tr("app.sync_now")} onclick={() => store.syncNow()}></button>
    </header>
    <div class="view">
      {#if !store.loaded}
        <div class="skeleton" aria-label={tr("app.loading")}>{#each Array(6) as _, i}<div style="width:{40 + ((i * 37) % 45)}%"></div>{/each}</div>
      {:else if ui.scope === "dailies"}<DailiesView phone />
      {:else}<ListView phone />{/if}
    </div>
    <DetailPanel />
    <nav class="tabs" aria-label={tr("app.views")}>
      {#each TABS as [scope, name]}
        <button class:on={ui.scope === scope} aria-current={ui.scope === scope ? "page" : undefined} onclick={() => (ui.scope = scope)}>{name}</button>
      {/each}
      <button class:on={ui.scope.startsWith("p:") || ui.scope === "all"} onclick={() => (drawer = true)}>{tr("app.projects")}</button>
    </nav>
    <button class="fab" aria-label={tr("app.add_task")} onclick={() => (ui.quickAdd = true)}>+</button>
    {#if drawer}
      <div class="scrim" role="presentation" onclick={() => (drawer = false)}></div>
      <div class="drawer"><Sidebar /></div>
    {/if}
  </div>
  <QuickAdd />
  <NewProject /><ProjectChat />
  <Templates />
{:else}
  <div class="app">
    {#if ui.sidebar}<Sidebar />{/if}
    <div class="main">
      <TopBar />
      <div class="content">
        <div class="view">
          {#if !store.loaded}
            <div class="skeleton" aria-label={tr("app.loading")}>{#each Array(6) as _, i}<div style="width:{40 + ((i * 37) % 45)}%"></div>{/each}</div>
          {:else if ui.scope === "dailies"}<DailiesView />
          {:else if ui.view === "timeline"}<TimelineView />
          {:else if ui.view === "board"}<BoardView />
          {:else}<ListView />{/if}
        </div>
        <DetailPanel />
      </div>
    </div>
  </div>
  <QuickAdd />
  <Palette />
  <Help />
  <NewProject /><ProjectChat />
  <Templates />
  <DeleteProject />
{/if}
{#if hasToken}<Onboarding /><Guidelines /><CalendarFeed />{/if}
<Toasts />
<Confetti />

<style>
  .app { display: flex; height: 100%; background: var(--bg); }
  .main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .content { flex: 1; min-height: 0; display: flex; }
  .view { flex: 1; min-width: 0; min-height: 0; }
  .phone { height: 100%; display: flex; flex-direction: column; background: var(--bg); }
  .phone header { display: flex; align-items: center; gap: 8px; padding: max(8px, env(safe-area-inset-top)) 12px 4px; background: var(--bg); }
  .phone header h1 { flex: 1; min-width: 0; margin: 0; font-size: 22px; line-height: 30px; font-weight: 600; letter-spacing: -.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .phone header .day { flex: 1; min-width: 0; display: flex; border: 0; background: none; padding: 0; text-align: left; }
  .phone header .day h1 { font-size: 28px; line-height: 34px; }
  .phone .view { flex: 1; min-height: 0; overflow-y: auto; }
  .phone .sync { width: 10px; height: 10px; border-radius: 50%; border: 0; padding: 0; background: var(--success, #3f6b5a); }
  .phone .sync.offline, .phone .sync.error { background: var(--danger, #a5492f); }
  .phone .sync.syncing { opacity: .5; }
  .tabs { display: flex; border-top: 1px solid var(--border); background: var(--surface); padding-bottom: env(safe-area-inset-bottom); }
  .tabs button { flex: 1; border: 0; background: none; padding: 12px 4px; font-size: 13px; color: var(--text-2); }
  .tabs button.on { color: var(--accent); font-weight: 600; }
  .fab { position: fixed; right: 16px; bottom: calc(64px + env(safe-area-inset-bottom)); width: 52px; height: 52px; border-radius: 50%; border: 0;
         background: var(--accent); color: var(--on-accent); font-size: 28px; line-height: 1; box-shadow: var(--shadow-float); z-index: 20; }
  .scrim { position: fixed; inset: 0; background: rgb(0 0 0 / .25); z-index: 30; }
  .drawer { position: fixed; inset: 0 auto 0 0; z-index: 31; display: flex; max-width: 85vw; }
  .drawer :global(nav) { width: 280px; max-width: 85vw; padding-top: max(12px, env(safe-area-inset-top)); }
  /* The task panel becomes a full-screen sheet. */
  .phone :global(aside.detail-panel) { position: fixed; inset: 0; width: auto; z-index: 25; border-left: 0;
         padding-top: max(14px, env(safe-area-inset-top)); padding-bottom: max(14px, env(safe-area-inset-bottom)); }
  .skeleton { padding: 40px 24px; display: grid; gap: 14px; }
  .skeleton div { height: 18px; border-radius: 4px; background: var(--text); opacity: .08; }
</style>
