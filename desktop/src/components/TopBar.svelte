<script lang="ts">
  import { tr } from "../lib/wording";
  import { store } from "../lib/store.svelte";
  import { ui, ZOOMS, type View } from "../lib/ui.svelte";
  import { scopeTitle } from "../lib/query";

  const VIEWS: Array<[View, string, string]> = [["timeline", tr("topbar.view_timeline"), "1"], ["board", tr("topbar.view_board"), "2"], ["list", tr("topbar.view_list"), "3"]];
  let projectId = $derived(ui.scope.startsWith("p:") && ui.scope !== "p:inbox" ? ui.scope.slice(2) : null);
  let menu = $state(false);
  let now = $state(Date.now());
  $effect(() => { const i = setInterval(() => (now = Date.now()), 1000); return () => clearInterval(i); });
  let ago = $derived(store.lastSync ? Math.max(0, Math.round((now - store.lastSync) / 1000)) : null);
  let syncTitle = $derived(
    store.syncState === "offline" ? tr("topbar.sync_offline") :
    store.syncState === "error" ? tr("topbar.sync_error", { error: store.syncError ?? "" }) :
    store.syncState === "syncing" ? tr("topbar.sync_syncing") :
    ago === null ? tr("topbar.sync_never") : ago < 60 ? tr("topbar.sync_seconds", { n: ago }) : tr("topbar.sync_minutes", { n: Math.round(ago / 60) }));
</script>

<header>
  <button class="btn ghost icon" aria-label={tr("topbar.toggle_sidebar")} title={tr("topbar.toggle_sidebar")} onclick={() => { ui.sidebar = !ui.sidebar; ui.save(); }}>
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor"/><path d="M6 2.5v11" stroke="currentColor"/></svg>
  </button>
  <h1>{scopeTitle(ui.scope)}</h1>
  {#if projectId}
    <div class="menu-wrap">
      <button class="btn ghost icon" aria-label={tr("topbar.project_actions")} title={tr("topbar.project_actions")} aria-haspopup="menu" aria-expanded={menu} onclick={() => (menu = !menu)}>⋯</button>
      {#if menu}
        <div class="menu-scrim" role="presentation" onclick={() => (menu = false)}></div>
        <div class="menu" role="menu">
          <button role="menuitem" onclick={() => { menu = false; ui.templates = { save: projectId }; }}>{tr("topbar.save_template")}</button>
          <button role="menuitem" class="danger" onclick={() => { menu = false; ui.deleteProject = projectId; }}>{tr("topbar.delete_project")}</button>
        </div>
      {/if}
    </div>
  {/if}

  {#if ui.scope !== "dailies"}
  <div class="tabs" role="tablist" aria-label={tr("topbar.view_tabs")}>
    {#each VIEWS as [v, name, key]}
      <button role="tab" aria-selected={ui.view === v} class:on={ui.view === v} title="{name} ({key})" onclick={() => (ui.view = v)}>{name}</button>
    {/each}
  </div>
  {/if}

  <div class="right">
    {#if ui.view === "timeline"}
      <button class="btn ghost" onclick={() => ui.scrollToToday++} title={tr("topbar.today_title")}>{tr("topbar.today")}</button>
      <select class="input" aria-label={tr("topbar.zoom")} bind:value={ui.zoom} onchange={() => ui.save()}>
        {#each ZOOMS as z}<option value={z}>{tr({ week: "topbar.zoom_week", month: "topbar.zoom_month", quarter: "topbar.zoom_quarter", semester: "topbar.zoom_semester" }[z])}</option>{/each}
      </select>
    {:else if ui.view === "list" && ui.scope !== "dailies"}
      <select class="input" aria-label={tr("topbar.group_by")} bind:value={ui.listGroup} onchange={() => ui.save()}>
        <option value="project">{tr("topbar.group_project")}</option><option value="date">{tr("topbar.group_date")}</option>
      </select>
    {/if}
    <button class="sync {store.syncState}" title={syncTitle} aria-label={syncTitle} onclick={() => store.syncNow()}>
      {#if store.syncState === "ok"}✓{:else if store.syncState === "syncing"}⟳{:else}●{/if}
    </button>
  </div>
</header>

<style>
  header { height: 48px; flex: none; display: flex; align-items: center; gap: 12px; padding: 0 12px 0 8px; border-bottom: 1px solid var(--border); background: var(--bg); }
  h1 { font: 600 15px/22px var(--font-ui); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 30vw; }
  .icon { padding: 5px 6px; display: grid; place-items: center; color: var(--text-2); }
  .menu-wrap { position: relative; margin-left: -8px; }
  .menu-scrim { position: fixed; inset: 0; z-index: 30; }
  .menu { position: absolute; top: 30px; left: 0; z-index: 31; min-width: 180px; background: var(--surface-raised); border-radius: var(--r-md); box-shadow: var(--shadow-float), 0 0 0 1px var(--border); padding: 4px; display: grid; }
  .menu button { border: 0; background: none; text-align: left; padding: 6px 10px; border-radius: 6px; font-size: 13px; color: var(--text); }
  .menu button:hover { background: var(--hover); }
  .menu button.danger { color: var(--danger); }
  .tabs { display: flex; background: var(--surface-sunken); border-radius: var(--r-md); padding: 2px; }
  .tabs button { border: 0; background: none; border-radius: 6px; padding: 3px 12px; font-size: 13px; color: var(--text-2); }
  .tabs button.on { background: var(--surface); color: var(--text); font-weight: 500; box-shadow: 0 0 0 1px var(--border); }
  .right { margin-left: auto; display: flex; align-items: center; gap: 8px; }
  .sync { border: 0; background: none; width: 24px; height: 24px; border-radius: 50%; color: var(--success); font-size: 14px; }
  .sync:hover { background: var(--hover); }
  .sync.syncing { color: var(--text-3); }
  .sync.offline { color: var(--warning); }
  .sync.error { color: var(--danger); }
</style>
