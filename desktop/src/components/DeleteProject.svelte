<script lang="ts">
  import { tr } from "../lib/wording";
  import { store } from "../lib/store.svelte";
  import { ui } from "../lib/ui.svelte";

  let p = $derived(ui.deleteProject ? store.projects[ui.deleteProject] : undefined);
  let tasks = $derived(p ? Object.values(store.tasks).filter((t) => t.project_id === p!.id) : []);
  let open = $derived(tasks.filter((t) => t.status === "todo" || t.status === "doing").length);
  let mode = $state<"inbox" | "delete">("inbox");
  $effect(() => { if (ui.deleteProject) mode = "inbox"; });

  function close() { ui.deleteProject = null; }
  function confirm() {
    if (!p) return;
    const id = p.id;
    close();
    void store.deleteProject(id, mode);
  }
  function focusEl(el: HTMLElement) { el.focus(); }
</script>

{#if p && p.id !== "inbox"}
  <div class="scrim" role="presentation" onclick={close}></div>
  <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="del-title" tabindex="-1"
    onkeydown={(e) => { e.stopPropagation(); if (e.key === "Escape") close(); }}>
    <h2 class="page-title" id="del-title">{tr("deleteproject.title", { name: p.name })}</h2>
    {#if tasks.length}
      <p class="meta">{tr(tasks.length === 1 ? "deleteproject.has_tasks_one" : "deleteproject.has_tasks_other", { n: tasks.length, open })}</p>
      <label class="opt"><input type="radio" bind:group={mode} value="inbox" />
        <span><b>{tr("deleteproject.move_inbox")}</b><br /><span class="meta">{tr("deleteproject.move_inbox_help")}</span></span></label>
      <label class="opt"><input type="radio" bind:group={mode} value="delete" />
        <span><b>{tr("deleteproject.delete_tasks")}</b><br /><span class="meta">{tr("deleteproject.delete_tasks_help")}</span></span></label>
    {:else}
      <p class="meta">{tr("deleteproject.no_tasks")}</p>
    {/if}
    <p class="meta">{tr("deleteproject.undo_hint")}</p>
    <div class="row">
      <button class="btn ghost" onclick={close}>{tr("deleteproject.cancel")}</button>
      <button class="btn danger" use:focusEl onclick={confirm}>{tr("deleteproject.confirm")}</button>
    </div>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; background: rgb(0 0 0 / .18); z-index: 40; }
  .dialog { position: fixed; top: 14vh; left: 50%; transform: translateX(-50%); width: min(440px, 92vw); z-index: 41; background: var(--surface-raised); border-radius: var(--r-lg); box-shadow: var(--shadow-float), 0 0 0 1px var(--border); padding: 20px 24px; display: grid; gap: 12px; }
  p { margin: 0; }
  .opt { display: flex; gap: 10px; align-items: flex-start; padding: 8px 10px; border-radius: var(--r-md); border: 1px solid var(--border); cursor: pointer; font-size: 13px; }
  .opt:has(input:checked) { border-color: var(--accent); }
  .opt input { margin-top: 3px; }
  .row { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
  .danger { background: var(--danger); color: #fff; border-color: transparent; }
  .danger:hover { filter: brightness(1.05); }
</style>
