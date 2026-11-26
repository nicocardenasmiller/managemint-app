/** Server version. Keep it equal to the Android versionName and bump both for each public release; tags on the public repo's Releases are `v<VERSION>`, and the server and the app both compare themselves with the latest tag. */
export const VERSION = "0.7.8";

/** Compares "1.2.3" style versions (a leading "v" is ignored). Returns -1, 0 or 1. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.trim().replace(/^v/i, "").split(/[.-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0) ? -1 : 1;
  return 0;
}

/**
 * Latest release tag of the public repo (e.g. "nicocardenasmiller/managemint-app"), cached for 12 hours.
 * Returns null when no repo is configured (Nico's private server) or GitHub can't be reached.
 */
export async function latestRelease(repo: string | undefined): Promise<string | null> {
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;
  const key = new Request(`https://managemint.cache/latest-release/${repo}`);
  const cache = (globalThis as { caches?: { default: Cache } }).caches?.default;
  const hit = await cache?.match(key);
  if (hit) return ((await hit.json()) as { tag: string | null }).tag;
  let tag: string | null = null;
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { "user-agent": "managemint-server", accept: "application/vnd.github+json" },
    });
    if (r.ok) tag = ((await r.json()) as { tag_name?: string }).tag_name ?? null;
  } catch { /* offline: no update info */ }
  await cache?.put(key, new Response(JSON.stringify({ tag }), { headers: { "cache-control": "max-age=43200" } }));
  return tag;
}
