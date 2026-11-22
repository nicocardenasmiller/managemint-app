<script lang="ts">
  import { tr } from "../lib/wording";
  import type { Status } from "../lib/types";
  let { status, onToggle, title = "" }: { status: Status; onToggle: () => void; title?: string } = $props();
</script>

<button class="ring" class:done={status === "done"} onclick={(e) => { e.stopPropagation(); onToggle(); }}
  aria-label={status === "done" ? tr("checkring.mark_not_done", { title }) : tr("checkring.mark_done", { title })} aria-pressed={status === "done"}>
  <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
    {#if status === "done"}
      <circle cx="9" cy="9" r="8" fill="var(--h-solid)" />
      <path d="M5.5 9.2l2.3 2.3 4.7-4.9" fill="none" stroke="var(--surface)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
    {:else if status === "doing"}
      <circle cx="9" cy="9" r="7.25" fill="none" stroke="var(--accent)" stroke-width="1.5" />
      <path d="M9 1.75a7.25 7.25 0 0 1 0 14.5z" fill="var(--accent)" />
    {:else if status === "cancelled"}
      <circle cx="9" cy="9" r="7.25" fill="none" stroke="var(--text-3)" stroke-width="1.5" stroke-dasharray="3 2" />
      <path d="M4 14L14 4" stroke="var(--text-3)" stroke-width="1.5" />
    {:else}
      <circle cx="9" cy="9" r="7.25" fill="none" stroke="var(--text-3)" stroke-width="1.5" />
    {/if}
  </svg>
</button>

<style>
  .ring { border: 0; background: none; padding: 3px; margin: -3px; border-radius: 50%; display: grid; place-items: center; flex: none; }
  .ring:hover circle { stroke: var(--h-solid); }
  .ring svg { transition: transform var(--dur-fast) var(--spring-fast); }
  .ring:active svg { transform: scale(.85); }
</style>
