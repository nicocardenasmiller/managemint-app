<script lang="ts">
  import { tr } from "../lib/wording";
  import { ui } from "../lib/ui.svelte";
  const KEYS: Array<[string, string]> = [
    ["⌘K", tr("help.key_search")], ["Q", tr("help.key_quick_add")], ["1 / 2 / 3", tr("help.key_views")],
    ["J / K", tr("help.key_next_prev")], ["↵", tr("help.key_open")], ["E", tr("help.key_edit")], ["Esc", tr("help.key_close")],
    ["⌘↵", tr("help.key_done")], ["S", tr("help.key_status")], ["⌫", tr("help.key_delete")], ["⌘Z", tr("help.key_undo")],
    ["[ / ]", tr("help.key_move_day")], ["⇧[ / ⇧]", tr("help.key_move_week")], ["T", tr("help.key_today")],
    ["⌘+ / ⌘−", tr("help.key_zoom")], ["F", tr("help.key_focus")], ["H", tr("help.key_old_done")], ["⌘\\", tr("help.key_sidebar")],
  ];
</script>

{#if ui.help}
  <div class="scrim" role="presentation" onclick={() => (ui.help = false)}></div>
  <div class="dialog" role="dialog" aria-modal="true" aria-label={tr("help.dialog_label")}>
    <h2 class="page-title">{tr("help.title")}</h2>
    <dl>{#each KEYS as [k, v]}<dt><span class="kbd">{k}</span></dt><dd>{v}</dd>{/each}</dl>
    <p class="meta">{tr("help.drag_tip")}</p>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; background: rgb(0 0 0 / .18); z-index: 40; }
  .dialog { position: fixed; top: 10vh; left: 50%; transform: translateX(-50%); width: min(520px, 92vw); z-index: 41; background: var(--surface-raised); border-radius: var(--r-lg); box-shadow: var(--shadow-float), 0 0 0 1px var(--border); padding: 20px 24px; }
  dl { display: grid; grid-template-columns: 110px 1fr; gap: 6px 12px; font-size: 13px; margin: 16px 0; }
  dt, dd { margin: 0; }
  p { margin: 0; }
</style>
