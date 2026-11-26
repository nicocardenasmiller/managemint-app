// KaTeX, loaded on first use (it's ~300 KB with fonts). Components read `katex.lib` and re-render once it's set.
type Katex = typeof import("katex").default;

export const katex = $state<{ lib: Katex | null }>({ lib: null });
let loading: Promise<void> | null = null;

export function loadKatex(): Promise<void> {
  loading ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")])
    .then(([m]) => { katex.lib = m.default; })
    .catch(() => { loading = null; }); // offline: try again next time
  return loading;
}
