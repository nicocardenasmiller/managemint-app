<script lang="ts">
  import { tr } from "../lib/wording";
  // The user's own planning notes (GET/PUT /settings/guidelines). The assistant reads the built-in guidelines
  // (prompt/planning_guidelines.md) plus these whenever it drafts projects; these win where they disagree.
  import { api } from "../lib/api";
  import { store } from "../lib/store.svelte";
  import { ui } from "../lib/ui.svelte";
  import Mic from "./Mic.svelte";
  const MAX = 4000;
  let text = $state("");
  let builtin = $state("");
  let loaded = $state(false);
  let busy = $state(false);
  let error = $state("");

  $effect(() => {
    if (!ui.guidelines) return;
    loaded = false; error = "";
    api<{ text: string; builtin: string }>("GET", "/settings/guidelines")
      .then((r) => { text = r.text; builtin = r.builtin; loaded = true; })
      .catch((e) => { error = tr("guidelines.load_failed", { error: e?.message ?? tr("guidelines.offline") }); });
  });
  // The built-in file is Markdown with wrapped lines: show it as headed lists of plain sentences.
  const sections = $derived(builtin.split(/^## /m).filter((x) => x.trim()).map((block) => {
    const [head, ...rest] = block.split("\n");
    const items = rest.join("\n").split(/^- /m).map((x) => x.replace(/\s*\n\s*/g, " ").replace(/\*\*/g, "").trim()).filter(Boolean);
    return { head: head.trim(), items };
  }));
  async function save(e: Event) {
    e.preventDefault();
    busy = true; error = "";
    try { await api("PUT", "/settings/guidelines", { text }); store.toast(tr("guidelines.saved")); ui.guidelines = false; }
    catch (err: any) { error = tr("guidelines.save_failed", { error: err?.message ?? tr("guidelines.offline") }); }
    finally { busy = false; }
  }
</script>

{#if ui.guidelines}
  <div class="scrim" role="presentation" onclick={() => (ui.guidelines = false)}></div>
  <div class="dialog" role="dialog" aria-modal="true" aria-label={tr("guidelines.title")} tabindex="-1" onkeydown={(e) => { e.stopPropagation(); if (e.key === "Escape") ui.guidelines = false; }}>
    <form onsubmit={save}>
      <h2 class="page-title">{tr("guidelines.title")}</h2>
      <p class="meta">{tr("guidelines.intro")}</p>
      <span class="with-mic">
        <textarea class="input" rows="7" maxlength={MAX} bind:value={text} disabled={!loaded} placeholder={tr("guidelines.placeholder")} aria-label={tr("guidelines.notes_label")}></textarea>
        <Mic bind:value={text} label={tr("guidelines.dictate")} />
      </span>
      <p class="meta count">{text.length} / {MAX}</p>
      <details>
        <summary class="meta">{tr("guidelines.builtin")}</summary>
        <div class="builtin">
          {#each sections as sec}<h3>{sec.head}</h3><ul>{#each sec.items as it}<li>{it}</li>{/each}</ul>{/each}
        </div>
      </details>
      {#if error}<p class="danger meta" role="alert">{error}</p>{/if}
      <div class="row">
        <button type="button" class="btn ghost" onclick={() => (ui.guidelines = false)}>{tr("guidelines.cancel")}</button>
        <button class="btn primary" disabled={!loaded || busy}>{busy ? tr("guidelines.saving") : tr("guidelines.save")}</button>
      </div>
    </form>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; background: rgb(0 0 0 / .18); z-index: 70; }
  .dialog { position: fixed; top: 8vh; left: 50%; transform: translateX(-50%); width: min(600px, 94vw); max-height: 84vh; overflow-y: auto; z-index: 71;
            background: var(--surface-raised); border-radius: var(--r-lg); box-shadow: var(--shadow-float), 0 0 0 1px var(--border); padding: 20px 24px; }
  form { display: grid; gap: 12px; }
  h2, p { margin: 0; }
  .with-mic { display: flex; gap: 8px; align-items: flex-start; }
  textarea { flex: 1; min-width: 0; padding: 8px 10px; font: inherit; resize: vertical; }
  .count { text-align: right; margin-top: -6px; }
  .builtin { font-size: 13px; line-height: 19px; color: var(--text-2); background: var(--surface-sunken); padding: 4px 14px 10px; border-radius: var(--r-md); margin-top: 8px; }
  .builtin h3 { font-size: 13px; font-weight: 600; color: var(--text); margin: 10px 0 4px; }
  .builtin ul { margin: 0; padding-left: 18px; display: grid; gap: 4px; }
  summary { cursor: pointer; }
  .row { display: flex; justify-content: flex-end; gap: 8px; }
  @media (max-width: 700px) { .dialog { top: 0; left: 0; transform: none; width: 100%; max-height: 100dvh; height: 100dvh; border-radius: 0; padding-top: max(20px, env(safe-area-inset-top)); } }
</style>
