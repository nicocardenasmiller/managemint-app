// Finds LaTeX math in task text. Mirrored by android/.../data/MathText.kt (same test cases).
//
// $...$ and \(...\) are inline math; $$...$$ and \[...\] are display math. \$ is a plain dollar sign.
// To keep prices plain ("$5 and $10"), a single $ only opens math when the next character isn't a space,
// and only closes when the character before isn't a space and the one after isn't a digit.
// An opener with no closer is plain text. Editing always shows the raw text; only display renders it.

export type Piece = { text: string } | { math: string; display: boolean };

export function hasMath(s: string): boolean {
  return splitMath(s).some((p) => "math" in p);
}

export function splitMath(s: string): Piece[] {
  const out: Piece[] = [];
  let plain = "";
  const flush = () => { if (plain) { out.push({ text: plain }); plain = ""; } };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "\\" && s[i + 1] === "$") { plain += "$"; i += 2; continue; }
    if (c === "\\" && (s[i + 1] === "(" || s[i + 1] === "[")) {
      const close = s[i + 1] === "(" ? "\\)" : "\\]";
      const end = s.indexOf(close, i + 2);
      if (end > i + 2) { flush(); out.push({ math: s.slice(i + 2, end).trim(), display: s[i + 1] === "[" }); i = end + 2; continue; }
    }
    if (c === "$" && s[i + 1] === "$") {
      const end = s.indexOf("$$", i + 2);
      if (end > i + 2 && s.slice(i + 2, end).trim()) { flush(); out.push({ math: s.slice(i + 2, end).trim(), display: true }); i = end + 2; continue; }
    }
    if (c === "$" && s[i + 1] !== "$" && i + 1 < s.length && !/\s/.test(s[i + 1])) {
      const end = closeDollar(s, i + 1);
      if (end > 0) { flush(); out.push({ math: s.slice(i + 1, end), display: false }); i = end + 1; continue; }
    }
    plain += c;
    i++;
  }
  flush();
  return out;
}

function closeDollar(s: string, from: number): number {
  for (let j = from; j < s.length; j++) {
    if (s[j] === "\\") { j++; continue; }
    if (s[j] === "\n") return -1;
    if (s[j] === "$") {
      if (/\s/.test(s[j - 1]) || /[0-9]/.test(s[j + 1] ?? "")) return -1;
      return j;
    }
  }
  return -1;
}
