<script lang="ts">
  import MathText from "../components/MathText.svelte";
  import { tr } from "../lib/wording";
  import { tick, untrack } from "svelte";
  import { store } from "../lib/store.svelte";
  import { ui, ZOOM_PX } from "../lib/ui.svelte";
  import { addDays, diffDays, fromNum, monthName, shortDate, toNum, today, weekday } from "../lib/dates";
  import { projectList, sectionsOf, subtasksOf, tasksInScope, visible } from "../lib/query";
  import { hueOf, hueVars, projectCode, type Hue } from "../lib/colors";
  import { shiftPatch, withDates, type DragMode } from "../lib/shift";
  import type { Task } from "../lib/types";

  // ---------- geometry ----------
  const GUTTER = 200;
  const HEADER = 44;
  const SUB = 28; // one packed sub-row
  const BAR = 20;
  const PROJECT_ROW = 30;
  const LANE_PAD = 4;

  let ppd = $derived(ZOOM_PX[ui.zoom]);
  let t0 = $derived(today());

  let scoped = $derived(tasksInScope(ui.scope).filter((t) => visible(t, ui.hideOldDone)));
  const dated = (t: Task) => Boolean(t.start_date || t.due_date || t.deadline);

  /** Visible range: a month before today (or the earliest item) to six months after (or the latest), Monday-aligned. */
  let range = $derived.by(() => {
    let lo = addDays(t0, -35), hi = addDays(t0, 200);
    for (const t of scoped) for (const d of [t.start_date, t.due_date, t.deadline]) {
      if (d && d < lo) lo = d;
      if (d && d > hi) hi = d;
    }
    lo = addDays(lo, -14); hi = addDays(hi, 45);
    if (diffDays(hi, lo) > 3 * 366) hi = addDays(lo, 3 * 366);
    lo = addDays(lo, -weekday(lo));
    return { start: lo, days: diffDays(hi, lo) + 1 };
  });
  let width = $derived(range.days * ppd);
  const X = (d: string) => diffDays(d, range.start) * ppd;

  // Label widths, measured once per string with the real font.
  const ctx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
  const widths = new Map<string, number>();
  function textW(s: string): number {
    let w = widths.get(s);
    if (w === undefined) {
      if (ctx) { ctx.font = '500 12px "Inter Variable", Inter, system-ui'; w = ctx.measureText(s).width; } else w = s.length * 6.5;
      widths.set(s, w);
    }
    return w;
  }

  // ---------- layout ----------
  type Shape = "bar" | "dot" | "milestone" | "flag";
  interface Item {
    task: Task; shape: Shape; x0: number; x1: number; flagX: number | null; labelInside: boolean; labelX: number;
    sub: number; y: number; hue: Hue;
  }
  interface Lane { key: string; projectId: string; sectionId: string | null; name: string; y: number; h: number; items: Item[]; undated: number; hue: Hue }
  interface ProjectRow { projectId: string; name: string; y: number; h: number; collapsed: boolean; hue: Hue; summary: { x0: number; x1: number; marks: Array<{ x: number; kind: "milestone" | "flag"; title: string }> } | null }

  function geometry(t: Task): Omit<Item, "sub" | "y" | "hue"> {
    const milestone = t.kind === "milestone";
    const mainDate = t.due_date ?? (milestone ? t.deadline : null);
    let shape: Shape, x0: number, x1: number;
    if (milestone && mainDate) { shape = "milestone"; x0 = X(mainDate) + ppd / 2 - 6; x1 = x0 + 12; }
    else if (t.start_date || t.due_date) {
      const s = t.start_date ?? t.due_date!, e = t.due_date ?? t.start_date!;
      if (s === e && ppd < 40) { shape = "dot"; x0 = X(s) + ppd / 2 - 4; x1 = x0 + 8; }
      else { shape = "bar"; x0 = X(s < e ? s : e); x1 = X(s < e ? e : s) + ppd; }
    } else { shape = "flag"; x0 = X(t.deadline!) + ppd / 2 - 6; x1 = x0 + 12; }
    const flagX = shape !== "flag" && t.deadline && t.deadline !== mainDate ? X(t.deadline) + ppd / 2 : null;
    const lw = textW((t.status === "done" ? "✓ " : "") + t.title);
    const labelInside = shape === "bar" && x1 - x0 >= lw + 14;
    const right = Math.max(x1, flagX !== null ? flagX + 8 : 0);
    return { task: t, shape, x0, x1, flagX, labelInside, labelX: labelInside ? x0 + 7 : right + 6 };
  }

  /** Greedy interval packing: each item goes in the first sub-row where it fits, labels included. */
  function pack(tasks: Task[], hue: Hue): { items: Item[]; rows: number } {
    const geo = tasks.map(geometry).sort((a, b) => a.x0 - b.x0 || a.x1 - b.x1);
    const ends: number[] = [];
    const items: Item[] = [];
    for (const g of geo) {
      const left = Math.min(g.x0, g.flagX ?? Infinity);
      const right = g.labelInside ? Math.max(g.x1, (g.flagX ?? 0) + 8) : g.labelX + textW(g.task.title) + 12;
      let sub = ends.findIndex((e) => e <= left - 4);
      if (sub < 0) { sub = ends.length; ends.push(0); }
      ends[sub] = right;
      items.push({ ...g, sub, y: 0, hue });
    }
    return { items, rows: Math.max(1, ends.length) };
  }

  let layout = $derived.by(() => {
    const single = ui.scope.startsWith("p:");
    const projects: ProjectRow[] = [];
    const lanes: Lane[] = [];
    let y = 0;
    for (const p of projectList()) {
      const mine = scoped.filter((t) => t.project_id === p.id);
      if (single ? `p:${p.id}` !== ui.scope : !mine.some(dated)) continue;
      const hue = hueOf(p.id, p.color);
      const collapsed = !single && Boolean(ui.collapsed[p.id]);
      const datedMine = mine.filter(dated);
      let summary: ProjectRow["summary"] = null;
      if (datedMine.length) {
        const g = datedMine.map(geometry);
        summary = {
          x0: Math.min(...g.map((i) => i.x0)), x1: Math.max(...g.map((i) => i.x1)),
          marks: [
            ...g.filter((i) => i.shape === "milestone").map((i) => ({ x: i.x0 + 6, kind: "milestone" as const, title: i.task.title })),
            ...g.filter((i) => i.flagX !== null || i.shape === "flag").map((i) => ({ x: i.flagX ?? i.x0 + 6, kind: "flag" as const, title: `Deadline: ${i.task.title}` })),
          ],
        };
      }
      if (!single) { projects.push({ projectId: p.id, name: p.name, y, h: PROJECT_ROW, collapsed, hue, summary }); y += PROJECT_ROW; }
      if (collapsed) continue;
      const secs = sectionsOf(p.id);
      const groups: Array<[string | null, string]> = [[null, secs.length ? tr("timeline.no_section") : single ? tr("timeline.tasks") : tr("timeline.tasks")], ...secs.map((s) => [s.id, s.name] as [string, string])];
      for (const [sid, name] of groups) {
        const inLane = mine.filter((t) => (sid ? t.section_id === sid : !t.section_id || !store.sections[t.section_id]));
        if (sid === null && !inLane.length && secs.length) continue;
        const { items, rows } = pack(inLane.filter(dated), hue);
        const h = rows * SUB + LANE_PAD * 2;
        for (const it of items) it.y = y + LANE_PAD + it.sub * SUB + (SUB - BAR) / 2;
        lanes.push({ key: `${p.id}/${sid ?? "-"}`, projectId: p.id, sectionId: sid, name, y, h, items, undated: inLane.filter((t) => !dated(t)).length, hue });
        y += h;
      }
    }
    return { projects, lanes, height: Math.max(y, 200) };
  });

  let itemsById = $derived(new Map(layout.lanes.flatMap((l) => l.items.map((i) => [i.task.id, i] as const))));
  $effect(() => {
    ui.order = layout.lanes.flatMap((l) => [...l.items].sort((a, b) => a.sub - b.sub || a.x0 - b.x0).map((i) => i.task.id));
  });

  // ---------- scale ----------
  let months = $derived.by(() => {
    const out: Array<{ x: number; label: string }> = [];
    let d = range.start.slice(0, 8) + "01";
    const end = addDays(range.start, range.days);
    while (d < end) {
      out.push({ x: Math.max(0, X(d)), label: `${monthName(d)} ${d.slice(0, 4)}` });
      const [yy, mm] = d.split("-").map(Number);
      d = mm === 12 ? `${yy + 1}-01-01` : `${yy}-${String(mm + 1).padStart(2, "0")}-01`;
    }
    return out;
  });
  let ticks = $derived.by(() => {
    const out: Array<{ x: number; label: string; strong: boolean }> = [];
    const step = ui.zoom === "week" ? 1 : 7;
    for (let i = 0; i < range.days; i += step) {
      const d = addDays(range.start, i);
      const label = ui.zoom === "week" ? `${tr("timeline.weekday_initials")[weekday(d)]} ${Number(d.slice(8))}` : ui.zoom === "semester" ? "" : ui.zoom === "quarter" && (i / 7) % 2 ? "" : String(Number(d.slice(8)));
      out.push({ x: i * ppd, label, strong: weekday(d) === 0 });
    }
    return out;
  });
  let weekends = $derived(ui.zoom === "week" || ui.zoom === "month"
    ? Array.from({ length: Math.ceil(range.days / 7) }, (_, w) => w * 7 * ppd + 5 * ppd) : []);

  // ---------- scrolling ----------
  let scroller: HTMLDivElement | undefined = $state();
  let scrollX = $state(0);
  function scrollToDate(d: string, frac = 0.3, smooth = false) {
    if (!scroller) return;
    scroller.scrollTo({ left: X(d) - (scroller.clientWidth - GUTTER) * frac, behavior: smooth ? "smooth" : "auto" });
  }
  $effect(() => { ui.scrollToToday; untrack(() => tick().then(() => scrollToDate(t0, 0.3, ui.scrollToToday > 0))); });
  $effect(() => {
    const target = ui.scrollTo;
    if (target) untrack(() => tick().then(() => { scrollToDate(addDays(target.date, -3), 0, true); ui.scrollTo = null; }));
  });
  // Keep the date in the middle of the screen fixed when zooming.
  let lastPpd = 0;
  $effect.pre(() => {
    const next = ppd;
    untrack(() => {
      if (!scroller || !lastPpd || lastPpd === next) { lastPpd = next; return; }
      const mid = (scroller.scrollLeft + (scroller.clientWidth - GUTTER) / 2) / lastPpd;
      lastPpd = next;
      tick().then(() => scroller && (scroller.scrollLeft = mid * next - (scroller.clientWidth - GUTTER) / 2));
    });
  });

  // ---------- drag ----------
  interface Drag { id: string; mode: DragMode; x: number; y: number; days: number; moved: boolean; pointer: number }
  let drag = $state<Drag | null>(null);
  let hover = $state<string | null>(null);

  function preview(t: Task): Task {
    return drag && drag.id === t.id && drag.days ? withDates(t, shiftPatch(t, drag.mode, drag.days)) : t;
  }
  function down(e: PointerEvent, t: Task, mode: DragMode) {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { id: t.id, mode, x: e.clientX, y: e.clientY, days: 0, moved: false, pointer: e.pointerId };
    store.holdRemote = true;
  }
  function move(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointer) return;
    if (!drag.moved && Math.abs(e.clientX - drag.x) < 3) return;
    drag.moved = true;
    drag.days = Math.round((e.clientX - drag.x) / ppd);
    dragPos = { x: e.clientX, y: e.clientY };
  }
  function up(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointer) return;
    const d = drag;
    drag = null;
    const t = store.tasks[d.id];
    if (t && !d.moved) ui.open(t.id);
    else if (t && d.days) store.patchTask(t.id, shiftPatch(t, d.mode, d.days));
    store.releaseRemote();
  }
  function cancelDrag() { if (drag) { drag = null; store.releaseRemote(); } }
  let dragPos = $state({ x: 0, y: 0 });
  let dragLabel = $derived.by(() => {
    if (!drag || !drag.moved) return "";
    const t = store.tasks[drag.id];
    if (!t) return "";
    const p = preview(t);
    const sign = drag.days > 0 ? `+${drag.days}` : `${drag.days}`;
    const span = (x: Task) => drag!.mode === "deadline" ? `⚑ ${shortDate(x.deadline!)}` :
      x.start_date && x.due_date && x.start_date !== x.due_date ? `${shortDate(x.start_date)}–${shortDate(x.due_date)}` : shortDate((x.due_date ?? x.start_date ?? x.deadline)!);
    return `${span(t)} → ${span(p)} (${sign}d)`;
  });

  // ---------- dependency arrows (only for the selected or hovered task) ----------
  let arrows = $derived.by(() => {
    const focus = hover ?? (ui.panel ? ui.selected : null);
    if (!focus) return [];
    const out: Array<{ d: string; bad: boolean }> = [];
    for (const dep of store.deps) {
      if (dep.task_id !== focus && dep.depends_on_id !== focus) continue;
      const live = (i: Item | undefined) => i && drag && drag.id === i.task.id && drag.days ? { ...i, ...geometry(preview(i.task)) } : i;
      const a = live(itemsById.get(dep.depends_on_id)), b = live(itemsById.get(dep.task_id));
      if (!a || !b) continue;
      const x1 = a.x1, y1 = a.y + BAR / 2, x2 = b.x0, y2 = b.y + BAR / 2;
      const bad = x2 < x1 - 1;
      const mx = Math.max(x1 + 8, Math.min(x2 - 8, x1 + 8));
      const r = Math.min(4, Math.abs(y2 - y1) / 2);
      const dir = y2 > y1 ? 1 : -1;
      const d = y1 === y2 ? `M${x1},${y1} H${x2 - 2}` :
        x2 - 8 >= mx ? `M${x1},${y1} H${mx - r} q${r},0 ${r},${r * dir} V${y2 - r * dir} q0,${r * dir} ${r},${r * dir} H${x2 - 2}` :
        `M${x1},${y1} H${x1 + 8} V${(y1 + y2) / 2} H${x2 - 8} V${y2} H${x2 - 2}`;
      out.push({ d, bad });
    }
    return out;
  });

  const progress = (t: Task) => {
    const subs = subtasksOf(t.id);
    return subs.length ? subs.filter((s) => s.status === "done").length / subs.length : 1;
  };
  let todayX = $derived(X(t0) + ppd / 2);
  function toggle(pid: string) { ui.collapsed[pid] = !ui.collapsed[pid]; ui.save(); }
  const late = (t: Task) => t.status !== "done" && ((t.due_date && t.due_date < t0) || (!t.due_date && t.deadline && t.deadline < t0));
</script>

<svelte:window onkeydown={(e) => { if (e.key === "Escape" && drag) { e.stopPropagation(); cancelDrag(); } }} />

<div class="tl" role="region" aria-label={tr("timeline.label")} bind:this={scroller} onscroll={() => (scrollX = scroller?.scrollLeft ?? 0)} onpointermove={move} onpointerup={up} onpointercancel={cancelDrag} class:dragging={drag?.moved}>
  <div class="inner" style="width:{GUTTER + width}px">
    <div class="head" style="height:{HEADER}px">
      <div class="corner" style="width:{GUTTER}px"></div>
      <div class="scale" style="width:{width}px">
        {#each months as m, i}
          {@const next = months[i + 1]?.x ?? width}
          {@const x = Math.max(m.x, Math.min(scrollX, next - textW(m.label) - 14))}
          {#if m.x + textW(m.label) + 14 <= next}<div class="month" class:edge={x > m.x} style="left:{x}px">{m.label}</div>{/if}
        {/each}
        {#each ticks as tk}{#if tk.label && Math.abs(tk.x + (ui.zoom === "week" ? ppd / 2 : 0) - todayX) > 18}<div class="tick" class:strong={tk.strong} style="left:{tk.x}px; width:{ui.zoom === 'week' ? ppd : 7 * ppd}px">{tk.label}</div>{/if}{/each}
        <div class="todaypill" style="left:{todayX}px">{tr("timeline.today")}</div>
      </div>
    </div>

    <div class="body" style="height:{layout.height}px">
    <!-- lane names (sticky left) -->
    <div class="gutter" style="width:{GUTTER}px">
      {#each layout.projects as p (p.projectId)}
        <button class="prow" style="top:{p.y}px; height:{p.h}px; {hueVars(p.hue)}" onclick={() => toggle(p.projectId)} aria-expanded={!p.collapsed}
          class:dim={ui.focus && ui.focus !== p.projectId}>
          <span class="caret">{p.collapsed ? "▸" : "▾"}</span><span class="bar"></span><span class="pname">{p.name}</span>
        </button>
      {/each}
      {#each layout.lanes as l (l.key)}
        <div class="lane-name" style="top:{l.y}px; height:{l.h}px" class:dim={ui.focus && ui.focus !== l.projectId}>
          <span class="lname" title={l.name}>{l.name}</span>
          {#if l.undated}<button class="undated" title={tr(l.undated === 1 ? "timeline.undated_one" : "timeline.undated_other", { n: l.undated })} onclick={() => { ui.go(`p:${l.projectId}`); ui.view = "list"; }}>+{l.undated}</button>{/if}
        </div>
      {/each}
    </div>

    <!-- canvas -->
    <div class="canvas" style="width:{width}px">
      <svg class="bg" width={width} height={layout.height} aria-hidden="true">
        {#each weekends as wx}<rect x={wx} y="0" width={2 * ppd} height={layout.height} class="weekend" />{/each}
        {#each ticks as tk}{#if tk.strong}<line x1={tk.x} x2={tk.x} y1="0" y2={layout.height} class="grid" />{/if}{/each}
        {#each months as m}<line x1={m.x} x2={m.x} y1="0" y2={layout.height} class="grid month-line" />{/each}
        {#each layout.projects as p}<line x1="0" x2={width} y1={p.y} y2={p.y} class="sep" />{/each}
        {#each layout.lanes as l}<line x1="0" x2={width} y1={l.y + l.h} y2={l.y + l.h} class="lane-sep" />{/each}
        <!-- milestone hairlines across the project's lanes -->
        {#each layout.lanes as l}
          {#each l.items.filter((i) => i.shape === "milestone") as m}
            {@const pl = layout.lanes.filter((x) => x.projectId === l.projectId)}
            <line x1={m.x0 + 6} x2={m.x0 + 6} y1={pl[0].y} y2={pl.at(-1)!.y + pl.at(-1)!.h} class="ms-line" style={hueVars(l.hue)} />
          {/each}
        {/each}
        <line x1={todayX} x2={todayX} y1="0" y2={layout.height} class="today" />
      </svg>

      {#each layout.projects as p (p.projectId)}
        {#if p.collapsed && p.summary}
          <div class="summary" style="top:{p.y}px; {hueVars(p.hue)}">
            <div class="span" style="left:{p.summary.x0}px; width:{p.summary.x1 - p.summary.x0}px"></div>
            {#each p.summary.marks as mk}
              <span class="mk {mk.kind}" style="left:{mk.x}px" title={mk.title}>{mk.kind === "milestone" ? "◆" : "⚑"}</span>
            {/each}
          </div>
        {/if}
      {/each}

      {#each layout.lanes as l (l.key)}
        {#each l.items as it (it.task.id)}
          {@const t = preview(it.task)}
          {@const g = t === it.task ? it : { ...it, ...geometry(t) }}
          {@const sel = ui.selected === t.id && ui.panel}
          <div class="item s-{t.status} {g.shape}" class:sel class:fresh={store.fresh[t.id]} class:dim={ui.focus && ui.focus !== l.projectId}
            class:active={drag?.id === t.id} style="top:{it.y}px; {hueVars(it.hue)}"
            onpointerenter={() => (hover = t.id)} onpointerleave={() => hover === t.id && (hover = null)} role="presentation">
            {#if g.shape === "bar"}
              <div class="bar" style="left:{g.x0}px; width:{g.x1 - g.x0}px" onpointerdown={(e) => down(e, it.task, "move")}
                title="{t.title}{t.start_date ? `\n${t.start_date} → ${t.due_date ?? ''}` : t.due_date ? `\n${tr("timeline.due", { date: t.due_date })}` : ''}" role="button" tabindex="-1" aria-label={t.title}>
                {#if t.status === "doing"}<span class="strip" style="width:{progress(t) * 100}%"></span>{/if}
                {#if late(t)}<span class="late" title={tr("timeline.overdue")}></span>{/if}
                <span class="h l" onpointerdown={(e) => down(e, it.task, "start")} role="presentation"></span>
                <span class="h r" onpointerdown={(e) => down(e, it.task, "end")} role="presentation"></span>
                {#if g.labelInside}<span class="in">{t.status === "done" ? "✓ " : ""}<MathText text={t.title} /></span>{/if}
              </div>
            {:else if g.shape === "dot"}
              <div class="dotm" class:late={late(t)} style="left:{g.x0}px" onpointerdown={(e) => down(e, it.task, "move")} title="{t.title}\n{tr('timeline.due', { date: t.due_date ?? t.start_date ?? '' })}" role="button" tabindex="-1" aria-label={t.title}></div>
            {:else if g.shape === "milestone"}
              <div class="diamond" style="left:{g.x0}px" onpointerdown={(e) => down(e, it.task, "move")} title="◆ {t.title}\n{t.due_date ?? t.deadline}" role="button" tabindex="-1" aria-label={tr("timeline.milestone", { title: t.title })}></div>
            {/if}
            {#if g.flagX !== null || g.shape === "flag"}
              {@const fx = g.flagX ?? g.x0 + 6}
              {#if g.flagX !== null && g.flagX > g.x1}<div class="slack" style="left:{g.x1}px; width:{g.flagX - g.x1}px"></div>{/if}
              <div class="flag" class:hot={t.deadline && t.status !== "done" && diffDays(t.deadline, t0) <= 7} style="left:{fx - 5}px"
                onpointerdown={(e) => down(e, it.task, g.shape === "flag" ? "move" : "deadline")} title={tr("timeline.deadline_title", { date: t.deadline ?? "", title: t.title })} role="button" tabindex="-1" aria-label={tr("timeline.deadline", { title: t.title })}>⚑</div>
            {/if}
            {#if !g.labelInside}<span class="out" style="left:{g.labelX}px">{t.status === "done" ? "✓ " : ""}<MathText text={t.title} /></span>{/if}
          </div>
        {/each}
      {/each}

      <svg class="arrows" width={width} height={layout.height} aria-hidden="true">
        <defs><marker id="ah" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="context-stroke" /></marker></defs>
        {#each arrows as a}<path d={a.d} class:bad={a.bad} marker-end="url(#ah)" />{/each}
      </svg>

      {#if !layout.lanes.some((l) => l.items.length) && !layout.projects.some((p) => p.summary)}
        <div class="empty" style="left:{Math.max(0, todayX - 200)}px">
          <p class="page-title">{tr("timeline.empty")}</p>
          <p class="meta">{tr("timeline.empty_hint")} <span class="kbd">Q</span>{tr("timeline.empty_hint_after")}</p>
        </div>
      {/if}
    </div>
    </div>
  </div>
</div>
{#if dragLabel}<div class="draglabel" style="left:{dragPos.x + 14}px; top:{dragPos.y + 14}px">{dragLabel}</div>{/if}

<style>
  .tl { height: 100%; overflow: auto; position: relative; overscroll-behavior: contain; }
  .tl.dragging { cursor: grabbing; user-select: none; }
  .inner { position: relative; min-height: 100%; }
  .head { position: sticky; top: 0; z-index: 5; display: flex; background: var(--bg); border-bottom: 1px solid var(--border); }
  .corner { position: sticky; left: 0; z-index: 6; flex: none; background: var(--bg); border-right: 1px solid var(--border); }
  .scale { position: relative; flex: none; overflow: hidden; }
  .body { display: flex; position: relative; }
  .month { position: absolute; top: 4px; font: 600 12px/16px var(--font-ui); color: var(--text); padding-left: 6px; white-space: nowrap; border-left: 1px solid var(--border-strong); }
  .month.edge { border-left-color: transparent; }
  .tick { position: absolute; top: 24px; font: 500 11px/14px var(--font-ui); color: var(--text-3); padding-left: 3px; white-space: nowrap; overflow: hidden; }
  .tick.strong { color: var(--text-2); }
  .todaypill { position: absolute; top: 24px; transform: translateX(-50%); background: var(--accent); color: var(--on-accent); font: 600 10px/14px var(--font-ui); padding: 0 6px; border-radius: 7px; z-index: 1; }

  .gutter { position: sticky; left: 0; z-index: 4; flex: none; background: var(--bg); border-right: 1px solid var(--border); }
  .prow { position: absolute; left: 0; right: 0; display: flex; align-items: center; gap: 6px; border: 0; background: var(--surface-sunken); padding: 0 8px; font: 600 13px/18px var(--font-ui); text-align: left; border-top: 1px solid var(--border); }
  .prow:hover { background: var(--hover); }
  .caret { width: 10px; color: var(--text-3); font-size: 10px; }
  .prow .bar { width: 3px; height: 14px; border-radius: 2px; background: var(--h-solid); }
  .pname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lane-name { position: absolute; left: 0; right: 0; padding: 8px 8px 0 26px; font-size: 13px; line-height: 20px; color: var(--text-2); display: flex; align-items: flex-start; gap: 6px; }
  .lname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .undated { border: 1px solid var(--border-strong); background: none; padding: 0 5px; border-radius: 8px; font-size: 11px; line-height: 16px; margin-top: 2px; color: var(--text-3); flex: none; }
  .undated:hover { color: var(--accent); text-decoration: underline; }

  .canvas { position: relative; flex: none; height: 100%; }
  svg { position: absolute; left: 0; top: 0; pointer-events: none; }
  .weekend { fill: var(--surface-sunken); opacity: .6; }
  .grid { stroke: var(--border); stroke-width: 1; }
  .month-line { stroke: var(--border-strong); }
  .sep { stroke: var(--border); }
  .lane-sep { stroke: var(--border); stroke-dasharray: 2 3; opacity: .7; }
  .ms-line { stroke: var(--h-solid); stroke-width: 1; opacity: .35; }
  .today { stroke: var(--accent); stroke-width: 1.5; }
  .arrows { z-index: 3; }
  .arrows path { fill: none; stroke: var(--text-2); stroke-width: 1.25; }
  .arrows path.bad { stroke: var(--danger); }

  .summary { position: absolute; left: 0; right: 0; height: 30px; }
  .summary .span { position: absolute; top: 13px; height: 4px; border-radius: 2px; background: var(--h-solid); opacity: .25; }
  .mk { position: absolute; top: 6px; transform: translateX(-50%); font-size: 12px; line-height: 18px; color: var(--h-solid); }
  .mk.flag { color: var(--text-2); }

  .item { position: absolute; left: 0; right: 0; height: 20px; pointer-events: none; }
  .item > * { pointer-events: auto; }
  .item.dim { opacity: .3; }
  .item .bar { position: absolute; top: 0; height: 20px; border-radius: 4px; border: 1.5px solid var(--h-solid); background: var(--surface); cursor: grab; overflow: hidden; display: flex; align-items: center; }
  .s-doing .bar { background: var(--h-tint); }
  .s-done .bar, .s-done .diamond, .s-done .dotm, .s-done .out { opacity: .5; }
  .strip { position: absolute; left: 0; bottom: 0; height: 3px; background: var(--h-solid); }
  .late { position: absolute; right: 0; top: 0; bottom: 0; width: 3px; background: var(--danger); }
  .in { font: 500 12px/16px var(--font-ui); padding-left: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--h-ink); pointer-events: none; }
  .out { position: absolute; top: 2px; font: 500 12px/16px var(--font-ui); color: var(--text); white-space: nowrap; pointer-events: none !important; }
  .h { position: absolute; top: 0; bottom: 0; width: 7px; cursor: ew-resize; z-index: 1; }
  .h.l { left: -1px; } .h.r { right: -1px; }
  .dotm { position: absolute; top: 6px; width: 8px; height: 8px; border-radius: 50%; border: 1.5px solid var(--h-solid); background: var(--surface); cursor: grab; }
  .s-doing .dotm { background: var(--h-tint); }
  .dotm.late { border-color: var(--danger); }
  .diamond { position: absolute; top: 4px; width: 12px; height: 12px; transform: rotate(45deg) scale(.85); background: var(--h-solid); border-radius: 2px; cursor: grab; }
  .flag { position: absolute; top: 1px; font-size: 13px; line-height: 18px; color: var(--text-2); cursor: grab; }
  .flag.hot { color: var(--danger); }
  .slack { position: absolute; top: 9px; height: 0; border-top: 1.5px dotted var(--text-3); pointer-events: none !important; }
  .item.sel .bar, .item.sel .dotm { box-shadow: 0 0 0 2px var(--focus); }
  .item.sel .diamond { outline: 2px solid var(--focus); outline-offset: 1px; }
  .item.active { z-index: 2; }
  .item.fresh .bar { animation: fresh 1.5s var(--ease-effects) both; }

  .empty { position: absolute; top: 60px; width: 400px; text-align: center; }
  .empty p { margin: 6px 0; }
  .draglabel { position: fixed; z-index: 60; background: var(--text); color: var(--bg); font: 500 12px/16px var(--font-ui); padding: 4px 8px; border-radius: 6px; pointer-events: none; white-space: nowrap; }
  .dim { opacity: .3; }
</style>
