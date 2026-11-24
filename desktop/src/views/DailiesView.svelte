<script lang="ts">
  import { tr } from "../lib/wording";
  import { store } from "../lib/store.svelte";
  import { ui } from "../lib/ui.svelte";
  import { addDays, today, weekdayLong } from "../lib/dates";
  import { milestone, type HabitStats } from "../lib/habits";
  import CheckRing from "../components/CheckRing.svelte";
  import DailySheet from "../components/DailySheet.svelte";
  import type { Daily } from "../lib/types";
  import { accentVar } from "../lib/accents";

  /** The Dailies tab: what's due today, the rest, and paused ones. Tap a ring to check today; tap a name for history. */
  let { phone = false }: { phone?: boolean } = $props();

  let day = $derived(today());
  let rows = $derived(store.dailyList.map((d) => ({ d, s: store.dailyStats(d, day) })));
  let paused = $derived(rows.filter((r) => r.s.state(day) === "paused"));
  let active = $derived(rows.filter((r) => r.s.state(day) !== "paused"));
  let due = $derived(active.filter((r) => r.s.dueToday));
  let later = $derived(active.filter((r) => !r.s.dueToday));
  let doneCount = $derived(due.filter((r) => r.s.doneToday).length);
  /** The daily whose check just hit a milestone, so its ring plays the bigger burst. */
  let bigFor = $state<string | null>(null);

  let adding = $state(false);
  let title = $state("");
  function add() {
    const t = title.trim();
    if (t) { void store.createDaily(t); title = ""; } else adding = false;
  }
  function focusEl(el: HTMLInputElement) { el.focus(); }

  /** Celebrations already shown today ("all|date", "dailyId|date|n"), so unchecking and checking again doesn't repeat them. */
  const celebrated = new Set<string>();
  let allDoneTimer: ReturnType<typeof setTimeout> | undefined;
  function toggle(d: Daily) {
    const wasAllDone = due.length > 0 && doneCount === due.length;
    void store.toggleDaily(d.id, day);
    const s = store.dailyStats(d, day);
    const m = milestone(s);
    bigFor = m ? d.id : null;
    if (m && !celebrated.has(`${d.id}|${day}|${m}`)) {
      celebrated.add(`${d.id}|${day}|${m}`);
      store.toast(tr(s.unit === "days" ? "dailies.milestone_days" : "dailies.milestone_weeks", { n: m, title: d.title }));
    }
    const nowDue = store.dailyList.map((x) => store.dailyStats(x, day)).filter((x) => x.dueToday && x.state(day) !== "paused");
    clearTimeout(allDoneTimer);
    if (!wasAllDone && s.doneToday && nowDue.length && nowDue.every((x) => x.doneToday) && !celebrated.has(`all|${day}`)) {
      allDoneTimer = setTimeout(() => {
        // Only if everything is still done (not unchecked again within the delay).
        if (due.length && due.every((r) => r.s.doneToday)) {
          celebrated.add(`all|${day}`);
          ui.celebrate(); store.toast(tr("dailies.all_done", { weekday: weekdayLong(day) }));
        }
      }, 300);
    }
  }

  function schedule(d: Daily, s: HabitStats): string {
    if (d.per_week) {
      const left = Math.max(0, d.per_week - s.weekDone);
      return left ? tr("dailies.per_week_left", { n: d.per_week, left }) : tr("dailies.week_done");
    }
    const days = d.days ?? "1111111";
    if (days === "1111111") return tr("dailies.every_day");
    if (days === "1111100") return tr("dailies.weekdays");
    const names = tr("dates.weekdays").split(" ");
    return [...days].map((c, i) => (c === "1" ? names[i] : "")).filter(Boolean).join(", ");
  }
  /** Last 7 days, oldest first, for the small strip under each name. */
  const strip = (s: HabitStats) => Array.from({ length: 7 }, (_, i) => s.state(addDays(day, i - 6)));
  const streakLabel = (s: HabitStats) => tr(s.unit === "days" ? "dailies.streak_days" : "dailies.streak_weeks", { n: s.streak });
</script>

{#snippet row(r: { d: Daily; s: HabitStats }, checkable: boolean)}
  <div class="row" class:done={r.s.doneToday} style="--h-solid: {accentVar(r.d.color)}">
    {#if checkable}
      <CheckRing status={r.s.doneToday ? "done" : "todo"} title={r.d.title} big={bigFor === r.d.id} onToggle={() => toggle(r.d)} />
    {:else}
      <span class="ring-ph" aria-hidden="true"></span>
    {/if}
    <button class="body" onclick={() => (ui.daily = r.d.id)}>
      <span class="title">{r.d.title}</span>
      <span class="meta">{r.s.state(day) === "paused" ? tr("dailies.paused") : schedule(r.d, r.s)}</span>
      <span class="strip" aria-hidden="true">{#each strip(r.s) as st}<i class={st}></i>{/each}</span>
    </button>
    {#if r.s.streak > 0}
      {#key r.s.streak}
        <span class="streak" title={streakLabel(r.s)} aria-label={streakLabel(r.s)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1c.5 2.6 3.8 3.8 3.8 7.6A3.8 3.8 0 0 1 8 12.4a3.8 3.8 0 0 1-3.8-3.8c0-1.6.8-2.7 1.6-3.4 0 1.2.6 2 1.4 2.2C7 5.6 7.2 3 8 1z" /></svg>{r.s.streak}
        </span>
      {/key}
    {/if}
  </div>
{/snippet}

<div class="dailies" class:phone>
  {#if !phone}<h1 class="page-title">{tr("dailies.title")}</h1>{/if}
  {#if rows.length}
    <div class="summary">
      <span>{tr("dailies.summary", { done: doneCount, n: due.length })}</span>
      <span class="bar" aria-hidden="true"><i style="width:{due.length ? (doneCount / due.length) * 100 : 0}%"></i></span>
    </div>
  {/if}

  <h3 class="sec"><span>{tr("dailies.section_today")}</span><span class="n">{doneCount}/{due.length}</span></h3>
  <div class="card">
    {#each due as r (r.d.id)}{@render row(r, true)}{/each}
    {#if adding}
      <form class="addrow" onsubmit={(e) => { e.preventDefault(); add(); }}>
        <input class="input" placeholder={tr("dailies.placeholder")} bind:value={title} use:focusEl
          onkeydown={(e) => { e.stopPropagation(); if (e.key === "Escape") adding = false; }} onblur={() => !title && (adding = false)} />
      </form>
    {:else}
      <button class="addbtn" onclick={() => { adding = true; title = ""; }}>{tr("dailies.add")}</button>
    {/if}
  </div>
  {#if !rows.length}<p class="empty">{tr("dailies.empty_hint")}</p>{/if}

  {#if later.length}
    <h3 class="sec"><span>{tr("dailies.section_later")}</span><span class="n">{later.length}</span></h3>
    <div class="card">{#each later as r (r.d.id)}{@render row(r, true)}{/each}</div>
  {/if}
  {#if paused.length}
    <h3 class="sec"><span>{tr("dailies.section_paused")}</span><span class="n">{paused.length}</span></h3>
    <div class="card paused">{#each paused as r (r.d.id)}{@render row(r, false)}{/each}</div>
  {/if}
</div>

<DailySheet />

<style>
  .dailies { padding: 16px 24px 120px; max-width: 720px; overflow-y: auto; height: 100%; }
  .page-title { margin: 0 0 8px; }
  .summary { display: flex; align-items: center; gap: 12px; color: var(--text-3); font-size: 13px; font-variant-numeric: tabular-nums; margin-bottom: 4px; }
  .bar { flex: 1; max-width: 240px; height: 4px; border-radius: 2px; background: var(--border); overflow: hidden; }
  .bar i { display: block; height: 100%; background: var(--accent); transition: width .5s cubic-bezier(.2, .9, .3, 1.2); }
  .sec { display: flex; justify-content: space-between; font: 600 12px/16px var(--font-ui); letter-spacing: .06em; text-transform: uppercase; color: var(--text-3); padding: 0 4px; margin: 20px 0 8px; }
  .sec .n { letter-spacing: 0; font-weight: 500; font-variant-numeric: tabular-nums; }
  .card { background: var(--surface); border-radius: var(--r-lg); box-shadow: 0 0 0 1px var(--border); }
  .card > :global(* + *) { border-top: 1px solid var(--border); }
  .row { display: flex; align-items: center; gap: 12px; padding: 10px 14px; }
  .paused .row { opacity: .6; }
  .ring-ph { width: 18px; flex: none; }
  .body { flex: 1; min-width: 0; display: grid; gap: 1px; border: 0; background: none; padding: 0; text-align: left; cursor: pointer; }
  .title { font-size: 15px; line-height: 21px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; transition: color .3s; }
  .done .title { color: var(--text-3); }
  .meta { font-size: 12px; color: var(--text-3); }
  .strip { display: flex; gap: 3px; margin-top: 3px; }
  .strip i { width: 8px; height: 8px; border-radius: 2px; background: var(--border); }
  .strip i:global(.done) { background: var(--h-solid); }
  .strip i:global(.rest) { background: var(--text-3); opacity: .35; }
  .strip i:global(.off), .strip i:global(.paused), .strip i:global(.before), .strip i:global(.open) { background: transparent; box-shadow: inset 0 0 0 1px var(--border); }
  .streak { display: flex; align-items: center; gap: 3px; font-size: 13px; font-weight: 600; color: var(--text-2); font-variant-numeric: tabular-nums; animation: bump .45s cubic-bezier(.3, 1.8, .5, 1); }
  .streak svg { width: 13px; height: 13px; fill: var(--text-3); }
  .done .streak svg { fill: var(--h-solid); }
  @keyframes bump { 40% { transform: scale(1.25); } }
  .addbtn { border: 0; background: none; color: var(--text-3); font-size: 13px; padding: 10px 14px 10px 44px; width: 100%; text-align: left; border-radius: 0 0 var(--r-lg) var(--r-lg); }
  .addbtn:hover { color: var(--accent); }
  .addrow { padding: 6px 14px 6px 44px; }
  .addrow input { width: 100%; }
  .empty { color: var(--text-3); font-size: 13px; margin: 12px 4px; max-width: 52ch; }
  .phone { padding: 4px 16px 120px; }
  .phone .row { padding: 12px 16px; }
  .phone .title { font-size: 16px; }
  @media (prefers-reduced-motion: reduce) { .streak { animation: none; } .bar i { transition: none; } }
</style>
