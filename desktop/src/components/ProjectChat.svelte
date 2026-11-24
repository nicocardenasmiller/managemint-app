<script lang="ts">
  import { untrack } from "svelte";
  import { tr } from "../lib/wording";
  // New project = a short chat with the assistant (POST /projects/chat). It asks a few questions, proposes a draft,
  // takes change requests, and the person creates the (possibly edited) draft with POST /projects/import.
  // Saved templates can seed the chat. "Empty project" opens the plain form (NewProject.svelte).
  import { api } from "../lib/api";
  import { store } from "../lib/store.svelte";
  import { ui } from "../lib/ui.svelte";
  import { PALETTE, hueVars } from "../lib/colors";
  import { nowLocal, today, TZ } from "../lib/dates";
  import type { Template } from "../lib/templates";
  import Mic from "./Mic.svelte";

  interface DTask { id: string; title: string; notes: string; kind: "task" | "milestone"; section_id: string | null; start_date?: string | null; due_date: string | null; deadline: string | null; sort: number }
  interface Draft { project: { name: string; color: string; description: string; keywords: string[] }; sections: { id: string; name: string; sort: number }[]; tasks: DTask[]; deps: []; source: "template" }
  interface Msg { role: "user" | "assistant"; text: string }

  let messages = $state<Msg[]>([]);
  let options = $state<string[]>([]);
  let draft = $state<Draft | null>(null);
  let templateId = $state<string | null>(null);
  let input = $state("");
  let busy = $state(false);
  let creating = $state(false);
  let error = $state("");
  let showTemplates = $state(false);
  let log = $state<HTMLElement>();

  const open = $derived(ui.newProject === "chat");
  $effect(() => { if (open) untrack(reset); });

  function reset() {
    messages = [{ role: "assistant", text: tr("projectchat.opening") }];
    options = []; draft = null; templateId = null; input = ""; error = ""; busy = false; creating = false; showTemplates = false;
    store.loadTemplates();
  }
  const close = () => (ui.newProject = false);

  async function scrollDown() {
    await Promise.resolve();
    requestAnimationFrame(() => log?.scrollTo({ top: log.scrollHeight, behavior: "smooth" }));
  }

  async function send(text: string) {
    text = text.trim();
    if (!text || busy) return;
    messages = [...messages, { role: "user", text }];
    input = ""; options = []; error = "";
    await ask();
  }

  async function ask() {
    busy = true; scrollDown();
    try {
      const r = await api<{ reply: string; options: string[]; draft: Draft | null }>("POST", "/projects/chat", {
        messages: $state.snapshot(messages), draft: draft ? $state.snapshot(draft) : null, template_id: templateId, now: nowLocal(), tz: TZ,
      });
      if (r.draft) draft = r.draft;
      messages = [...messages, { role: "assistant", text: r.reply || (r.draft ? tr("projectchat.draft_ready") : tr("projectchat.no_reply")) }];
      options = r.options ?? [];
    } catch (e: any) {
      error = e?.status === 429 ? e.message : e?.message?.includes("no AI key") ? tr("projectchat.no_key")
        : tr("projectchat.failed", { error: e?.message ?? tr("projectchat.offline") });
    } finally { busy = false; scrollDown(); }
  }

  function useTemplate(t: Template) {
    templateId = t.id; showTemplates = false;
    send(tr("projectchat.start_from", { name: t.name }));
  }

  async function create() {
    if (!draft || !draft.project.name.trim()) return;
    creating = true; error = "";
    try {
      const body = $state.snapshot(draft) as Draft;
      body.project.name = body.project.name.trim();
      body.tasks = body.tasks.filter((t) => t.title.trim());
      const p = await store.importProject(body);
      close();
      ui.go(`p:${p.id}`); ui.view = matchMedia("(max-width: 700px)").matches ? "list" : "timeline";
      const first = body.tasks.map((t) => t.start_date ?? t.due_date ?? t.deadline).filter(Boolean).sort()[0];
      if (first) ui.scrollTo = { date: first };
      store.toast(tr("projectchat.created", { name: p.name, n: body.tasks.length }));
    } catch (e: any) { error = tr("projectchat.create_failed", { error: e?.message ?? tr("projectchat.offline") }); }
    finally { creating = false; }
  }

  const sectionName = (id: string | null) => draft?.sections.find((s) => s.id === id)?.name ?? "";
  const removeTask = (id: string) => { if (draft) draft.tasks = draft.tasks.filter((t) => t.id !== id); };
  function onKey(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === "Escape") close();
  }
  function inputKey(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(input); }
  }
  const focusEl = (el: HTMLElement) => el.focus();
</script>

{#if open}
  <div class="scrim" role="presentation" onclick={close}></div>
  <div class="dialog" role="dialog" aria-modal="true" aria-label={tr("projectchat.title")} tabindex="-1" onkeydown={onKey}>
    <header class="top">
      <h2 class="page-title">{tr("projectchat.title")}</h2>
      <button class="btn ghost" onclick={() => (ui.newProject = "plain")}>{tr("projectchat.empty_project")}</button>
      <button class="btn ghost icon" aria-label={tr("projectchat.close")} onclick={close}>×</button>
    </header>

    <div class="log" bind:this={log} aria-live="polite">
      {#each messages as m, i (i)}
        <p class="bubble {m.role}">{m.text}</p>
      {/each}

      {#if messages.length === 1 && store.templates.length}
        <div class="starts">
          <button class="chip" aria-expanded={showTemplates} onclick={() => (showTemplates = !showTemplates)}>{tr("projectchat.from_template")}</button>
        </div>
        {#if showTemplates}
          <ul class="tpls">
            {#each store.templates as t (t.id)}
              <li><button class="pick" onclick={() => useTemplate(t)}>{t.name}</button></li>
            {/each}
          </ul>
        {/if}
      {/if}

      {#if draft}
        <section class="draft" style={hueVars(draft.project.color as any)} aria-label={tr("projectchat.draft_label")}>
          <header>
            <span class="dot"></span>
            <input class="input name" bind:value={draft.project.name} aria-label={tr("projectchat.project_name")} />
            <select class="input" bind:value={draft.project.color} aria-label={tr("projectchat.colour")}>{#each PALETTE as c}<option value={c}>{c}</option>{/each}</select>
          </header>
          {#if draft.project.description}<p class="meta">{draft.project.description}</p>{/if}
          <ul>
            {#each draft.tasks as t (t.id)}
              <li>
                <span class="kind" title={t.kind === "milestone" ? tr("projectchat.milestone") : tr("projectchat.task")}>{t.kind === "milestone" ? "◆" : "○"}</span>
                <input class="input title" bind:value={t.title} aria-label={tr("projectchat.task")} />
                {#if sectionName(t.section_id)}<span class="sec meta">{sectionName(t.section_id)}</span>{/if}
                {#if t.deadline}
                  <input class="input date dl" type="date" min={today()} bind:value={t.deadline} aria-label={tr("projectchat.deadline")} title={tr("projectchat.deadline")} />
                {:else}
                  <input class="input date" type="date" value={t.due_date ?? ""} onchange={(e) => (t.due_date = (e.currentTarget as HTMLInputElement).value || null)} aria-label={tr("projectchat.due_date")} />
                {/if}
                <button class="btn ghost icon" aria-label={tr("projectchat.remove_task", { title: t.title })} onclick={() => removeTask(t.id)}>×</button>
              </li>
            {/each}
          </ul>
          <p class="meta legend"><span class="dl-key"></span> {tr("projectchat.legend")}</p>
        </section>
      {/if}

      {#if busy}<div class="thinking"><span></span><span></span><span></span> {tr("projectchat.thinking")}</div>{/if}
      {#if error}
        <div class="err" role="alert">
          <p class="danger meta">{error}</p>
          <div class="row">
            {#if messages[messages.length - 1]?.role === "user"}<button class="btn ghost" onclick={ask}>{tr("projectchat.retry")}</button>{/if}
            <button class="btn ghost" onclick={() => (ui.templates = "use", close())}>{tr("projectchat.template_without")}</button>
          </div>
        </div>
      {/if}
    </div>

    {#if options.length && !busy}
      <div class="chips">{#each options as o}<button class="chip" onclick={() => send(o)}>{o}</button>{/each}</div>
    {/if}

    <form class="compose" onsubmit={(e) => { e.preventDefault(); send(input); }}>
      <textarea class="input" rows="2" bind:value={input} onkeydown={inputKey} use:focusEl disabled={creating}
        placeholder={draft ? tr("projectchat.change_placeholder") : tr("projectchat.placeholder")} aria-label={tr("projectchat.answer")}></textarea>
      <Mic bind:value={input} label={tr("projectchat.answer_voice")} />
      <button class="btn" disabled={busy || !input.trim()}>{tr("projectchat.send")}</button>
    </form>
    {#if draft}
      <div class="row end">
        <button class="btn primary" disabled={creating || busy || !draft.project.name.trim() || !draft.tasks.some((t) => t.title.trim())} onclick={create}>
          {creating ? tr("projectchat.creating") : tr("projectchat.create", { n: draft.tasks.filter((t) => t.title.trim()).length })}
        </button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; background: rgb(0 0 0 / .18); z-index: 40; }
  .dialog { position: fixed; top: 6vh; left: 50%; transform: translateX(-50%); width: min(640px, 94vw); max-height: 88vh; z-index: 41;
            background: var(--surface-raised); border-radius: var(--r-lg); box-shadow: var(--shadow-float), 0 0 0 1px var(--border);
            padding: 18px 22px; display: flex; flex-direction: column; gap: 12px; }
  .top { display: flex; align-items: center; gap: 8px; }
  .top h2 { margin: 0 auto 0 0; }
  .log { overflow-y: auto; display: flex; flex-direction: column; gap: 10px; min-height: 120px; padding-right: 2px; }
  .bubble { margin: 0; padding: 8px 12px; border-radius: 14px; max-width: 85%; white-space: pre-wrap; line-height: 20px; animation: rise .25s ease both; }
  .bubble.assistant { background: var(--surface-sunken); align-self: flex-start; border-bottom-left-radius: 4px; }
  .bubble.user { background: var(--accent-tint); align-self: flex-end; border-bottom-right-radius: 4px; }
  .starts { display: flex; gap: 6px; }
  .tpls { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
  .pick { width: 100%; text-align: left; border: 1px solid var(--border); background: var(--surface); border-radius: var(--r-md); padding: 7px 10px; cursor: pointer; color: var(--text); font: inherit; }
  .pick:hover { border-color: var(--accent); }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { border: 1px solid var(--border-strong); background: var(--surface); color: var(--text-2); border-radius: 999px; padding: 5px 11px; font-size: 13px; cursor: pointer; }
  .chip:hover { border-color: var(--accent); color: var(--text); }
  .compose { display: flex; gap: 8px; align-items: flex-end; }
  .compose textarea { flex: 1; resize: none; font: inherit; padding: 7px 9px; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; }
  .end { justify-content: flex-end; }
  .err { display: grid; gap: 6px; }
  p { margin: 0; }
  .thinking { display: flex; align-items: center; gap: 4px; color: var(--text-2); font-size: 13px; }
  .thinking span { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); animation: blink 1.2s infinite both; }
  .thinking span:nth-child(2) { animation-delay: .2s; } .thinking span:nth-child(3) { animation-delay: .4s; margin-right: 6px; }

  .input { padding: 6px 8px; font-size: 14px; box-sizing: border-box; }
  .draft { border: 1px solid var(--border); border-left: 4px solid var(--h-solid); border-radius: var(--r-md); padding: 10px 12px; display: grid; gap: 8px; animation: rise .3s ease both; }
  .draft header { display: flex; align-items: center; gap: 8px; }
  .dot { width: 12px; height: 12px; border-radius: 50%; background: var(--h-solid); flex: none; }
  .name { font-weight: 600; flex: 1; min-width: 0; }
  .draft ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
  .draft li { display: flex; align-items: center; gap: 6px; }
  .kind { width: 14px; text-align: center; color: var(--h-solid); flex: none; }
  .title { flex: 1; min-width: 0; border-color: transparent; background: transparent; }
  .title:hover, .title:focus { border-color: var(--border); background: var(--surface); }
  .sec { white-space: nowrap; }
  .dl { color: var(--danger, #a5492f); border-color: var(--danger, #a5492f); }
  .legend { display: flex; align-items: center; gap: 6px; }
  .dl-key { width: 10px; height: 10px; border: 1.5px solid var(--danger, #a5492f); border-radius: 2px; }
  .icon { padding: 2px 8px; }

  @media (max-width: 700px) {
    .dialog { inset: 0; top: 0; left: 0; transform: none; width: auto; max-height: none; border-radius: 0;
              padding: max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom)); }
    .draft li { flex-wrap: wrap; }
    .title { flex-basis: calc(100% - 50px); }
    .sec { margin-left: 20px; }
  }
  @keyframes rise { from { opacity: 0; transform: translateY(6px); } }
  @keyframes blink { 0%, 80%, 100% { opacity: .25; } 40% { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .bubble, .draft, .thinking span { animation: none !important; } }
</style>
