// Reads copy/wording.txt, the one file that holds the app's wording (see the notes at the top of that file).
// Used by the backend (setup page), the desktop app, the website build, the Android build and the wording check.
// No dependencies, so every part of the app can use it as is.

/** Parses wording.txt into { key: text }. Throws on a malformed line or a key used twice. */
export function parseWording(source) {
  const out = {};
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  lines.forEach((line, i) => {
    if (!line.trim() || line.trimStart().startsWith("#")) return;
    const m = /^([a-z0-9_]+(?:\.[a-z0-9_]+)+):(?: (.*))?$/.exec(line);
    if (!m) throw new Error(`wording.txt line ${i + 1}: expected "section.name: text", got: ${line.slice(0, 80)}`);
    const [, key, text = ""] = m;
    if (key in out) throw new Error(`wording.txt line ${i + 1}: "${key}" is used twice`);
    out[key] = text.replace(/\\n/g, "\n");
  });
  return out;
}

/** Fills {name} placeholders. A placeholder with no value is left as is, so it's easy to spot. */
export function fill(text, vars) {
  if (!vars) return text;
  return text.replace(/\{([a-z0-9_]+)\}/gi, (whole, name) => (name in vars ? String(vars[name]) : whole));
}

/** Returns a lookup function for one surface: t("topbar.search") reads "desktop.topbar.search". */
export function wordingFor(all, prefix) {
  return (key, vars) => {
    const text = all[`${prefix}.${key}`];
    if (text === undefined) throw new Error(`Missing wording: ${prefix}.${key} (add it to copy/wording.txt)`);
    return fill(text, vars);
  };
}

/** Fills {{section.name}} markers in a website page. {{section.name|js}} is for text inside a "..." script string. */
export function renderPage(html, all) {
  return html.replace(/\{\{([a-z0-9_]+(?:\.[a-z0-9_]+)+)(\|js)?\}\}/g, (_, key, js) => {
    const text = all[key];
    if (text === undefined) throw new Error(`Missing wording: ${key} (add it to copy/wording.txt)`);
    return js ? JSON.stringify(text).slice(1, -1) : text;
  });
}
