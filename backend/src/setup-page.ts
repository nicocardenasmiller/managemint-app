// The setup page (/setup) and the pairing landing page (/pair). Plain HTML + one script file, served by the Worker
// with a strict CSP (scripts only from this server, no inline script). All dynamic text is set with textContent.
// The wording is in copy/wording.txt under "setup.": w() puts it in the HTML, j() puts it in the scripts as a JS string.
import { setupWording as w } from "./wording";

const j = (key: string) => JSON.stringify(w(key));

const STYLE = `
:root{--bg:#F7F5F0;--card:#fff;--ink:#23211d;--muted:#6f6a61;--line:#e4dfd5;--accent:#3f6b5a;--accent-ink:#fff;--warn:#a5492f;--ok:#3f6b5a}
@media (prefers-color-scheme:dark){:root{--bg:#1d1c1a;--card:#262522;--ink:#ece8e1;--muted:#a39d92;--line:#3a3833;--accent:#7fb09b;--accent-ink:#14211b;--warn:#e08a6f;--ok:#7fb09b}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:40rem;margin:0 auto;padding:2rem 1rem 4rem}
h1{font:600 1.9rem/1.2 Georgia,"Newsreader",serif;margin:.6rem 0 .3rem}
h2{font-size:1.05rem;margin:0 0 .4rem}
p{margin:.3rem 0}
.muted{color:var(--muted)}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:1.1rem 1.2rem;margin:1rem 0}
.row{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap}
button,.btn{font:inherit;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:9px;padding:.5rem .9rem;cursor:pointer;text-decoration:none;display:inline-block}
button.primary,.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
button:disabled{opacity:.55;cursor:default}
input{font:inherit;padding:.55rem .7rem;border:1px solid var(--line);border-radius:9px;background:var(--bg);color:var(--ink);min-width:16rem;max-width:100%}
.status{font-weight:600}.status.ok{color:var(--ok)}.status.warn{color:var(--warn)}
.banner{border-radius:10px;padding:.7rem .9rem;margin:1rem 0;border:1px solid var(--line)}
.banner.ok{border-color:var(--ok)}.banner.warn{border-color:var(--warn)}
.code{font:600 1.6rem/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em}
.qr{background:#fff;padding:8px;border-radius:10px;display:inline-block;line-height:0}
.qr svg{width:200px;height:200px}
ul.devices{list-style:none;padding:0;margin:.4rem 0 0}
ul.devices li{display:flex;justify-content:space-between;gap:.6rem;padding:.45rem 0;border-top:1px solid var(--line)}
.logo{width:64px;height:64px;animation:pop .9s cubic-bezier(.2,.9,.3,1.3) both}
.fade{animation:fade .6s .25s ease both}
@keyframes pop{from{transform:scale(.6) rotate(-12deg);opacity:0}to{transform:none;opacity:1}}
@keyframes fade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.logo,.fade{animation:none}}
[hidden]{display:none!important}
`;

export const SETUP_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${w("page_title")}</title>
<link rel="icon" href="/app/icon.svg"><style>${STYLE}</style></head><body><main>
<img class="logo" src="/app/icon.svg" alt="">
<h1 class="fade">${w("welcome_title")}</h1>
<p class="muted fade">${w("welcome")}</p>
<div id="banner" class="banner" hidden></div>

<section id="login" class="card" hidden>
  <h2>${w("login_title")}</h2>
  <p class="muted">${w("login_help")}</p>
  <form id="login-form" class="row"><input id="password" type="password" autocomplete="current-password" placeholder="${w("login_placeholder")}" required>
  <button class="primary" type="submit">${w("login_button")}</button></form>
  <p id="login-error" class="status warn" hidden></p>
</section>

<div id="panel" hidden>
  <section class="card">
    <h2>${w("ai_title")}</h2>
    <p>${w("status_label")} <span id="claude-status" class="status">…</span></p>
    <p class="muted">${w("ai_help")}</p>
    <button id="check-claude">${w("ai_check")}</button>
  </section>

  <section class="card">
    <h2>${w("calendar_title")}</h2>
    <p class="muted">${w("calendar_help")}</p>
    <div class="row" style="margin-top:.6rem">
      <a id="feed-apple" class="btn primary" href="#">${w("feed_apple")}</a>
      <a id="feed-google" class="btn" href="#" target="_blank" rel="noopener noreferrer">${w("feed_google")}</a>
      <button id="feed-copy">${w("feed_copy")}</button>
    </div>
    <div class="row" style="margin-top:.8rem;align-items:flex-start">
      <div class="qr" id="feed-qr"></div>
      <div style="flex:1;min-width:14rem">
        <p class="muted">${w("feed_scan")}</p>
        <p class="muted">${w("feed_private")}</p>
        <button id="feed-reset">${w("feed_reset")}</button>
      </div>
    </div>
    <p id="feed-status" class="status" hidden></p>

    <div id="google-box" hidden style="margin-top:1rem;padding-top:.8rem;border-top:1px solid var(--line)">
      <h2>${w("google_title")}</h2>
      <p>${w("status_label")} <span id="google-status" class="status">…</span></p>
      <p class="muted" id="google-help">${w("google_help")}</p>
      <div class="row"><button id="google-connect" hidden>${w("google_connect")}</button>
      <button id="google-disconnect" hidden>${w("google_disconnect")}</button></div>
    </div>
  </section>

  <section class="card">
    <h2>${w("devices_title")}</h2>
    <p class="muted">${w("devices_help")}</p>
    <button id="pair" class="primary">${w("devices_pair")}</button>
    <div id="pairing" hidden>
      <div class="row" style="margin-top:.8rem;align-items:flex-start">
        <div class="qr" id="qr"></div>
        <div><p>${w("devices_scan")}</p>
        <p class="code" id="code"></p><p class="muted">${w("devices_expires").replace("{time}", '<span id="countdown"></span>')}</p></div>
      </div>
    </div>
    <ul class="devices" id="devices"></ul>
  </section>

  <section class="card">
    <h2>${w("use_title")}</h2>
    <p class="muted">${w("use_help")}</p>
    <a class="btn primary" href="/app/">${w("use_open")}</a>
    <p class="muted" style="margin-top:.8rem">${w("use_version").replace("{version}", '<span id="version"></span>').replace("{update}", '<span id="update" hidden>' + w("use_update") + "</span>")}</p>
  </section>
</div>
<script src="/setup.js"></script></main></body></html>`;

export const SETUP_JS = `"use strict";
const TOKEN_KEY = "managemint.token";
const $ = (id) => document.getElementById(id);
const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
const setToken = (t) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {} };
async function api(method, path, body) {
  const r = await fetch(path, { method, headers: { authorization: "Bearer " + (getToken() || ""), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  let data = null; try { data = await r.json(); } catch {}
  if (!r.ok) { const e = new Error((data && data.error) || ("HTTP " + r.status)); e.status = r.status; throw e; }
  return data;
}
function banner(text, ok) { const b = $("banner"); b.textContent = text; b.className = "banner " + (ok ? "ok" : "warn"); b.hidden = false; }
function status(el, text, ok) { el.textContent = text; el.className = "status " + (ok === true ? "ok" : ok === false ? "warn" : ""); }
const deviceName = () => { const ua = navigator.userAgent; return ${j("browser_on")}.replace("{device}", /iPhone|iPad/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : ${j("device_computer")}); };

async function load() {
  const q = new URLSearchParams(location.search);
  if (q.get("google")) { banner(q.get("msg") || "", q.get("google") === "ok"); history.replaceState(null, "", "/setup"); }
  if (!getToken()) return showLogin();
  let s;
  try { s = await api("GET", "/setup/status"); }
  catch (e) { if (e.status === 401) { setToken(null); return showLogin(); } return banner(${j("unreachable")}.replace("{error}", () => e.message), false); }
  $("login").hidden = true; $("panel").hidden = false;
  status($("claude-status"), s.claude ? ${j("ai_key_added")} : ${j("ai_no_key")}, s.claude ? true : false);
  $("limit").textContent = s.claude_daily_limit; $("used").textContent = s.claude_used_today;
  const g = s.google;
  // Direct Google sync is optional and needs Google keys on the server; without them only the calendar link is shown.
  $("google-box").hidden = !g.client && g.source !== "secrets";
  if (g.source === "secrets") { status($("google-status"), ${j("google_secrets")}, true); }
  else { status($("google-status"), g.connected ? ${j("google_connected")} : ${j("google_not_connected")}, g.connected ? true : null); $("google-connect").hidden = g.connected; $("google-disconnect").hidden = !g.connected; $("google-connect").textContent = g.connected ? ${j("google_reconnect")} : ${j("google_connect")}; }
  const ul = $("devices"); ul.textContent = "";
  for (const d of s.devices) {
    const li = document.createElement("li"); const left = document.createElement("span");
    left.textContent = ${j("device_line")}.replace("{name}", d.name + (d.current ? ${j("device_this_browser")} : "")).replace("{date}", d.last_seen_at ? new Date(d.last_seen_at).toLocaleDateString() : ${j("device_never")});
    const b = document.createElement("button"); b.textContent = ${j("device_remove")};
    b.onclick = async () => { if (!confirm(${j("device_remove_confirm")}.replace("{name}", () => d.name))) return; await api("DELETE", "/devices/" + encodeURIComponent(d.id)); if (d.current) setToken(null); load(); };
    li.append(left, b); ul.append(li);
  }
  $("version").textContent = s.version; $("update").hidden = !s.update_available;
  showFeed(await api("GET", "/calendar/feed").catch(() => null));
}

let feedUrl = "";
function showFeed(f) {
  if (!f) { status($("feed-status"), ${j("feed_load_failed")}, false); $("feed-status").hidden = false; return; }
  feedUrl = f.url; $("feed-apple").href = f.webcal; $("feed-google").href = f.google; $("feed-qr").innerHTML = f.qr_svg;
}
$("feed-copy").onclick = async () => {
  try { await navigator.clipboard.writeText(feedUrl); status($("feed-status"), ${j("feed_copied")}, true); }
  catch { window.prompt(${j("feed_copy_prompt")}, feedUrl); }
  $("feed-status").hidden = false;
};
$("feed-reset").onclick = async () => {
  if (!confirm(${j("feed_reset_confirm")})) return;
  try { showFeed(await api("POST", "/calendar/feed/reset")); status($("feed-status"), ${j("feed_reset_done")}, true); }
  catch (e) { status($("feed-status"), e.message, false); }
  $("feed-status").hidden = false;
};

function showLogin() { $("panel").hidden = true; $("login").hidden = false; $("password").focus(); }
$("login-form").onsubmit = async (ev) => {
  ev.preventDefault(); $("login-error").hidden = true;
  try { const r = await api("POST", "/setup/login", { password: $("password").value, name: deviceName() }); setToken(r.token); $("password").value = ""; load(); }
  catch (e) { $("login-error").textContent = e.status === 429 ? ${j("login_too_many")} : ${j("login_wrong")}; $("login-error").hidden = false; }
};
$("check-claude").onclick = async () => {
  status($("claude-status"), ${j("ai_checking")});
  try { const r = await api("POST", "/setup/check-claude"); status($("claude-status"), r.ok ? ${j("ai_working")} : r.error, r.ok); }
  catch (e) { status($("claude-status"), e.message, false); }
};
$("google-connect").onclick = async () => { try { const r = await api("POST", "/google/start"); location.href = r.url; } catch (e) { banner(e.message, false); } };
$("google-disconnect").onclick = async () => { if (!confirm(${j("google_disconnect_confirm")})) return; await api("POST", "/google/disconnect"); load(); };
let timer = null;
$("pair").onclick = async () => {
  try {
    const r = await api("POST", "/pair/start");
    $("qr").innerHTML = r.qr_svg; $("code").textContent = r.code.slice(0, 4) + "-" + r.code.slice(4); $("pairing").hidden = false;
    const end = Date.parse(r.expires_at); clearInterval(timer);
    const tick = () => { const s = Math.max(0, Math.round((end - Date.now()) / 1000)); $("countdown").textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); if (!s) { clearInterval(timer); $("pairing").hidden = true; load(); } };
    tick(); timer = setInterval(tick, 1000);
  } catch (e) { banner(e.message, false); }
};
load();
`;

export const PAIR_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${w("pair_page_title")}</title>
<link rel="icon" href="/app/icon.svg"><style>${STYLE}</style></head><body><main>
<img class="logo" src="/app/icon.svg" alt="">
<h1>${w("pair_title")}</h1>
<section class="card">
  <p>${w("pair_android")}</p>
  <p>${w("pair_browser")} <button id="use" class="primary">${w("pair_sign_in")}</button></p>
  <p id="msg" class="status" hidden></p>
</section>
<script src="/pair.js"></script></main></body></html>`;

export const PAIR_JS = `"use strict";
const code = new URLSearchParams(location.search).get("code") || "";
const msg = document.getElementById("msg");
document.getElementById("use").onclick = async () => {
  const ua = navigator.userAgent;
  const name = ${j("browser_on")}.replace("{device}", /iPhone|iPad/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : ${j("device_computer")});
  const r = await fetch("/pair/claim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { msg.textContent = d.error || ${j("pair_failed")}; msg.className = "status warn"; msg.hidden = false; return; }
  try { localStorage.setItem("managemint.token", d.token); } catch {}
  location.href = "/app/";
};
`;

/** Strict headers for these pages (same idea as the desktop app's). */
export const PAGE_HEADERS: Record<string, string> = {
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; " +
    "frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "cache-control": "no-cache",
};
