<script lang="ts">
  import { tr } from "../lib/wording";
  import { api, setToken } from "../lib/api";
  import { store } from "../lib/store.svelte";
  let input = $state("");
  let error = $state("");
  let busy = $state(false);
  let advanced = $state(false);

  // Pairing codes are 8 characters from the server's alphabet (no 0/O, 1/I/L); dashes and spaces are ignored.
  const asCode = (s: string) => {
    const c = s.toUpperCase().replace(/[\s-]/g, "");
    return /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/.test(c) ? c : null;
  };
  const deviceName = () => {
    const ua = navigator.userAgent;
    return tr("setup.device_name", { device: /iPhone|iPad/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : tr("setup.device_computer") });
  };

  async function submit(e: Event) {
    e.preventDefault();
    busy = true; error = "";
    try {
      let token = input.trim();
      if (!advanced) {
        const code = asCode(token);
        if (!code) { error = tr("setup.code_format"); return; }
        token = (await api<{ token: string }>("POST", "/pair/claim", { code, name: deviceName() }, null)).token;
      } else {
        await api("GET", "/projects", undefined, token);
      }
      setToken(token);
      store.unauthorized = false;
      store.signIns++;
      store.clearCache();
      store.syncNow();
    } catch (err: any) {
      error = err?.status === 401 ? (advanced ? tr("setup.token_rejected") : tr("setup.code_rejected"))
        : err?.status === 429 ? tr("setup.too_many")
        : tr("setup.unreachable");
    } finally { busy = false; }
  }
</script>

<main>
  <form onsubmit={submit}>
    <img src="/app/icon.svg" alt="" width="56" height="56" />
    <h1 class="page-title">Managemint</h1>
    {#if !advanced}
      <p class="meta">{@html tr("setup.pair_help")}</p>
      <input class="input code" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" placeholder="KP7Z-9RNP" bind:value={input} aria-label={tr("setup.code_label")} />
    {:else}
      <p class="meta">{@html tr("setup.token_help")}</p>
      <input class="input" type="password" autocomplete="off" spellcheck="false" placeholder={tr("setup.token_placeholder")} bind:value={input} aria-label={tr("setup.token_placeholder")} />
    {/if}
    {#if error}<p class="danger meta" role="alert">{error}</p>{/if}
    <button class="btn primary" disabled={!input.trim() || busy}>{busy ? tr("setup.checking") : tr("setup.continue")}</button>
    <button type="button" class="btn ghost small" onclick={() => { advanced = !advanced; input = ""; error = ""; }}>
      {advanced ? tr("setup.use_code") : tr("setup.use_token")}
    </button>
  </form>
</main>

<style>
  main { height: 100%; display: grid; place-items: center; background: var(--bg); padding: 16px; }
  form { width: min(380px, 100%); display: grid; gap: 14px; justify-items: start; }
  input { width: 100%; padding: 8px 10px; font-size: 14px; }
  input.code { font: 600 20px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .12em; text-transform: uppercase; }
  p { margin: 0; }
  .meta :global(code) { font-size: 12px; background: var(--surface-sunken); padding: 1px 4px; border-radius: 3px; }
  .small { font-size: 12px; padding: 2px 0; }
</style>
