<script lang="ts">
  import { untrack } from "svelte";
  import { ui } from "../lib/ui.svelte";
  /** A short, quiet celebration when ui.celebrate() is called (Today cleared, every daily due today done):
   *  about two dozen small dots and petals in shades of the theme colour drift down from the top third and
   *  fade out within ~1.4 s. Off when the system asks for reduced motion. */
  let pieces = $state<Array<{ id: number; left: number; top: number; dx: number; dy: number; r: number; delay: number; shade: number; petal: boolean; gold: boolean }>>([]);
  let seq = 0;

  $effect(() => {
    if (!ui.celebrations) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const batch = Array.from({ length: 26 }, (_, i) => ({
      id: ++seq,
      left: 20 + Math.random() * 60,         // keep to the middle of the window
      top: -2 + Math.random() * 10,
      dx: Math.random() * 80 - 40,
      dy: 120 + Math.random() * 160,
      r: Math.random() * 240 - 120,
      delay: Math.random() * 0.25,
      shade: [1, 0.65, 0.4][i % 3],
      petal: i % 2 === 0,
      gold: i % 9 === 0,
    }));
    // untrack: reading `pieces` here would make this effect depend on what it writes, and it would rerun forever
    // (the tab froze when the last daily was checked).
    pieces = [...untrack(() => pieces), ...batch];
    const ids = new Set(batch.map((p) => p.id));
    setTimeout(() => (pieces = pieces.filter((p) => !ids.has(p.id))), 1900);
  });
</script>

<div class="confetti" aria-hidden="true">
  {#each pieces as p (p.id)}
    <i class:petal={p.petal}
      style="left:{p.left}%; top:{p.top}%; background:{p.gold ? 'var(--gold)' : 'var(--accent)'}; --o:{p.shade}; --dx:{p.dx}px; --dy:{p.dy}px; --r:{p.r}deg; animation-delay:{p.delay}s"></i>
  {/each}
</div>

<style>
  .confetti { position: fixed; inset: 0; pointer-events: none; overflow: hidden; z-index: 60; }
  i { position: absolute; width: 6px; height: 6px; border-radius: 50%; opacity: 0; animation: drift 1.4s cubic-bezier(.2, .7, .3, 1) forwards; }
  i.petal { width: 5px; height: 9px; border-radius: 3px; }
  @keyframes drift {
    0% { opacity: 0; transform: translate(0, -8px) rotate(0) scale(.6); }
    15% { opacity: var(--o); transform: translate(calc(var(--dx) * .15), 0) rotate(calc(var(--r) * .15)) scale(1); }
    70% { opacity: var(--o); }
    100% { opacity: 0; transform: translate(var(--dx), var(--dy)) rotate(var(--r)) scale(.9); }
  }
</style>
