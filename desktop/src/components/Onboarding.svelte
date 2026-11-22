<script lang="ts">
  import { tr } from "../lib/wording";
  // First run (docs/sharing-plan.md §5): welcome → short tour → five questions → the AI drafts the first projects
  // from the PhD templates → the student edits the draft → POST /projects/import. Shown once per browser while the
  // account has no projects of its own; ⌘K → "Set up projects (guided)" opens it again.
  import { api } from "../lib/api";
  import { store } from "../lib/store.svelte";
  import { ui } from "../lib/ui.svelte";
  import { PALETTE, hueVars } from "../lib/colors";
  import { nowLocal, today, weekdayName, TZ } from "../lib/dates";
  import Mic from "./Mic.svelte";

  interface DTask { id: string; title: string; notes: string; kind: "task" | "milestone"; section_id: string | null; due_date: string | null; deadline: string | null; sort: number }
  interface Draft { project: { name: string; color: string; description: string; keywords: string[] }; sections: { id: string; name: string; sort: number }[]; tasks: DTask[]; deps: []; source: "template" }

  const DONE_KEY = "managemint.onboarded";
  const STAGES = tr("onboarding.stages").split(" | ");
  const OTHER = tr("onboarding.other_options").split(" | ");

  let step = $state<"welcome" | "tour" | "questions" | "thinking" | "review" | "done">("welcome");
  let tourIndex = $state(0);
  let stage = $state("");
  let focus = $state("");
  let fixed = $state<{ what: string; date: string }[]>([{ what: "", date: "" }]);
  let other = $state<string[]>([]);
  let semesterEnd = $state("");
  let drafts = $state<Draft[]>([]);
  let keep = $state<boolean[]>([]);
  let error = $state("");
  let busy = $state(false);
  let created = $state<{ id: string; name: string }[]>([]);

  const done = () => { try { return localStorage.getItem(DONE_KEY) === "1"; } catch { return false; } };
  const ownProjects = $derived(Object.values(store.projects).filter((p) => !p.deleted_at && p.id !== "inbox" && p.id !== "personal"));
  // Opens by itself once, on a fresh account; afterwards only from the palette.
  $effect(() => { if (store.loaded && !done() && !ownProjects.length && !ui.onboarding) ui.onboarding = true; });

  function finish() {
    try { localStorage.setItem(DONE_KEY, "1"); } catch { /* private mode */ }
    ui.onboarding = false;
    if (created.length) { ui.go(`p:${created[0].id}`); ui.view = phoneWidth() ? "list" : "timeline"; }
    step = "welcome"; tourIndex = 0; created = []; drafts = []; error = "";
  }
  const phoneWidth = () => typeof matchMedia === "function" && matchMedia("(max-width: 700px)").matches;

  const TOUR = [
    { title: tr("onboarding.tour_capture_title"), text: tr("onboarding.tour_capture") },
    { title: tr("onboarding.tour_projects_title"), text: tr("onboarding.tour_projects") },
    { title: tr("onboarding.tour_timeline_title"), text: tr("onboarding.tour_timeline") },
    { title: tr("onboarding.tour_calendar_title"), text: tr("onboarding.tour_calendar") },
  ];

  const datesText = () => fixed.filter((f) => f.what.trim() || f.date)
    .map((f) => `${f.what.trim() || tr("onboarding.fixed_date")}: ${f.date ? `${f.date} (${weekdayName(f.date)})` : tr("onboarding.date_not_given")}`).join("; ");

  async function propose(e?: Event) {
    e?.preventDefault();
    step = "thinking"; error = "";
    try {
      const r = await api<{ projects: Draft[] }>("POST", "/onboarding/plan", {
        answers: { stage, focus, dates: datesText(), other, semester_end: semesterEnd }, now: nowLocal(), tz: TZ,
      });
      if (!r.projects.length) { error = tr("onboarding.no_project"); step = "questions"; return; }
      drafts = r.projects; keep = r.projects.map(() => true); step = "review";
    } catch (err: any) {
      error = err?.status === 429 ? err.message : err?.message?.includes("no AI key") ? tr("onboarding.no_key")
        : tr("onboarding.draft_failed", { error: err?.message ?? tr("onboarding.offline") });
      step = "questions";
    }
  }

  async function create() {
    busy = true; error = "";
    try {
      created = [];
      for (const [i, d] of drafts.entries()) {
        if (!keep[i]) continue;
        const body = $state.snapshot(d) as Draft;
        body.tasks = body.tasks.filter((t) => t.title.trim());
        const p = await store.importProject(body);
        created.push({ id: p.id, name: p.name });
      }
      step = "done";
    } catch (err: any) {
      error = tr("onboarding.create_failed", { error: err?.message ?? tr("onboarding.offline") });
    } finally { busy = false; }
  }

  const sectionName = (d: Draft, id: string | null) => d.sections.find((s) => s.id === id)?.name ?? "";
  function removeTask(d: Draft, id: string) { d.tasks = d.tasks.filter((t) => t.id !== id); }
  const toggle = (x: string) => (other = other.includes(x) ? other.filter((o) => o !== x) : [...other, x]);
  const canAsk = $derived(Boolean(focus.trim() || fixed.some((f) => f.what.trim() || f.date)));
</script>

{#if ui.onboarding}
  <div class="ob" role="dialog" aria-modal="true" aria-label={tr("onboarding.label")} tabindex="-1" onkeydown={(e) => e.stopPropagation()}>
    <div class="card">
      {#if step === "welcome"}
        <div class="hero">
          <div class="logo"><img src="/app/icon.svg" alt="" width="72" height="72" /><span class="ring"></span></div>
          <h1 class="page-title rise" style="--d:.15s">{tr("onboarding.welcome_title")}</h1>
          <p class="lede rise" style="--d:.3s">{tr("onboarding.lede")}</p>
          <ul class="why rise" style="--d:.45s">
            <li>{tr("onboarding.why_steps")}</li>
            <li>{tr("onboarding.why_deadlines")}</li>
            <li>{tr("onboarding.why_voice")}</li>
          </ul>
          <p class="meta rise" style="--d:.6s">{tr("onboarding.private")}</p>
          <div class="row rise" style="--d:.7s">
            <button class="btn ghost" onclick={finish}>{tr("onboarding.skip")}</button>
            <button class="btn primary" onclick={() => (step = "tour")}>{tr("onboarding.continue")}</button>
          </div>
        </div>
      {:else if step === "tour"}
        {@const t = TOUR[tourIndex]}
        {#key tourIndex}
          <div class="tour rise">
            <p class="meta">{tr("onboarding.tour_count", { n: tourIndex + 1, total: TOUR.length })}</p>
            <h2 class="page-title">{t.title}</h2>
            <p>{t.text}</p>
          </div>
        {/key}
        <div class="dots" aria-label={tr("onboarding.tour_step", { n: tourIndex + 1, total: TOUR.length })}>{#each TOUR as _, i}<span class:on={i === tourIndex}></span>{/each}</div>
        <div class="row">
          <button class="btn ghost" onclick={() => (tourIndex ? tourIndex-- : (step = "welcome"))}>{tr("onboarding.back")}</button>
          {#if tourIndex < TOUR.length - 1}<button class="btn primary" onclick={() => tourIndex++}>{tr("onboarding.next")}</button>
          {:else}<button class="btn primary" onclick={() => (step = "questions")}>{tr("onboarding.set_up")}</button>{/if}
        </div>
      {:else if step === "questions" || step === "thinking"}
        <form onsubmit={propose} class="qs" aria-busy={step === "thinking"}>
          <h2 class="page-title">{tr("onboarding.questions_title")}</h2>
          <p class="meta">{tr("onboarding.questions_intro")}</p>
          <fieldset><legend class="label">{tr("onboarding.q1")}</legend>
            <div class="chips">{#each STAGES as s}<button type="button" class="chip" class:on={stage === s} aria-pressed={stage === s} onclick={() => (stage = stage === s ? "" : s)}>{s}</button>{/each}</div>
          </fieldset>
          <label><span class="label">{tr("onboarding.q2")}</span>
            <span class="with-mic"><textarea class="input" rows="2" bind:value={focus} placeholder={tr("onboarding.q2_placeholder")}></textarea><Mic bind:value={focus} label={tr("onboarding.answer_voice")} /></span></label>
          <fieldset><legend class="label">{tr("onboarding.q3")}</legend>
            <div class="fixed">
              {#each fixed as f, i}
                <div class="frow">
                  <input class="input" bind:value={f.what} placeholder={i === 0 ? tr("onboarding.q3_placeholder_first") : tr("onboarding.q3_placeholder")} aria-label={tr("onboarding.q3_what")} />
                  <Mic bind:value={f.what} label={tr("onboarding.q3_say")} />
                  <input class="input date" type="date" min={today()} bind:value={f.date} aria-label={tr("onboarding.date_label")} />
                  {#if fixed.length > 1}<button type="button" class="btn ghost icon" aria-label={tr("onboarding.remove_date")} onclick={() => (fixed = fixed.filter((_, j) => j !== i))}>×</button>{/if}
                </div>
              {/each}
              <button type="button" class="btn ghost add" onclick={() => (fixed = [...fixed, { what: "", date: "" }])}>{tr("onboarding.add_date")}</button>
            </div>
          </fieldset>
          <fieldset><legend class="label">{tr("onboarding.q4")}</legend>
            <div class="chips">{#each OTHER as o}<button type="button" class="chip" class:on={other.includes(o)} aria-pressed={other.includes(o)} onclick={() => toggle(o)}>{o}</button>{/each}</div>
          </fieldset>
          <label><span class="label">{tr("onboarding.q5")} <span class="meta">{tr("onboarding.optional")}</span></span>
            <input class="input date" type="date" min={today()} bind:value={semesterEnd} /></label>
          <p class="meta">{tr("onboarding.guidelines")} <button type="button" class="link" onclick={() => (ui.guidelines = true)}>{tr("onboarding.guidelines_link")}</button>{tr("onboarding.guidelines_after")}</p>
          {#if error}<p class="danger meta" role="alert">{error}</p>{/if}
          <div class="row">
            <button type="button" class="btn ghost" onclick={() => { finish(); ui.templates = "use"; }}>{tr("onboarding.use_template")}</button>
            <button class="btn primary" disabled={!canAsk || step === "thinking"}>{step === "thinking" ? tr("onboarding.drafting") : tr("onboarding.draft")}</button>
          </div>
          {#if step === "thinking"}<div class="thinking" aria-live="polite"><span></span><span></span><span></span> {tr("onboarding.thinking")}</div>{/if}
        </form>
      {:else if step === "review"}
        <h2 class="page-title">{tr("onboarding.review_title")}</h2>
        <p class="meta">{tr("onboarding.review_intro")}</p>
        <div class="drafts">
          {#each drafts as d, i (i)}
            <section class="draft" class:off={!keep[i]} style={hueVars(d.project.color as any)}>
              <header>
                <input type="checkbox" bind:checked={keep[i]} aria-label={tr("onboarding.include", { name: d.project.name })} />
                <span class="dot"></span>
                <input class="input name" bind:value={d.project.name} aria-label={tr("onboarding.project_name")} />
                <select class="input" bind:value={d.project.color} aria-label={tr("onboarding.colour")}>{#each PALETTE as c}<option value={c}>{c}</option>{/each}</select>
              </header>
              {#if d.project.description}<p class="meta">{d.project.description}</p>{/if}
              <ul>
                {#each d.tasks as t (t.id)}
                  <li>
                    <span class="kind" title={t.kind === "milestone" ? tr("onboarding.milestone") : tr("onboarding.task")}>{t.kind === "milestone" ? "◆" : "○"}</span>
                    <input class="input title" bind:value={t.title} aria-label={tr("onboarding.task")} />
                    {#if sectionName(d, t.section_id)}<span class="sec meta">{sectionName(d, t.section_id)}</span>{/if}
                    {#if t.deadline}
                      <input class="input date dl" type="date" bind:value={t.deadline} aria-label={tr("onboarding.deadline")} title={tr("onboarding.deadline")} />
                    {:else}
                      <input class="input date" type="date" value={t.due_date ?? ""} onchange={(e) => (t.due_date = (e.currentTarget as HTMLInputElement).value || null)} aria-label={tr("onboarding.due_date")} />
                    {/if}
                    <button class="btn ghost icon" aria-label={tr("onboarding.remove_task", { title: t.title })} onclick={() => removeTask(d, t.id)}>×</button>
                  </li>
                {/each}
              </ul>
            </section>
          {/each}
        </div>
        <p class="meta legend"><span class="dl-key"></span> {tr("onboarding.legend")}</p>
        {#if error}<p class="danger meta" role="alert">{error}</p>{/if}
        <div class="row">
          <button class="btn ghost" onclick={() => (step = "questions")}>{tr("onboarding.back_questions")}</button>
          <button class="btn primary" disabled={busy || !keep.some(Boolean)} onclick={create}>{busy ? tr("onboarding.creating") : tr(keep.filter(Boolean).length === 1 ? "onboarding.create_one" : "onboarding.create_other")}</button>
        </div>
      {:else}
        <div class="hero">
          <div class="check rise" aria-hidden="true">✓</div>
          <h2 class="page-title rise" style="--d:.1s">{tr("onboarding.done_title")}</h2>
          <p class="rise" style="--d:.2s">{tr("onboarding.created", { names: created.map((c) => c.name).join(", ") })}</p>
          <ul class="why rise" style="--d:.3s">
            <li>{@html tr("onboarding.laptop", { address: location.origin + "/app/" })}</li>
            <li>{@html tr("onboarding.phone")}</li>
            <li>{@html tr("onboarding.calendar_label")} <button class="link" onclick={() => { finish(); ui.calendarFeed = true; }}>{tr("onboarding.calendar_link")}</button> {tr("onboarding.calendar_after")}</li>
          </ul>
          <div class="row rise" style="--d:.4s"><button class="btn primary" onclick={finish}>{tr("onboarding.open")}</button></div>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .ob { position: fixed; inset: 0; z-index: 60; background: color-mix(in srgb, var(--bg) 92%, transparent); backdrop-filter: blur(6px);
        display: grid; place-items: center; padding: 16px; overflow-y: auto; animation: fade .3s ease both; }
  .card { width: min(620px, 100%); background: var(--surface-raised); border-radius: var(--r-lg); box-shadow: var(--shadow-float), 0 0 0 1px var(--border);
          padding: 28px 32px; display: grid; gap: 16px; max-height: calc(100dvh - 32px); overflow-y: auto; }
  h1, h2 { margin: 0; }
  p { margin: 0; }
  .row { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
  .hero { display: grid; gap: 16px; justify-items: start; }
  .lede { font-size: 15px; line-height: 22px; color: var(--text-2); }
  .why { margin: 0; padding-left: 18px; display: grid; gap: 8px; color: var(--text-2); }
  .why :global(b) { color: var(--text); font-weight: 600; }
  .why :global(code) { font-size: 12px; background: var(--surface-sunken); padding: 1px 4px; border-radius: 3px; word-break: break-all; }

  .logo { position: relative; width: 72px; height: 72px; animation: pop .7s cubic-bezier(.2, 1.4, .4, 1) both; }
  .logo img { position: relative; z-index: 1; border-radius: 18px; }
  .ring { position: absolute; inset: -8px; border-radius: 26px; border: 2px solid var(--accent); opacity: 0; animation: ring 1.6s .4s ease-out both; }
  .rise { animation: rise .5s var(--d, 0s) cubic-bezier(.2, .8, .2, 1) both; }
  .check { width: 56px; height: 56px; border-radius: 50%; display: grid; place-items: center; font-size: 28px; background: var(--accent); color: var(--on-accent); }

  .tour { display: grid; gap: 10px; min-height: 170px; align-content: start; }
  .with-mic { display: flex; gap: 8px; align-items: flex-start; }
  .fixed { display: grid; gap: 6px; justify-items: start; }
  .frow { display: flex; gap: 6px; align-items: center; width: 100%; }
  .frow .input:first-child { flex: 1; min-width: 0; }
  .add { color: var(--accent); padding: 4px 0; }
  .link { border: 0; background: none; padding: 0; color: var(--accent); font: inherit; cursor: pointer; text-decoration: underline; }
  .tour p { font-size: 15px; line-height: 22px; color: var(--text-2); }
  .dots { display: flex; gap: 6px; }
  .dots span { width: 7px; height: 7px; border-radius: 50%; background: var(--border-strong); transition: all .25s; }
  .dots span.on { width: 20px; border-radius: 4px; background: var(--accent); }

  .qs { display: grid; gap: 14px; }
  .qs label, fieldset { display: grid; gap: 6px; border: 0; padding: 0; margin: 0; }
  legend { margin-bottom: 6px; padding: 0; }
  .input { padding: 7px 9px; font-size: 14px; width: 100%; box-sizing: border-box; }
  textarea.input { resize: vertical; font: inherit; }
  .input.date { width: auto; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { border: 1px solid var(--border-strong); background: var(--surface); color: var(--text-2); border-radius: 999px; padding: 5px 11px; font-size: 13px; cursor: pointer; }
  .chip.on { background: var(--accent-tint); border-color: var(--accent); color: var(--text); }
  .thinking { display: flex; align-items: center; gap: 4px; color: var(--text-2); font-size: 13px; }
  .thinking span { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); animation: blink 1.2s infinite both; }
  .thinking span:nth-child(2) { animation-delay: .2s; } .thinking span:nth-child(3) { animation-delay: .4s; margin-right: 6px; }

  .drafts { display: grid; gap: 14px; }
  .draft { border: 1px solid var(--border); border-left: 4px solid var(--h-solid); border-radius: var(--r-md); padding: 10px 12px; display: grid; gap: 8px; transition: opacity .2s; }
  .draft.off { opacity: .45; }
  .draft header { display: flex; align-items: center; gap: 8px; }
  .dot { width: 12px; height: 12px; border-radius: 50%; background: var(--h-solid); flex: none; }
  .name { font-weight: 600; flex: 1; min-width: 0; }
  .draft select { width: auto; }
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
    .ob { padding: 0; place-items: stretch; }
    .card { border-radius: 0; max-height: none; min-height: 100dvh; padding: max(20px, env(safe-area-inset-top)) 16px max(20px, env(safe-area-inset-bottom)); align-content: start; }
    .draft li { flex-wrap: wrap; }
    .title { flex-basis: calc(100% - 50px); }
    .sec { margin-left: 20px; }
    .frow { flex-wrap: wrap; }
    .frow .input:first-child { flex-basis: calc(100% - 40px); }
  }
  @keyframes fade { from { opacity: 0; } }
  @keyframes rise { from { opacity: 0; transform: translateY(10px); } }
  @keyframes pop { from { opacity: 0; transform: scale(.6) rotate(-8deg); } }
  @keyframes ring { 0% { opacity: .6; transform: scale(.9); } 100% { opacity: 0; transform: scale(1.35); } }
  @keyframes blink { 0%, 80%, 100% { opacity: .25; } 40% { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .ob, .logo, .ring, .rise, .thinking span { animation: none !important; } }
</style>
