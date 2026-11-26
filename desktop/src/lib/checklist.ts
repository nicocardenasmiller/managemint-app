/** Turn pasted text into checklist items: one per non-empty line, without list markers
 *  ("- ", "* ", "• ", "1. ", "2) ", "[ ] ", "[x] "). Mirrored by android data/Checklist.kt (same test cases). */
export function splitPastedList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•–]\s+|\d+[.)]\s+)?(?:\[[ xX]?\]\s*)?/, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}
