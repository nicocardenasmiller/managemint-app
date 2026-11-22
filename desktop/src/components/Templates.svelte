<script lang="ts">
  import { tr } from "../lib/wording";
  import { store } from "../lib/store.svelte";
  import { ui } from "../lib/ui.svelte";
  import { PALETTE, hueVars } from "../lib/colors";
  import { addDays, label, shortDate, today, weekdayName } from "../lib/dates";
  import { sectionsOf } from "../lib/query";
  import { defaultAnchor, fromProject, importBody, plan, type Template, type TemplateBody } from "../lib/templates";

  let mode = $derived(ui.templates === "use" ? "use" : ui.templates ? "save" : null);
  let saveProjectId = $derived(ui.templates && typeof ui.templates === "object" ? ui.templates.save : null);

  // ---------- use a template ----------
  let chosen = $state<Template | null>(null);
  let body = $derived(chosen ? (JSON.parse(chosen.body_json) as TemplateBody) : null);
  let name = $state("");
  let color = $state<string>(PALETTE[3]);
  let anchor = $state(addDays(today(), 90));
  let roll = $state(true);
  let busy = $state(false);
  let error = $state("");
  let planned = $derived(body ? plan(body, anchor, roll) : []);
  let weekendCount = $derived(body ? plan(body, anchor, false).filter((t) => t.weekend).length : 0);

  $effect(() => {
    if (mode === "use") { chosen = null; error = ""; store.loadTemplates(); }
  });

  async function create() {
    if (!body || !name.trim()) return;
    busy = true; error = "";
    try {
      const p = await store.importProject(importBody(body, planned, { name: name.trim(), color }));
      ui.templates = null;
      ui.go(`p:${p.id}`); ui.view = "timeline";
      const first = planned.map((t) => t.start_date ?? t.due_date ?? t.deadline_date).filter(Boolean).sort()[0];
      if (first) ui.scrollTo = { date: first };
      store.toast(tr("templates.created", { name: p.name, n: planned.length }));
    } catch (e: any) { error = tr("templates.create_failed", { error: e?.message ?? tr("templates.offline") }); }
    finally { busy = false; }
  }

  // ---------- save a project as a template ----------
  let sProject = $derived(saveProjectId ? store.projects[saveProjectId] : undefined);
  let sTasks = $derived(saveProjectId ? Object.values(store.tasks).filter((t) => t.project_id === saveProjectId) : []);
  let anchorChoices = $derived(sTasks.filter((t) => t.status !== "cancelled" && (t.due_date || t.deadline))
    .sort((a, b) => (a.due_date ?? a.deadline)!.localeCompare((b.due_date ?? b.deadline)!)));
  let anchorTask = $state<string>("");
  let tName = $state("");
  $effect(() => {
    if (mode === "save" && sProject) {
      tName = sProject.name;
      anchorTask = defaultAnchor(sTasks)?.id ?? "";
      error = "";
    }
  });
  async function save() {
    const at = store.tasks[anchorTask];
    if (!saveProjectId || !tName.trim()) return;
    const date = at ? (at.due_date ?? at.deadline)! : today();
    busy = true;
    try {
      await store.saveTemplate(tName.trim(), fromProject(sectionsOf(saveProjectId), sTasks, store.deps, date, at?.title ?? tr("templates.anchor_default")));
      ui.templates = null;
    } catch (e: any) { error = tr("templates.save_failed", { error: e?.message ?? tr("templates.offline") }); }
    finally { busy = false; }
  }

  const dateText = (d: string | null) => (d ? `${weekdayName(d)} ${shortDate(d)}${d.slice(0, 4) !== today().slice(0, 4) ? `, ${d.slice(0, 4)}` : ""}` : "");
  const focusEl = (el: HTMLElement) => el.focus();
  function key(e: KeyboardEvent) { e.stopPropagation(); if (e.key === "Escape") ui.templates = null; }
</script>

{#if mode}
  <div class="scrim" role="presentation" onclick={() => (ui.templates = null)}></div>
  <div class="dialog" role="dialog" aria-modal="true" aria-label={tr("templates.label")} tabindex="-1" onkeydown={key}>
    {#if mode === "save" && sProject}
      <h2 class="page-title">{tr("templates.save_title")}</h2>
      <p class="meta">{tr("templates.save_help")} <b>{sProject.name}</b>{tr("templates.save_help_after")}</p>
      <label class="field"><span class="label">{tr("templates.template_name")}</span><input class="input" bind:value={tName} use:focusEl /></label>
      <label class="field"><span class="label">{tr("templates.anchor")}</span>
        <select class="input" bind:value={anchorTask}>
          {#if !anchorChoices.length}<option value="">{tr("templates.no_dated")}</option>{/if}
          {#each anchorChoices as t}<option value={t.id}>{t.kind === "milestone" ? "◆ " : ""}{t.title} · {shortDate((t.due_date ?? t.deadline)!)}</option>{/each}
        </select>
      </label>
      <p class="meta">{tr("templates.anchor_help")}</p>
      {#if error}<p class="danger meta">{error}</p>{/if}
      <div class="row"><button class="btn ghost" onclick={() => (ui.templates = null)}>{tr("templates.cancel")}</button><button class="btn primary" disabled={busy || !tName.trim()} onclick={save}>{tr("templates.save_button")}</button></div>

    {:else if mode === "use" && !chosen}
      <h2 class="page-title">{tr("templates.use_title")}</h2>
      {#if !store.templates.length}
        <p class="meta">{tr("templates.none_yet")}</p>
      {:else}
        <ul class="tlist">
          {#each store.templates as t (t.id)}
            {@const b = JSON.parse(t.body_json) as TemplateBody}
            <li>
              <button class="pick" onclick={() => { chosen = t; name = ""; roll = true; }}>
                <b>{t.name}</b><span class="meta">{tr("templates.summary", { tasks: b.tasks.length, sections: b.sections.length, anchor: b.anchorLabel })}</span>
              </button>
              <button class="btn ghost del" onclick={() => { if (confirm(tr("templates.delete_confirm", { name: t.name }))) store.deleteTemplate(t.id); }}>{tr("templates.delete")}</button>
            </li>
          {/each}
        </ul>
      {/if}
      <div class="row"><button class="btn ghost" onclick={() => (ui.templates = null)}>{tr("templates.close")}</button></div>

    {:else if mode === "use" && chosen && body}
      <h2 class="page-title">{chosen.name}</h2>
      <div class="grid">
        <label class="field"><span class="label">{tr("templates.project_name")}</span><input class="input" bind:value={name} use:focusEl placeholder={tr("templates.name_placeholder")} /></label>
        <label class="field"><span class="label">{tr("templates.anchor_day", { anchor: body.anchorLabel })}</span><input class="input" type="date" bind:value={anchor} /></label>
      </div>
      <fieldset>
        <legend class="label">{tr("templates.colour")}</legend>
        {#each PALETTE as c}<label class="sw" style={hueVars(c)} title={c}><input type="radio" name="tcolor" value={c} bind:group={color} class="sr" /><span></span></label>{/each}
      </fieldset>
      {#if weekendCount}
        <label class="meta check"><input type="checkbox" bind:checked={roll} /> {tr(weekendCount === 1 ? "templates.weekend_one" : "templates.weekend_other", { n: weekendCount })}</label>
      {/if}
      <div class="preview" aria-label={tr("templates.preview")}>
        {#each [{ key: null, name: "" }, ...body.sections] as s}
          {@const rows = planned.filter((t) => t.section === s.key && !t.parent)}
          {#if rows.length}
            {#if s.name}<h3 class="label">{s.name}</h3>{/if}
            {#each rows as t}
              <div class="prow">
                <span class="t">{t.kind === "milestone" ? "◆ " : ""}{t.title}</span>
                <span class="d" class:wk={t.weekend && !roll}>
                  {#if t.start_date && t.due_date && t.start_date !== t.due_date}{dateText(t.start_date)} → {/if}{dateText(t.due_date ?? t.start_date)}
                  {#if t.deadline_date}<span class="dl">⚑ {dateText(t.deadline_date)}</span>{/if}
                </span>
              </div>
            {/each}
          {/if}
        {/each}
      </div>
      {#if planned.some((t) => (t.due_date ?? t.start_date ?? "9") < today())}
        <p class="meta warn">{tr("templates.past", { date: label(planned.map((t) => t.due_date ?? t.start_date ?? "9").sort()[0]), anchor: body.anchorLabel.toLowerCase() })}</p>
      {/if}
      {#if error}<p class="danger meta">{error}</p>{/if}
      <div class="row">
        <button class="btn ghost" onclick={() => (chosen = null)}>{tr("templates.back")}</button>
        <button class="btn primary" disabled={busy || !name.trim()} onclick={create}>{busy ? tr("templates.creating") : tr("templates.create", { n: planned.length })}</button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; background: rgb(0 0 0 / .18); z-index: 40; }
  .dialog { position: fixed; top: 8vh; left: 50%; transform: translateX(-50%); width: min(620px, 92vw); max-height: 84vh; overflow-y: auto; z-index: 41; background: var(--surface-raised); border-radius: var(--r-lg); box-shadow: var(--shadow-float), 0 0 0 1px var(--border); padding: 20px 24px; display: grid; gap: 14px; }
  p { margin: 0; }
  .field { display: grid; gap: 4px; }
  .field .input { padding: 7px 10px; font-size: 14px; }
  .grid { display: grid; grid-template-columns: 1fr 180px; gap: 12px; }
  .row { display: flex; justify-content: flex-end; gap: 8px; }
  .tlist { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  .tlist li { display: flex; align-items: center; gap: 8px; }
  .pick { flex: 1; display: grid; gap: 2px; text-align: left; border: 1px solid var(--border); background: var(--surface); border-radius: var(--r-md); padding: 8px 12px; }
  .pick:hover { border-color: var(--focus); }
  .del { color: var(--text-3); font-size: 12px; }
  fieldset { border: 0; padding: 0; margin: 0; display: flex; gap: 8px; align-items: center; }
  legend { margin-bottom: 6px; }
  .sw span { display: block; width: 22px; height: 22px; border-radius: 50%; background: var(--h-solid); cursor: pointer; }
  .sw input:checked + span { box-shadow: 0 0 0 2px var(--surface-raised), 0 0 0 4px var(--h-solid); }
  .check { display: flex; gap: 6px; align-items: center; }
  .preview { border: 1px solid var(--border); border-radius: var(--r-md); padding: 8px 12px; max-height: 38vh; overflow-y: auto; display: grid; gap: 2px; }
  .preview h3 { margin: 8px 0 2px; }
  .prow { display: flex; gap: 12px; font-size: 13px; line-height: 22px; }
  .t { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .d { color: var(--text-2); white-space: nowrap; }
  .d.wk { color: var(--warning); }
  .dl { margin-left: 8px; }
  .warn { color: var(--warning); }
  .danger { color: var(--danger); }
</style>
