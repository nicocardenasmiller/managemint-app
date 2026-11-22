<script lang="ts">
  import { tr } from "../lib/wording";
  import { store } from "../lib/store.svelte";
</script>

<div class="toasts" role="status" aria-live="polite">
  {#each store.toasts as t (t.id)}
    <div class="toast">
      <span>{t.text}</span>
      {#if t.action}<button class="act" onclick={() => { t.action!.run(); store.dismiss(t.id); }}>{t.action.label}</button>{/if}
      <button class="x" aria-label={tr("toasts.dismiss")} onclick={() => store.dismiss(t.id)}>×</button>
    </div>
  {/each}
</div>

<style>
  .toasts { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); display: grid; gap: 8px; z-index: 50; }
  .toast { display: flex; align-items: center; gap: 12px; background: var(--text); color: var(--bg); border-radius: var(--r-md); padding: 8px 8px 8px 14px; font-size: 13px; box-shadow: var(--shadow-float); animation: up var(--dur-fast) var(--spring-fast); }
  .act { border: 0; background: none; color: var(--accent-tint); font-weight: 600; padding: 2px 6px; border-radius: 4px; }
  .act:hover { background: rgb(255 255 255 / .1); }
  .x { border: 0; background: none; color: inherit; opacity: .6; font-size: 16px; padding: 0 6px; }
  @keyframes up { from { transform: translateY(12px); opacity: 0; } }
</style>
