// Project colours (design/tokens.md §2). A project's `color` is a palette name ("sage"); older rows hold a hex
// value, which maps to the nearest palette hue, same as the phone (android ui/theme/Theme.kt).
export const PALETTE = ["clay", "ochre", "olive", "sage", "teal", "slate", "iris", "plum"] as const;
export type Hue = (typeof PALETTE)[number] | "neutral";

const LIGHT_SOLID: Record<(typeof PALETTE)[number], string> = {
  clay: "#AB6A54", ochre: "#99773A", olive: "#788544", sage: "#4E8D65",
  teal: "#278E8E", slate: "#4784AD", iris: "#7875B1", plum: "#9E6893",
};

export function hueOf(projectId: string | null | undefined, color: string | null | undefined): Hue {
  if (!projectId || projectId === "inbox" || !color) return "neutral";
  const name = color.toLowerCase();
  if ((PALETTE as readonly string[]).includes(name)) return name as Hue;
  const hex = color.replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return "neutral";
  const rgb = (h: string) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const [r, g, b] = rgb(hex);
  if (Math.max(r, g, b) - Math.min(r, g, b) < 0.12) return "neutral";
  let best: Hue = "neutral", bestD = Infinity;
  for (const p of PALETTE) {
    const [pr, pg, pb] = rgb(LIGHT_SOLID[p].slice(1));
    const d = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

/** CSS custom properties for a project's solid / tint / ink colours. */
export function hueVars(h: Hue): string {
  if (h === "neutral") return "--h-solid:var(--text-3);--h-tint:var(--surface-sunken);--h-ink:var(--text-2)";
  return `--h-solid:var(--p-${h});--h-tint:var(--t-${h});--h-ink:var(--i-${h}, var(--text))`;
}

/** 2–3 letter project code shown next to colour (never colour alone). "MA thesis" → MA, "Personal" → Per. */
export function projectCode(name: string): string {
  const words = name.replace(/\(.*?\)/g, "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const first = words[0];
  if (/^[A-Z0-9]{2,4}$/.test(first)) return first.slice(0, 3);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return first.slice(0, 3).replace(/^./, (c) => c.toUpperCase());
}
