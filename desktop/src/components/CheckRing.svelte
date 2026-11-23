<script lang="ts">
  import { tr } from "../lib/wording";
  import type { Status } from "../lib/types";
  /** The check circle for tasks and dailies. Checking it springs the fill in and throws a small burst of dots
   *  in the row's colour (--h-solid); `big` makes a larger burst with a few gold dots (milestones). */
  let { status, onToggle, title = "", big = false }: { status: Status; onToggle: () => void; title?: string; big?: boolean } = $props();

  let pop = $state(false);
  let bursts = $state<Array<{ id: number; dots: Array<{ x: number; y: number; gold: boolean }> }>>([]);
  let seq = 0;

  function burst(large: boolean) {
    const n = large ? 16 : 8;
    const dots = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const r = (large ? 30 : 18) + Math.random() * (large ? 16 : 8);
      return { x: Math.cos(a) * r, y: Math.sin(a) * r, gold: large && i % 3 === 0 };
    });
    const id = ++seq;
    bursts = [...bursts, { id, dots }];
    setTimeout(() => (bursts = bursts.filter((b) => b.id !== id)), 700);
  }

  function click(e: MouseEvent) {
    e.stopPropagation();
    const checking = status !== "done";
    onToggle();
    if (checking) {
      pop = false;
      requestAnimationFrame(() => (pop = true));
      // `big` is decided by the parent after the toggle (a milestone), so read it a moment later.
      setTimeout(() => burst(big), 90);
    }
  }
</script>

<button class="ring" class:done={status === "done"} class:pop onclick={click} onanimationend={() => (pop = false)}
  aria-label={status === "done" ? tr("checkring.mark_not_done", { title }) : tr("checkring.mark_done", { title })} aria-pressed={status === "done"}>
  <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
    {#if status === "done"}
      <circle cx="9" cy="9" r="8" fill="var(--h-solid)" />
      <path class="tick" d="M5.5 9.2l2.3 2.3 4.7-4.9" fill="none" stroke="var(--surface)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
    {:else if status === "doing"}
      <circle cx="9" cy="9" r="7.25" fill="none" stroke="var(--accent)" stroke-width="1.5" />
      <path d="M9 1.75a7.25 7.25 0 0 1 0 14.5z" fill="var(--accent)" />
    {:else if status === "cancelled"}
      <circle cx="9" cy="9" r="7.25" fill="none" stroke="var(--text-3)" stroke-width="1.5" stroke-dasharray="3 2" />
      <path d="M4 14L14 4" stroke="var(--text-3)" stroke-width="1.5" />
    {:else}
      <circle cx="9" cy="9" r="7.25" fill="none" stroke="var(--text-3)" stroke-width="1.5" />
    {/if}
  </svg>
  {#each bursts as b (b.id)}
    {#each b.dots as d}<span class="dot" class:gold={d.gold} style="--x:{d.x}px; --y:{d.y}px" aria-hidden="true"></span>{/each}
  {/each}
</button>

<style>
  .ring { position: relative; border: 0; background: none; padding: 3px; margin: -3px; border-radius: 50%; display: grid; place-items: center; flex: none; }
  .ring:hover circle { stroke: var(--h-solid); }
  .ring svg { transition: transform var(--dur-fast) var(--spring-fast); }
  .ring:active svg { transform: scale(.85); }
  .pop svg { animation: pop .42s cubic-bezier(.3, 1.6, .5, 1); }
  .pop .tick { stroke-dasharray: 12; animation: draw .22s ease-out .12s both; }
  @keyframes pop { 0% { transform: scale(.6); } 60% { transform: scale(1.12); } 100% { transform: scale(1); } }
  @keyframes draw { from { stroke-dashoffset: 12; } to { stroke-dashoffset: 0; } }
  .dot { position: absolute; left: 50%; top: 50%; width: 5px; height: 5px; margin: -2.5px; border-radius: 50%; background: var(--h-solid, var(--accent));
    pointer-events: none; animation: fly .55s cubic-bezier(.1, .7, .3, 1) forwards; }
  .dot.gold { background: var(--gold, #B7791F); }
  @keyframes fly { to { transform: translate(var(--x), var(--y)) scale(.2); opacity: 0; } }
  @media (prefers-reduced-motion: reduce) {
    .dot { display: none; }
    .pop svg, .pop .tick { animation: none; }
  }
</style>
