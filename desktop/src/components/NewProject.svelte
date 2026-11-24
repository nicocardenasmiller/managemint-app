<script lang="ts">
  import { tr } from "../lib/wording";
  import { store } from "../lib/store.svelte";
  import { ui } from "../lib/ui.svelte";
  import { PALETTE, hueVars, projectCode } from "../lib/colors";
  let name = $state("");
  let color = $state<string>(PALETTE[5]);
  let busy = $state(false);
  async function create(e: Event) {
    e.preventDefault();
    if (!name.trim()) return;
    busy = true;
    const p = await store.createProject(name.trim(), color);
    busy = false;
    if (p) { ui.newProject = false; name = ""; ui.go(`p:${p.id}`); ui.view = "list"; }
  }
  function focusEl(el: HTMLInputElement) { el.focus(); }
</script>

{#if ui.newProject === "plain"}
  <div class="scrim" role="presentation" onclick={() => (ui.newProject = false)}></div>
  <div class="dialog" role="dialog" aria-modal="true" aria-label={tr("newproject.title")} tabindex="-1" onkeydown={(e) => { e.stopPropagation(); if (e.key === "Escape") ui.newProject = false; }}>
  <form onsubmit={create}>
    <h2 class="page-title">{tr("newproject.title")}</h2>
    <input class="input" placeholder={tr("newproject.name_placeholder")} bind:value={name} use:focusEl aria-label={tr("newproject.name_label")} />
    <fieldset>
      <legend class="label">{tr("newproject.colour")}</legend>
      {#each PALETTE as c}
        <label class="sw" style={hueVars(c)} title={c}>
          <input type="radio" name="color" value={c} bind:group={color} class="sr" /><span></span>
        </label>
      {/each}
    </fieldset>
    {#if name.trim()}<p class="meta">{tr("newproject.shown_as_before")} <span class="code" style={hueVars(color as any)}>{projectCode(name)}</span> {tr("newproject.shown_as_after")}</p>{/if}
    <p class="meta">{tr("newproject.tip")}</p>
    <div class="row"><button type="button" class="btn ghost tpl" onclick={() => (ui.newProject = "chat")}>{tr("newproject.with_assistant")}</button><button type="button" class="btn ghost" onclick={() => (ui.newProject = false)}>{tr("newproject.cancel")}</button><button class="btn primary" disabled={!name.trim() || busy}>{tr("newproject.create")}</button></div>
  </form>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; background: rgb(0 0 0 / .18); z-index: 40; }
  .dialog { position: fixed; top: 14vh; left: 50%; transform: translateX(-50%); width: min(440px, 92vw); z-index: 41; background: var(--surface-raised); border-radius: var(--r-lg); box-shadow: var(--shadow-float), 0 0 0 1px var(--border); padding: 20px 24px; }
  form { display: grid; gap: 14px; }
  .input { padding: 8px 10px; font-size: 14px; }
  fieldset { border: 0; padding: 0; margin: 0; display: flex; gap: 8px; align-items: center; }
  legend { margin-bottom: 6px; }
  .sw span { display: block; width: 24px; height: 24px; border-radius: 50%; background: var(--h-solid); cursor: pointer; }
  .sw input:checked + span { box-shadow: 0 0 0 2px var(--surface-raised), 0 0 0 4px var(--h-solid); }
  .sw input:focus-visible + span { outline: 2px solid var(--focus); outline-offset: 4px; }
  p { margin: 0; }
  .row { display: flex; justify-content: flex-end; gap: 8px; }
  .tpl { margin-right: auto; color: var(--accent); }
</style>
