<script lang="ts">
  import { tr } from "../lib/wording";
  // The private calendar link (GET /calendar/feed, POST /calendar/feed/reset; backend/src/feed.ts).
  // Calendar apps subscribe to it and re-read it on their own schedule; it only goes one way.
  import { api } from "../lib/api";
  import { store } from "../lib/store.svelte";
  import { ui } from "../lib/ui.svelte";
  interface Feed { url: string; webcal: string; google: string; qr_svg: string }
  let feed = $state<Feed | null>(null);
  let error = $state("");
  let busy = $state(false);

  $effect(() => {
    if (!ui.calendarFeed) return;
    error = "";
    api<Feed>("GET", "/calendar/feed").then((f) => (feed = f)).catch((e) => { error = tr("calendarfeed.load_failed", { error: e?.message ?? tr("calendarfeed.offline") }); });
  });
  async function copy() {
    if (!feed) return;
    try { await navigator.clipboard.writeText(feed.url); store.toast(tr("calendarfeed.copied"), undefined, 2500); }
    catch { window.prompt(tr("calendarfeed.copy_prompt"), feed.url); }
  }
  async function reset() {
    if (!confirm(tr("calendarfeed.reset_confirm"))) return;
    busy = true; error = "";
    try { feed = await api<Feed>("POST", "/calendar/feed/reset"); store.toast(tr("calendarfeed.reset_done"), undefined, 5000); }
    catch (e: any) { error = tr("calendarfeed.reset_failed", { error: e?.message ?? tr("calendarfeed.offline") }); }
    finally { busy = false; }
  }
</script>

{#if ui.calendarFeed}
  <div class="scrim" role="presentation" onclick={() => (ui.calendarFeed = false)}></div>
  <div class="dialog" role="dialog" aria-modal="true" aria-label={tr("calendarfeed.title")} tabindex="-1" onkeydown={(e) => { e.stopPropagation(); if (e.key === "Escape") ui.calendarFeed = false; }}>
    <h2 class="page-title">{tr("calendarfeed.title")}</h2>
    <p class="meta">{tr("calendarfeed.intro")}</p>
    {#if feed}
      <div class="row start">
        <a class="btn primary" href={feed.webcal}>{tr("calendarfeed.apple")}</a>
        <a class="btn" href={feed.google} target="_blank" rel="noopener noreferrer">{tr("calendarfeed.google")}</a>
        <button class="btn" onclick={copy}>{tr("calendarfeed.copy")}</button>
      </div>
      <div class="qrrow">
        <div class="qr" aria-label={tr("calendarfeed.qr_label")}>{@html feed.qr_svg}</div>
        <div class="meta">
          <p>{@html tr("calendarfeed.scan")}</p>
          <p>{tr("calendarfeed.private")}</p>
          <button class="btn ghost small" disabled={busy} onclick={reset}>{busy ? tr("calendarfeed.making") : tr("calendarfeed.new_link")}</button>
        </div>
      </div>
    {:else if !error}
      <p class="meta">{tr("calendarfeed.loading")}</p>
    {/if}
    {#if error}<p class="danger meta" role="alert">{error}</p>{/if}
    <div class="row"><button class="btn ghost" onclick={() => (ui.calendarFeed = false)}>{tr("calendarfeed.close")}</button></div>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; background: rgb(0 0 0 / .18); z-index: 70; }
  .dialog { position: fixed; top: 8vh; left: 50%; transform: translateX(-50%); width: min(600px, 94vw); max-height: 84vh; overflow-y: auto; z-index: 71;
            background: var(--surface-raised); border-radius: var(--r-lg); box-shadow: var(--shadow-float), 0 0 0 1px var(--border); padding: 20px 24px;
            display: grid; gap: 12px; }
  h2, p { margin: 0; }
  .row { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
  .row.start { justify-content: flex-start; }
  a.btn { text-decoration: none; }
  a.btn:not(.primary) { color: var(--text); }
  .qrrow { display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
  .qrrow .meta { flex: 1; min-width: 14rem; display: grid; gap: 8px; justify-items: start; }
  .qr { background: #fff; padding: 8px; border-radius: var(--r-md); line-height: 0; }
  .qr :global(svg) { width: 160px; height: 160px; }
  @media (max-width: 700px) { .dialog { top: 0; left: 0; transform: none; width: 100%; max-height: 100dvh; height: 100dvh; border-radius: 0; padding-top: max(20px, env(safe-area-inset-top)); align-content: start; } }
</style>
