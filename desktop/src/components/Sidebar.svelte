<script lang="ts">
  import { tr } from "../lib/wording";
  import { store } from "../lib/store.svelte";
  import { ui, type Scope } from "../lib/ui.svelte";
  import { projectList, tasksInScope, isOpen } from "../lib/query";
  import { hueOf, hueVars, projectCode } from "../lib/colors";

  const count = (s: Scope) => tasksInScope(s).filter(isOpen).length;
  let projects = $derived(projectList().filter((p) => p.id !== "inbox"));
  const fixed: Array<[Scope, string]> = [["inbox", tr("scope.inbox")], ["today", tr("scope.today")], ["upcoming", tr("scope.upcoming")], ["all", tr("scope.all")]];
</script>

<nav aria-label={tr("sidebar.nav_label")}>
  <div class="brand"><img src="/app/icon.svg" alt="" width="20" height="20" /> Managemint</div>
  <button class="search" onclick={() => (ui.palette = true)}><span>{tr("sidebar.search")}</span><span class="kbd">⌘K</span></button>
  <button class="add" onclick={() => (ui.quickAdd = true)}><span>{tr("sidebar.add_task")}</span><span class="kbd">Q</span></button>

  <ul>
    {#each fixed as [s, name]}
      {@const n = s === "all" ? 0 : count(s)}
      <li><button class:active={ui.scope === s} onclick={() => ui.go(s)}>
        <span>{name}</span>{#if n}<span class="n" class:danger={s === "today"}>{n}</span>{/if}
      </button></li>
    {/each}
  </ul>

  <div class="label head">{tr("sidebar.projects_heading")}</div>
  <ul>
    {#each projects as p (p.id)}
      {@const h = hueOf(p.id, p.color)}
      <li><button class:active={ui.scope === `p:${p.id}`} style={hueVars(h)} onclick={() => ui.go(`p:${p.id}`)}
        oncontextmenu={(e) => { e.preventDefault(); ui.deleteProject = p.id; }} title={tr("sidebar.project_right_click")}>
        <span class="bar" aria-hidden="true"></span>
        <span class="name">{p.name}</span>
        <span class="code">{projectCode(p.name)}</span>
      </button></li>
    {/each}
    <li><button class="new" onclick={() => (ui.newProject = true)}>{tr("sidebar.new_project_button")}</button></li>
    <li><button class="new" onclick={() => (ui.templates = "use")}>{tr("sidebar.templates_button")}</button></li>
  </ul>

  <div class="foot">
    <button class="btn ghost" onclick={() => (ui.help = true)}>{tr("sidebar.shortcuts_button")} <span class="kbd">?</span></button>
  </div>
</nav>

<style>
  nav { width: 220px; flex: none; background: var(--surface-sunken); border-right: 1px solid var(--border); display: flex; flex-direction: column; padding: 12px 8px; gap: 2px; overflow-y: auto; }
  .brand { display: flex; align-items: center; gap: 8px; font-weight: 600; padding: 4px 8px 12px; }
  .brand img { border-radius: 5px; }
  ul { list-style: none; margin: 0 0 8px; padding: 0; }
  li button, .search, .add { width: 100%; display: flex; align-items: center; gap: 8px; border: 0; background: none; border-radius: var(--r-md); padding: 5px 8px; text-align: left; font-size: 13px; line-height: 20px; color: var(--text-2); }
  li button:hover, .search:hover, .add:hover { background: var(--hover); color: var(--text); }
  li button.active { background: var(--hover); color: var(--text); font-weight: 500; }
  .search, .add { justify-content: space-between; }
  .add { color: var(--accent); font-weight: 500; margin-bottom: 8px; }
  .n { margin-left: auto; font-size: 12px; color: var(--text-3); }
  .n.danger { color: var(--danger); }
  .bar { width: 3px; height: 16px; border-radius: 2px; background: var(--h-solid); flex: none; }
  .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .head { padding: 8px 8px 4px; }
  .new { color: var(--text-3) !important; }
  .foot { margin-top: auto; }
  .foot .btn { font-size: 12px; color: var(--text-3); display: flex; gap: 6px; align-items: center; }
</style>
