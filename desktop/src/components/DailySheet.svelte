<script lang="ts">
  import { tr } from "../lib/wording";
  import { store } from "../lib/store.svelte";
  import { ui } from "../lib/ui.svelte";
  import { addDays, shortDate, today } from "../lib/dates";
  import { mondayOf, isPaused, parsePauses, type DayState } from "../lib/habits";
  import { ACCENTS, ACCENT_LABEL, accentVar } from "../lib/accents";

  /** One daily's history (12 weeks), streaks and settings. Opened from the Dailies view (ui.daily). */
  let d = $derived(ui.daily ? store.dailies[ui.daily] : undefined);
  let day = $derived(today());
  let s = $derived(d ? store.dailyStats(d, day) : null);
  let name = $state("");
  $effect(() => { if (d) name = d.title; });

  const WD = tr("dates.weekdays").split(" ");
  /** Columns are weeks (oldest first), rows Mon..Sun; the last column is this week. */
  let weeks = $derived(Array.from({ length: 12 }, (_, w) => addDays(mondayOf(day), (w - 11) * 7)));
  let paused = $derived(d ? isPaused(parsePauses(d.pauses)) : false);
  let pausedSince = $derived(d ? parsePauses(d.pauses).find(([, to]) => to === null)?.[0] : undefined);

  function close() { if (d && name.trim() && name.trim() !== d.title) void store.renameDaily(d.id, name.trim()); ui.daily = null; }
  function toggleDay(i: number) {
    if (!d) return;
    const days = [...(d.days ?? "1111111")];
    days[i] = days[i] === "1" ? "0" : "1";
    if (days.includes("1")) void store.updateDaily(d.id, { days: days.join(""), per_week: null });
  }
  function setMode(perWeek: boolean) {
    if (!d) return;
    void store.updateDaily(d.id, perWeek ? { per_week: d.per_week ?? 3 } : { per_week: null });
  }
  const STATE_KEY: Record<DayState, string> = {
    done: "dailies.state_done", rest: "dailies.state_rest", off: "dailies.state_off", missed: "dailies.state_missed",
    open: "dailies.state_open", paused: "dailies.state_paused", before: "dailies.state_before", future: "dailies.state_before",
  };
  const stateLabel = (st: DayState) => tr(STATE_KEY[st]);
</script>

{#if d && s}
  <div class="scrim" role="presentation" onclick={close}></div>
  <div class="dialog" role="dialog" aria-modal="true" aria-label={d.title} tabindex="-1" style="--h-solid: {accentVar(d.color)}"
    onkeydown={(e) => { e.stopPropagation(); if (e.key === "Escape") close(); }}>
    <input class="name" aria-label={tr("dailies.rename")} bind:value={name}
      onkeydown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      onblur={() => { if (name.trim() && name.trim() !== d.title) void store.renameDaily(d.id, name.trim()); }} />
    {#if paused && pausedSince}<p class="meta">{tr("dailies.paused_since", { date: shortDate(pausedSince) })}</p>{/if}

    <div class="stats">
      <div><b>{s.streak}</b><span>{tr(s.unit === "days" ? "dailies.stat_streak_days" : "dailies.stat_streak_weeks")}</span></div>
      <div><b>{Math.max(s.best, s.streak)}</b><span>{tr("dailies.stat_best")}</span></div>
      <div><b>{Math.round(s.rate * 100)}%</b><span>{tr("dailies.stat_rate")}</span></div>
    </div>

    <div class="grid" role="grid" aria-label={tr("dailies.history")}>
      {#each WD as wd, r}
        <span class="dl" aria-hidden="true">{r % 2 === 0 ? wd.slice(0, 1) : ""}</span>
        {#each weeks as w}
          {@const date = addDays(w, r)}
          {@const st = s.state(date)}
          {#if st === "future"}<span class="cell future"></span>
          {:else}
            <button class="cell {st}" class:today={date === day} aria-pressed={st === "done"}
              aria-label={tr("dailies.cell", { date: shortDate(date), state: stateLabel(st) })}
              title={tr("dailies.cell", { date: shortDate(date), state: stateLabel(st) })}
              onclick={() => store.toggleDaily(d.id, date)}></button>
          {/if}
        {/each}
      {/each}
    </div>
    <div class="legend">
      <span><i class="done"></i>{tr("dailies.state_done")}</span><span><i class="rest"></i>{tr("dailies.state_rest")}</span>
      <span><i class="off"></i>{tr("dailies.state_off")}</span><span><i class="missed"></i>{tr("dailies.state_missed")}</span>
    </div>
    <p class="hint">{tr("dailies.backfill_hint")}</p>

    <div class="sched">
      <div class="seg" role="radiogroup" aria-label={tr("dailies.schedule")}>
        <button role="radio" aria-checked={!d.per_week} class:on={!d.per_week} onclick={() => setMode(false)}>{tr("dailies.mode_days")}</button>
        <button role="radio" aria-checked={!!d.per_week} class:on={!!d.per_week} onclick={() => setMode(true)}>{tr("dailies.mode_week")}</button>
      </div>
      {#if d.per_week}
        <label class="pw">
          <select class="input" value={d.per_week} onchange={(e) => store.updateDaily(d.id, { per_week: Number((e.target as HTMLSelectElement).value) })}>
            {#each [1, 2, 3, 4, 5, 6] as n}<option value={n}>{n}</option>{/each}
          </select>
          {tr("dailies.times_a_week")}
        </label>
      {:else}
        <div class="chips">
          {#each WD as wd, i}
            <button class="chip" class:on={(d.days ?? "1111111")[i] === "1"} aria-pressed={(d.days ?? "1111111")[i] === "1"} onclick={() => toggleDay(i)}>{wd}</button>
          {/each}
        </div>
      {/if}
    </div>

    <div class="colors" role="radiogroup" aria-label={tr("dailies.color")}>
      <span class="lbl">{tr("dailies.color")}</span>
      <button class="sw theme" role="radio" aria-checked={!d.color} class:on={!d.color} title={tr("dailies.color_theme")} aria-label={tr("dailies.color_theme")}
        onclick={() => store.updateDaily(d.id, { color: null })}></button>
      {#each ACCENTS as a}
        <button class="sw" role="radio" aria-checked={d.color === a} class:on={d.color === a} style="background: var(--acc-{a})"
          title={tr(ACCENT_LABEL[a])} aria-label={tr(ACCENT_LABEL[a])} onclick={() => store.updateDaily(d.id, { color: a })}></button>
      {/each}
    </div>

    <div class="acts">
      <button class="btn" onclick={() => store.moveDaily(d.id, -1)} aria-label={tr("dailies.move_up")} title={tr("dailies.move_up")}>↑</button>
      <button class="btn" onclick={() => store.moveDaily(d.id, 1)} aria-label={tr("dailies.move_down")} title={tr("dailies.move_down")}>↓</button>
      <button class="btn" onclick={() => store.setDailyPaused(d.id, !paused)}>{paused ? tr("dailies.resume") : tr("dailies.pause")}</button>
      <button class="btn danger" onclick={() => { const id = d.id; ui.daily = null; void store.deleteDaily(id); }}>{tr("dailies.delete")}</button>
      <span class="sp"></span>
      <button class="btn primary" onclick={close}>{tr("dailies.close")}</button>
    </div>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; background: rgb(0 0 0 / .18); z-index: 70; }
  .dialog { position: fixed; top: 8vh; left: 50%; transform: translateX(-50%); width: min(480px, 94vw); max-height: 84vh; overflow-y: auto; z-index: 71;
    background: var(--surface-raised); border-radius: var(--r-lg); box-shadow: var(--shadow-float), 0 0 0 1px var(--border); padding: 18px 20px; display: grid; gap: 12px; }
  .name { font: 600 20px/1.3 var(--font-ui); border: 0; background: none; color: var(--text); padding: 2px 0; border-bottom: 1px solid transparent; }
  .name:focus { outline: none; border-bottom-color: var(--accent); }
  .meta, .hint { margin: 0; font-size: 12px; color: var(--text-3); }
  .stats { display: flex; gap: 28px; }
  .stats div { display: grid; }
  .stats b { font: 600 22px/1.2 var(--font-ui); font-variant-numeric: tabular-nums; }
  .stats span { font-size: 12px; color: var(--text-3); }
  .grid { display: grid; grid-template-columns: 12px repeat(12, minmax(0, 22px)); gap: 4px; align-items: center; }
  .dl { font-size: 10px; color: var(--text-3); }
  .cell { aspect-ratio: 1; border-radius: 3px; border: 0; padding: 0; background: color-mix(in srgb, var(--border) 45%, transparent); cursor: pointer; }
  .cell:hover { box-shadow: 0 0 0 1px var(--h-solid); }
  .cell.done { background: var(--h-solid); }
  .cell.rest { background: color-mix(in srgb, var(--h-solid) 30%, var(--surface-raised)); }
  .cell.missed { background: var(--border-strong); }
  .cell.off, .cell.paused, .cell.open { background: transparent; box-shadow: inset 0 0 0 1px var(--border); }
  .cell.today { outline: 1.5px solid var(--h-solid); outline-offset: 1px; }
  .cell.future { cursor: default; }
  .legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: 12px; color: var(--text-3); }
  .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; background: var(--border); }
  .legend i.done { background: var(--h-solid); }
  .legend i.rest { background: color-mix(in srgb, var(--h-solid) 30%, var(--surface-raised)); }
  .legend i.missed { background: var(--border-strong); }
  .legend i.off { background: transparent; box-shadow: inset 0 0 0 1px var(--border); }
  .sched { display: grid; gap: 10px; }
  .seg { display: inline-flex; background: var(--surface-sunken); border-radius: var(--r-md); padding: 2px; justify-self: start; }
  .seg button { border: 0; background: none; padding: 5px 12px; border-radius: calc(var(--r-md) - 2px); font-size: 13px; color: var(--text-2); }
  .seg button.on { background: var(--surface); color: var(--text); box-shadow: 0 0 0 1px var(--border); }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .chip { border: 1px solid var(--border); background: var(--surface); border-radius: var(--r-md); padding: 5px 10px; font-size: 13px; color: var(--text-2); }
  .chip.on { background: color-mix(in srgb, var(--h-solid) 14%, var(--surface)); border-color: transparent; color: var(--h-solid); font-weight: 600; }
  .pw { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-2); }
  .pw select { width: auto; }
  .colors { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .colors .lbl { font-size: 13px; color: var(--text-2); margin-right: 4px; }
  .sw { width: 22px; height: 22px; border-radius: 50%; border: 0; padding: 0; cursor: pointer; }
  .sw.theme { background: conic-gradient(var(--acc-blue) 0 25%, var(--acc-teal) 0 50%, var(--acc-ochre) 0 75%, var(--acc-plum) 0); }
  .sw.on { box-shadow: 0 0 0 2px var(--surface-raised), 0 0 0 4px var(--text-2); }
  .acts { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .acts .sp { flex: 1; }
  .danger { color: var(--danger); }
  @media (max-width: 700px) {
    .dialog { top: auto; bottom: 0; left: 0; transform: none; width: 100%; max-height: 92dvh; border-radius: 16px 16px 0 0; padding-bottom: max(18px, env(safe-area-inset-bottom)); }
  }
</style>
