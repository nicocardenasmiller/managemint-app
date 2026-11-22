<script lang="ts">
  import { tr } from "../lib/wording";
  // A mic button that dictates into a text field: the spoken text is added after what's already there.
  import { dictate, voiceSupported } from "../lib/voice";
  let { value = $bindable(""), label = tr("mic.label") }: { value: string; label?: string } = $props();
  let stop = $state<null | (() => void)>(null);
  let error = $state("");
  function toggle() {
    if (stop) { stop(); return; }
    error = "";
    const before = value.trim();
    stop = dictate((t) => (value = before ? `${before} ${t}` : t), (e) => { stop = null; if (e) error = e; });
  }
</script>

{#if voiceSupported}
  <button type="button" class="mic" class:on={stop} aria-pressed={Boolean(stop)} aria-label={stop ? tr("mic.stop_label") : label} title={error || (stop ? tr("mic.stop") : label)} onclick={toggle}>
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"/></svg>
  </button>
  {#if error}<span class="err meta" role="alert">{error}</span>{/if}
{/if}

<style>
  .mic { flex: none; width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--border-strong); background: var(--surface); color: var(--text-2); display: grid; place-items: center; cursor: pointer; }
  .mic.on { background: var(--danger, #a5492f); border-color: transparent; color: #fff; animation: pulse 1.2s ease-in-out infinite; }
  .err { color: var(--danger, #a5492f); }
  @keyframes pulse { 50% { box-shadow: 0 0 0 5px color-mix(in srgb, var(--danger, #a5492f) 25%, transparent); } }
  @media (prefers-reduced-motion: reduce) { .mic.on { animation: none; } }
</style>
