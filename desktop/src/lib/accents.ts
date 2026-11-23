// Theme accent colours; values live in design/accents.css (mirrored in android ui/theme/Theme.kt ACCENTS).
export const ACCENTS = ["blue", "slate", "teal", "sage", "olive", "ochre", "iris", "plum"] as const;
export type Accent = (typeof ACCENTS)[number];
/** CSS colour for an accent name; follows light/dark. */
export const accentVar = (a: string | null | undefined) => (a && (ACCENTS as readonly string[]).includes(a) ? `var(--acc-${a})` : "var(--accent)");
/** Wording names for the accent labels. */
export const ACCENT_LABEL: Record<Accent, string> = {
  blue: "accents.blue", slate: "accents.slate", teal: "accents.teal", sage: "accents.sage",
  olive: "accents.olive", ochre: "accents.ochre", iris: "accents.iris", plum: "accents.plum",
};
