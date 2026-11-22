#!/usr/bin/env node
// Checks copy/wording.txt against the code: every wording name the app uses must be in the file, and every line in
// the file must be used somewhere. Run it with `node copy/check.mjs`; the backend and desktop tests run it too.
// The Android build also fails by itself on a missing name (Words.x.y won't compile).
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseWording } from "./wording.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function files(dir, exts) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    if (e === "node_modules" || e === "build" || e === "dist") return [];
    return statSync(p).isDirectory() ? files(p, exts) : exts.some((x) => e.endsWith(x)) ? [p] : [];
  });
}

/** Returns { missing: [[name, where]], unused: [name] } for the repo at `root`. */
export function checkWording(root = ROOT) {
  const words = parseWording(readFileSync(join(root, "copy/wording.txt"), "utf8"));
  const used = new Map(); // name -> first file that uses it
  const use = (name, file) => { if (!used.has(name)) used.set(name, relative(root, file)); };
  const sections = (prefix) => new Set(Object.keys(words).filter((k) => k.startsWith(prefix)).map((k) => k.split(".")[1]));

  // Website: {{site.home.title}} markers.
  for (const f of files(join(root, "release/public/site"), [".html"]))
    for (const m of readFileSync(f, "utf8").matchAll(/\{\{([a-z0-9_]+(?:\.[a-z0-9_]+)+)(?:\|js)?\}\}/g)) use(m[1], f);

  // Backend: w("x") / j("x") in the setup page are setup.x; sw("x") anywhere is server.x.
  for (const f of files(join(root, "backend/src"), [".ts"])) {
    const text = readFileSync(f, "utf8");
    if (f.endsWith("setup-page.ts")) for (const m of text.matchAll(/\b[wj]\("([a-z0-9_]+)"/g)) use(`setup.${m[1]}`, f);
    for (const m of text.matchAll(/\bsw\("([a-z0-9_]+)"/g)) use(`server.${m[1]}`, f);
  }

  // Desktop: any "section.name" string whose section is a desktop section (tr("topbar.today"), or names kept in a map).
  const desktopSections = sections("desktop.");
  // On a line that calls tr(), every "word.word" string counts, so a misspelled section is caught too.
  for (const f of files(join(root, "desktop/src"), [".ts", ".svelte"]))
    for (const line of readFileSync(f, "utf8").split("\n"))
      for (const m of line.matchAll(/["'`]([a-z][a-z0-9_]*)\.([a-z0-9_]+)["'`]/g))
        if (desktopSections.has(m[1]) || (/\btr\(/.test(line) && m[1] !== "managemint")) use(`desktop.${m[1]}.${m[2]}`, f);

  // Android: Words.section.name in Kotlin, @string/name in the manifest and resource XML.
  const appDir = join(root, "android/app/src/main");
  for (const f of files(join(appDir, "java"), [".kt"]))
    for (const m of readFileSync(f, "utf8").matchAll(/\bWords\.`?([a-z0-9_]+)`?\.`?([a-z0-9_]+)`?/g)) use(`android.${m[1]}.${m[2]}`, f);
  for (const f of [join(appDir, "AndroidManifest.xml"), ...files(join(appDir, "res"), [".xml"])].filter(existsSync))
    for (const m of readFileSync(f, "utf8").matchAll(/@string\/([a-z0-9_]+)/g)) use(`android.manifest.${m[1]}`, f);

  const missing = [...used].filter(([name]) => !(name in words));
  const unused = Object.keys(words).filter((k) => !used.has(k));
  return { missing, unused };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { missing, unused } = checkWording();
  for (const [name, file] of missing) console.error(`Missing from copy/wording.txt: ${name} (used in ${file})`);
  for (const name of unused) console.error(`Not used anywhere (remove it from copy/wording.txt, or fix its name): ${name}`);
  if (missing.length || unused.length) process.exit(1);
  console.log("Wording OK: every name the app uses is in copy/wording.txt, and every line there is used.");
}
