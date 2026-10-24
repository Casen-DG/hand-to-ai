// Service worker: pairing, the command loop, and the optional per-tab marking. Once the browser is paired the assistant may drive any tab of it (open,
// read, screenshot, scroll, click, fill, switch tabs, visit any site); commands only come from the paired gateway and the server applies the real policy
// (password / payment fields, typed confirmation for buy / send / submit / delete) before sending one.
let loopRunning = false;

const get = async () => (await chrome.storage.local.get({ server: "", token: "", pair: null, granted: {} }));
const set = (o) => chrome.storage.local.set(o);

async function api(path, { method = "GET", body, token, server } = {}) {
  const st = await get();
  if (!(server || st.server)) throw new Error("no gateway address");
  const r = await fetch((server || st.server) + path, {
    method, headers: { "Content-Type": "application/json", ...(token ?? st.token ? { Authorization: "Bearer " + (token ?? st.token) } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(40000),          // a hung connection must not leave the command loop waiting forever (the poll itself lasts 20 s)
  });
  let data = {};
  try { data = await r.json(); } catch (e) {}
  return { status: r.status, data };
}

// ---- version check: the gateway knows the newest published version; an older install shows a notice in the popup ----
const newer = (a, b) => { const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
async function checkVersion() {
  const st = await get();
  if (!st.token || !st.server) return;
  try {
    const r = await api("/api/ext/version");
    if (r.status !== 200 || !r.data.version) return;
    await set({ latest: r.data.version, outdated: newer(r.data.version, chrome.runtime.getManifest().version), versionChecked: Date.now() });
  } catch (e) {}
}

// ---- marking: badge on the toolbar icon (page independent) + a banner in the page ----
async function mark(tabId, on) {
  try {
    await chrome.action.setBadgeText({ tabId, text: on ? "AI" : "" });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#c0392b" });
  } catch (e) {}
  try {
    await chrome.scripting.executeScript({ target: { tabId }, args: [on], func: (show) => {
      const id = "__hand_to_ai_banner";
      document.getElementById(id)?.remove();
      if (!show) return;
      const b = document.createElement("div");
      b.id = id;
      b.style.cssText = "position:fixed;z-index:2147483647;top:0;left:0;right:0;background:#c0392b;color:#fff;font:13px system-ui;padding:4px 10px;text-align:center;pointer-events:none";
      b.textContent = "🤖 这个标签页已交给 AI 操作 — 点浏览器工具栏里的扩展图标可以收回";
      document.documentElement.appendChild(b);
    } });
  } catch (e) {}
}

// Site access is optional: the popup asks for the current site's origin only when you click 「交给 AI」 (needs a user gesture), and it is removed again
// when the last handed-over tab of that site is taken back.
const originOf = (url) => new URL(url).origin + "/*";
async function dropOrigin(origin, granted) {
  if (!origin || Object.values(granted).some((g) => g.origin === origin)) return;
  try { await chrome.permissions.remove({ origins: [origin] }); } catch (e) {}
}

async function grant(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!/^https?:/.test(tab.url || "")) return { ok: false, error: "only http(s) pages" };
  if (!(await chrome.permissions.contains({ origins: [originOf(tab.url)] }))) return { ok: false, error: "no site permission (click again and allow)" };
  const r = await api("/api/ext/grant", { method: "POST", body: { tab_id: tabId, url: tab.url, title: (tab.title && !/^(null|undefined)$/i.test(tab.title)) ? tab.title : "" } });
  if (r.status !== 200) return { ok: false, error: r.data.error || r.status };
  const st = await get();
  st.granted[tabId] = { url: tab.url, title: (tab.title && !/^(null|undefined)$/i.test(tab.title)) ? tab.title : new URL(tab.url).hostname, origin: originOf(tab.url) };
  await set({ granted: st.granted });
  await mark(tabId, true);
  loop();
  return { ok: true };
}

async function revoke(tabId) {
  try { await api("/api/ext/revoke", { method: "POST", body: { tab_id: tabId } }); } catch (e) {}
  const st = await get();
  const gone = st.granted[tabId];
  delete st.granted[tabId];
  await set({ granted: st.granted });
  await mark(tabId, false);
  if (gone) await dropOrigin(gone.origin, st.granted);
}

async function revokeAllLocal(st) {      // the gateway no longer knows us (device revoked, /lock): forget everything and give the site access back
  await set({ token: "", granted: {} });
  for (const id of Object.keys(st.granted)) await mark(Number(id), false);
  for (const g of Object.values(st.granted)) await dropOrigin(g.origin, {});
}

async function revokeAll() {
  const st = await get();
  try { await api("/api/ext/revoke", { method: "POST", body: {} }); } catch (e) {}
  await set({ granted: {} });
  for (const id of Object.keys(st.granted)) await mark(Number(id), false);
  for (const g of Object.values(st.granted)) await dropOrigin(g.origin, {});
}

// the tab closed, or the server dropped it (revoked in the control center, expired, /lock): forget it here too
chrome.tabs.onRemoved.addListener((id) => { revoke(id); closeConv(id); });
// the tab's conversation is archived by the assistant (it can be found again with /history)
async function closeConv(tabId) {
  const st = await get();
  if (!st.token) return;
  try { await api("/api/ext/conv/close", { method: "POST", body: { tab_id: tabId } }); } catch (e) { /* the next sync closes it */ }
}
async function syncConvs() {      // after a browser restart the old tab ids are gone: close their conversations
  const st = await get();
  if (!st.token) return;
  try { await api("/api/ext/conv/close", { method: "POST", body: { tabs: (await chrome.tabs.query({})).map((t) => t.id) } }); } catch (e) { /* retry later */ }
}
async function syncState() {
  const st = await get();
  if (!st.token) return;
  const r = await api("/api/ext/state");
  if (r.status === 401 || r.status === 423) { await revokeAllLocal(st); return; }
  if (r.status !== 200) return;
  syncConvs();
  const live = new Set(r.data.tabs.map((t) => String(t.tab_id)));
  for (const id of Object.keys(st.granted)) if (!live.has(id)) { const g = st.granted[id]; delete st.granted[id]; await mark(Number(id), false); await dropOrigin(g.origin, st.granted); }
  await set({ granted: st.granted });
}
chrome.tabs.onUpdated.addListener(async (id, info) => {      // keep the banner after navigation
  if (info.status !== "complete") return;
  const st = await get();
  if (st.granted[id]) mark(id, true);
});

// ---- executing a command on a granted tab ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const inTab = (tabId, func, args = []) => chrome.scripting.executeScript({ target: { tabId }, func, args }).then((x) => x[0].result);
const REF = (ref) => `[data-wref="${Number(ref)}"]`;

async function runDevice(op, a) {      // commands about the browser, not one tab
  switch (op) {
    case "tabs": {
      const ts = await chrome.tabs.query({});
      return { ok: true, tabs: ts.map((t) => ({ id: t.id, url: t.url || "", title: t.title || "", active: !!t.active, window: t.windowId, last: t.lastAccessed || 0 })) };
    }
    case "open": {
      const t = await chrome.tabs.create({ url: a.url, active: true });
      for (let i = 0; i < 40; i++) { const x = await chrome.tabs.get(t.id); if (x.status === "complete") break; await sleep(500); }
      await sleep(800);
      const x = await chrome.tabs.get(t.id);
      return { ok: true, tab_id: t.id, url: x.url || a.url, title: x.title || "" };
    }
    default: return { ok: false, error: "unknown_op" };
  }
}

async function activate(tabId) {      // bring the tab (and its window) to the front
  const t = await chrome.tabs.get(tabId);
  if (!t.active) await chrome.tabs.update(tabId, { active: true });
  try { await chrome.windows.update(t.windowId, { focused: true }); } catch (e) {}
  return t;
}

async function run(tabId, op, a) {
  switch (op) {
    case "activate": { await activate(tabId); await sleep(300); return { ok: true }; }
    case "info": { const t = await chrome.tabs.get(tabId); return { ok: true, url: t.url, title: t.title }; }
    case "snapshot": {
      const x = await chrome.scripting.executeScript({ target: { tabId }, files: ["page.js"] });
      return { ok: true, page: x[0].result };
    }
    case "goto": {
      await chrome.tabs.update(tabId, { url: a.url });
      for (let i = 0; i < 40; i++) { await sleep(500); const x = await chrome.tabs.get(tabId); if (x.status === "complete" && i >= 1) break; }
      await sleep(500);
      return { ok: true };
    }
    case "back": await chrome.tabs.goBack(tabId); await sleep(800); return { ok: true };
    case "scroll": await inTab(tabId, (dy) => window.scrollBy(0, dy), [a.dy]); await sleep(300); return { ok: true };
    case "click": {
      const r = await inTab(tabId, (sel) => {
        const e = document.querySelector(sel);
        if (!e) return "unknown_ref";
        if (e.type === "password") return "blocked_field";
        e.scrollIntoView({ block: "center" }); e.click(); return "";
      }, [REF(a.ref)]);
      await sleep(600);
      return r ? { ok: false, error: r } : { ok: true };
    }
    case "type": {
      const r = await inTab(tabId, (sel, text, submit) => {
        const e = document.querySelector(sel);
        if (!e) return "unknown_ref";
        const ac = (e.getAttribute("autocomplete") || "").toLowerCase();
        if (e.type === "password" || /^cc-/.test(ac)) return "blocked_field";        // defence in depth: the server already refuses these
        e.focus();
        const proto = e.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(e, text);
        e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true }));
        if (submit) { const f = e.closest("form"); if (f && f.requestSubmit) f.requestSubmit(); else e.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); }
        return "";
      }, [REF(a.ref), a.text, !!a.submit]);
      await sleep(600);
      return r ? { ok: false, error: r } : { ok: true };
    }
    case "press": {
      const r = await inTab(tabId, (sel, key) => {
        const e = sel ? document.querySelector(sel) : document.activeElement || document.body;
        if (!e) return "unknown_ref";
        if (e.type === "password") return "blocked_field";
        e.focus && e.focus();
        const k = key === "Space" ? " " : key;
        e.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })); e.dispatchEvent(new KeyboardEvent("keyup", { key: k, bubbles: true }));
        if (key === "Enter") { const f = e.closest && e.closest("form"); if (f && f.requestSubmit) f.requestSubmit(); }
        if (key === "PageDown") window.scrollBy(0, innerHeight * 0.8); if (key === "PageUp") window.scrollBy(0, -innerHeight * 0.8);
        return "";
      }, [a.ref == null ? "" : REF(a.ref), a.key]);
      await sleep(400);
      return r ? { ok: false, error: r } : { ok: true };
    }
    case "select": {
      const r = await inTab(tabId, (sel, value) => {
        const e = document.querySelector(sel);
        if (!e || e.tagName !== "SELECT") return "not_a_select";
        const o = [...e.options].find((x) => x.text.trim() === value);
        if (!o) return "option_not_found";
        e.value = o.value; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); return "";
      }, [REF(a.ref), a.value]);
      return r ? { ok: false, error: r } : { ok: true };
    }
    case "screenshot": {      // only the visible tab can be captured: bring this one to the front first
      const t = await activate(tabId);
      if (!t.active) await sleep(400);
      if (a.vis != null) { await inTab(tabId, (sel) => { const e = document.querySelector(sel); if (e) e.scrollIntoView({ block: "center" }); }, [`[data-wvis="${Number(a.vis)}"]`]); await sleep(400); }
      const url = await chrome.tabs.captureVisibleTab(t.windowId, { format: "jpeg", quality: 55 });
      return { ok: true, b64: url.split(",")[1] };
    }
    default: return { ok: false, error: "unknown_op" };
  }
}

// ---- the long-poll loop ----
async function loop() {
  if (loopRunning) return;
  loopRunning = true;
  let failures = 0;
  try {
    for (;;) {
      const st = await get();
      if (!st.token) break;
      let r;
      try { r = await api("/api/ext/poll?wait=20"); failures = 0; } catch (e) { if (++failures >= 5) break; await sleep(5000); continue; }      // gateway unreachable: give up, the 1-minute alarm tries again later
      if (r.status === 401 || r.status === 423) { await revokeAllLocal(st); break; }
      if (r.status !== 200) { if (++failures >= 5) break; await sleep(5000); continue; }
      const cmd = r.data.cmd;
      if (!cmd) continue;
      let res;
      try { res = cmd.tab_id === -1 ? await runDevice(cmd.op, cmd.args || {}) : await run(cmd.tab_id, cmd.op, cmd.args || {}); } catch (e) { res = { ok: false, error: String(e.message || e).slice(0, 150) }; }
      try { await api("/api/ext/result", { method: "POST", body: { id: cmd.id, result: res } }); } catch (e) {}
    }
  } finally { loopRunning = false; }
}
// Keep-alive: Chrome puts the service worker to sleep and an unreachable gateway ends the loop, so the command loop is (re)started from every place that can
// wake the worker: the script itself (each time Chrome starts it), a half-minute alarm, browser start, and every message from the side panel. The loop is
// started BEFORE the housekeeping and the housekeeping can never stop it (an exception in syncState used to leave the loop dead until the next wake).
const kick = () => { loop().catch(() => {}); };
chrome.alarms.create("sync", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(async () => {
  kick();
  try { await syncState(); } catch (e) {}
  try {
    const { versionChecked } = await chrome.storage.local.get({ versionChecked: 0 });
    if (Date.now() - versionChecked > 6 * 3600 * 1000) checkVersion();
  } catch (e) {}
});
chrome.runtime.onStartup.addListener(() => { kick(); syncState().catch(() => {}); checkVersion(); });
kick();
chrome.runtime.onInstalled.addListener(() => { checkVersion(); });

// ---- messages from the popup ----
chrome.runtime.onMessage.addListener((m, _s, reply) => {
  kick();
  (async () => {
    if (m.type === "pair") {
      let u;
      try { u = new URL(m.server); } catch (e) { return reply({ ok: false, error: "网关地址格式不对" }); }
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
      if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return reply({ ok: false, error: "网关地址必须是 https:// (本机调试可用 http://localhost)" });
      m.server = u.origin;
      if (!(await chrome.permissions.contains({ origins: [m.server + "/*"] }))) return reply({ ok: false, error: "没有访问这个网关地址的权限: 请再点一次「连接」并在浏览器弹窗里选「允许」" });
      const old = (await get()).server;
      await set({ server: m.server });
      if (old && old !== m.server) { try { await chrome.permissions.remove({ origins: [old + "/*"] }); } catch (e) {} }      // the address changed: give the old one back
      try {
        const r = await api("/api/pair/request", { method: "POST", body: { name: "ext-" + (m.name || "browser") }, server: m.server });
        if (r.status !== 200) return reply({ ok: false, error: `网关拒绝了请求 (状态 ${r.status}${r.data.error ? ": " + r.data.error : ""})` });
        await set({ pair: { ...r.data, server: m.server } });
        return reply({ ok: true, code: r.data.code });
      } catch (e) { return reply({ ok: false, error: `连不上网关 ${m.server}: 请检查地址是否正确、这台电脑是否已连上 Tailscale (${String(e.message || e).slice(0, 60)})` }); }
    }
    if (m.type === "pair-poll") {
      const st = await get();
      if (!st.pair) return reply({ ok: false, error: "没有进行中的配对" });
      try {
        const r = await api(`/api/pair/status?pair_id=${st.pair.pair_id}&poll_secret=${st.pair.poll_secret}`, { server: st.pair.server });
        if (r.data.status === "approved" && r.data.token) { await set({ token: r.data.token, pair: null }); checkVersion(); loop(); return reply({ ok: true, status: "approved" }); }
        if (r.status !== 200 && r.status !== 404) return reply({ ok: false, error: `网关拒绝了请求 (状态 ${r.status})` });
        return reply({ ok: true, status: r.data.status || (r.status === 404 ? "expired" : "pending") });
      } catch (e) { return reply({ ok: false, error: `连不上网关: ${String(e.message || e).slice(0, 60)}` }); }
    }
    if (m.type === "grant") return reply(await grant(m.tabId));
    if (m.type === "revoke") { await revoke(m.tabId); return reply({ ok: true }); }
    if (m.type === "disconnect") { await revokeAll(); try { await api("/api/me/revoke", { method: "POST" }); } catch (e) {} await set({ token: "", pair: null }); return reply({ ok: true }); }
    if (m.type === "state") { await syncState(); const st = await get(); if (st.token) await checkVersion(); const s2 = await get(); return reply({ paired: !!s2.token, pairing: !!s2.pair, server: s2.server, granted: s2.granted, outdated: !!s2.outdated, latest: s2.latest, current: chrome.runtime.getManifest().version }); }
    reply({ ok: false });
  })();
  return true;
});

// ---- side panel: opens on a click on the toolbar icon, and with the keyboard shortcut ----
chrome.runtime.onInstalled.addListener(() => { chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {}); });
chrome.runtime.onStartup.addListener(() => { chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {}); });
chrome.commands.onCommand.addListener((name, tab) => {
  if (name === "open-panel" && tab) chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
});
