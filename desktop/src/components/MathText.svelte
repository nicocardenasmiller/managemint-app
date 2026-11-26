<script lang="ts">
  // Shows text with its LaTeX math rendered (see lib/math.ts for what counts as math). KaTeX loads only once
  // some text on screen has math, so the app stays small for people who never use it. Until it has loaded,
  // and if a formula doesn't parse, the raw text shows. `block` renders $$...$$ on its own line (notes);
  // without it, everything stays on one line (rows, bars, cards).
  import { hasMath, splitMath, type Piece } from "../lib/math";
  import { katex, loadKatex } from "../lib/katex.svelte";

  let { text, block = false }: { text: string; block?: boolean } = $props();

  const pieces = $derived(hasMath(text) ? tidy(splitMath(text)) : null);

  // In notes, a display formula is its own block, so the line breaks around it in the raw text would add blank lines.
  function tidy(ps: Piece[]): Piece[] {
    if (!block) return ps;
    return ps.map((p, i) => {
      if (!("text" in p)) return p;
      let t = p.text;
      const prev = ps[i - 1], next = ps[i + 1];
      if (prev && "math" in prev && prev.display) t = t.replace(/^\r?\n/, "");
      if (next && "math" in next && next.display) t = t.replace(/\r?\n$/, "");
      return { text: t };
    });
  }
  $effect(() => { if (pieces) loadKatex(); });

  function render(math: string, display: boolean): string | null {
    try { return katex.lib!.renderToString(math, { displayMode: display && block, throwOnError: true, output: "htmlAndMathml" }); }
    catch { return null; }
  }
</script>

{#if !pieces || !katex.lib}{text}{:else}{#each pieces as p}{#if "text" in p}{p.text}{:else}{@const html = render(p.math, p.display)}{#if html !== null}{@html html}{:else}<span class="raw">{p.display ? `$$${p.math}$$` : `$${p.math}$`}</span>{/if}{/if}{/each}{/if}

<style>
  .raw { color: var(--text-2); }
</style>
