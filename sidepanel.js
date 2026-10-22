"use strict";
// Side panel: pairing, hand-over of the current tab, and the chat with the assistant (the same conversation as iMessage and the control center).
// Everything that comes from the server (model replies, page titles, task steps) is shown with text nodes only; links are made only from http(s) URLs;
// a confirmation is a trusted click on a request card the server created, never something a message can trigger.
const root = document.getElementById("root");
const send = (m) => chrome.runtime.sendMessage(m);
const el = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) { if (k === "class") e.className = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e[k] = v; }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
};
const SRC = { imessage: "iMessage", control: "控制中心", ext: "侧边栏", agent: "" };
const SHOT_RE = /^[0-9a-f]{32}\.(png|jpg)$/;
const URL_RE = /https?:\/\/[^\s<>"'，。）)」】]+/g;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hhmm = (t) => new Date(t * 1000).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" });
const linkify = (text) => {
  const out = []; let i = 0;
  for (const m of String(text).matchAll(URL_RE)) {
    const u = m[0].replace(/[.,;:!?]+$/, "");
    out.push(text.slice(i, m.index), el("a", { href: u, target: "_blank", rel: "noopener noreferrer" }, u));
    i = m.index + u.length;
  }
  out.push(text.slice(i));
  return out;
};

let gen = 0;              // bumped whenever the view is rebuilt; old loops see it and stop
const S = { tab: null, granted: {}, active: null, online: null, locked: false };

async function api(path, { method = "GET", body, signal } = {}) {
  const st = await chrome.storage.local.get({ server: "", token: "" });
  if (!st.server || !st.token) return { status: 0, ok: false, data: {} };
  const r = await fetch(st.server + path, { method, signal, headers: { ...(body ? { "Content-Type": "application/json" } : {}), Authorization: "Bearer " + st.token }, body: body ? JSON.stringify(body) : undefined });
  let data = {};
  try { data = await r.json(); } catch (e) { /* empty */ }
  if (r.status === 423) showLocked();
  return { status: r.status, ok: r.ok, data };
}

function showLocked() {
  if (S.locked) return;
  S.locked = true; gen++;
  send({ type: "state" });          // lets the background forget the revoked token and release the site access
  root.replaceChildren(el("div", { class: "pad" }, el("h3", {}, "助手已锁定 (/lock)"), el("div", {}, "所有操作已停止, 对话和标签页控制都已停用。在 Mac mini 本机解锁后, 需要重新配对。"),
    el("button", { onclick: () => { S.locked = false; render(); } }, "重新连接")));
}

// ---------- pairing ----------
async function pairingView(st) {
  if (st.pairing) {
    const s = await chrome.storage.local.get("pair");
    const poll = async () => {
      const r = await send({ type: "pair-poll" });
      if (r.ok && r.status === "approved") return render();
      if (r.ok && r.status === "pending") return setTimeout(poll, 2000);
      root.replaceChildren(el("div", { class: "pad bad" }, "配对失败: " + (r.ok ? "配对码已过期或被拒绝" : r.error)), el("div", { class: "pad" }, el("button", { onclick: () => chrome.storage.local.set({ pair: null }).then(render) }, "重试")));
    };
    root.replaceChildren(el("div", { class: "pad" }, "在 Mac mini 终端运行:", el("div", { class: "code" }, s.pair ? s.pair.code : ""), el("div", { class: "mut" }, "ai gateway approve " + (s.pair ? s.pair.code : "")), el("div", { class: "mut" }, "等待批准…")));
    return poll();
  }
  const input = el("input", { value: st.server || "", placeholder: "https://你的网关地址:端口" }), msg = el("div", { class: "bad" });
  const say = (t) => { msg.textContent = t; };
  root.replaceChildren(el("div", { class: "pad" }, el("h3", {}, "交给 AI"), el("div", {}, "输入你的网关地址 (运行 ai gateway url 可以看到):"), input,
    el("div", {}, el("button", { class: "primary", onclick: async () => {
      const addr = input.value.trim();
      if (!addr) return say("请先填网关地址");
      let origin;
      try { origin = new URL(addr).origin; } catch (e) { return say("网关地址格式不对"); }
      let ok = false;       // asks the browser for access to this ONE address; must happen inside the click
      try { ok = await chrome.permissions.request({ origins: [origin + "/*"] }); } catch (e) { return say("不能申请权限: " + e.message); }
      if (!ok) return say("没有访问网关的权限: 你拒绝了浏览器的权限申请, 或地址不是 https://。需要点「允许」才能连接");
      const r = await send({ type: "pair", server: addr.replace(/\/$/, ""), name: navigator.platform });
      if (!r.ok) return say(r.error);
      render();
    } }, "连接")), msg));
}

// ---------- main view ----------
async function render() {
  const my = ++gen;
  S.locked = false;
  const st = await send({ type: "state" });
  if (!st.paired) return pairingView(st);
  const list = el("div", { id: "list" }), reqBox = el("div", {}), note = el("div", { class: "note" });
  const dot = el("span", { class: "dot" }), conn = el("span", {}, "连接中…"), tabInfo = el("span", { class: "mut" }), handBtn = el("button", {}, "");
  const mode = el("select", {}, el("option", { value: "act" }, "操作当前页面"), el("option", { value: "read" }, "问当前页面"), el("option", { value: "chat" }, "普通聊天"));
  const stopBtn = el("button", { class: "danger hidden", onclick: async () => { await api("/api/web/stop", { method: "POST", body: {} }); say("已请求停止"); } }, "停止");
  const ta = el("textarea", { rows: 2, placeholder: "输入指令 (默认操作当前页面; 任务提问时直接在这里回答); Enter 发送, Shift+Enter 换行" });
  const sendBtn = el("button", { class: "primary" }, "发送");
  const say = (t) => { note.textContent = t; };
  const hdr = el("div", { class: "hdr" }, el("div", { class: "row" }, dot, conn, el("span", { class: "mut" }, " · "), tabInfo, handBtn,
    el("button", { onclick: async () => { if (confirm("断开与网关的连接? (已交出的标签页会全部收回)")) { await send({ type: "disconnect" }); render(); } } }, "断开")));
  root.replaceChildren(...[st.outdated ? el("div", { class: "warn" }, `有新版本 ${st.latest} (当前 ${st.current}), 请 git pull 后重新加载扩展`) : null, hdr, list, reqBox, el("div", { class: "bar" }, note, ta, el("div", { class: "row" }, mode, stopBtn, sendBtn))]);
  try { const m = (await chrome.storage.local.get({ panelMode: "act" })).panelMode; mode.value = m; } catch (e) { /* default */ }
  mode.addEventListener("change", () => chrome.storage.local.set({ panelMode: mode.value }));
  const alive = () => my === gen;

  // current tab + hand-over state
  // Without the `tabs` permission Chrome hides url/title of the current tab (only activeTab, which a side panel does not keep, would show them).
  // So "url unknown" is its own state: never treated as a restricted page. `tabs` is an optional permission asked for on a click.
  const STORE = /^https?:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore|microsoftedge\.microsoft\.com\/addons)\//i;
  function tabState(t) {
    if (!t) return "none";
    if (typeof t.url !== "string" || !t.url) return "unknown";
    if (/^https?:/i.test(t.url) && !STORE.test(t.url)) return "ok";
    return "restricted";
  }
  const goodText = (x) => (typeof x === "string" && x.trim() && !/^(null|undefined)$/i.test(x.trim()) ? x.trim() : "");
  const hostOf = (u) => { try { return new URL(u).hostname; } catch (e) { return ""; } };
  // title: the tab's own, else what was stored when it was handed over, else the host name, never "null"
  const tabName = (t) => (goodText(t && t.title) || goodText((S.granted[t && t.id] || {}).title) || hostOf(t && t.url) || hostOf((S.granted[t && t.id] || {}).url) || "当前页面").slice(0, 30);
  async function allowUrls() { try { return await chrome.permissions.request({ permissions: ["tabs"] }); } catch (e) { return false; } }
  async function refreshTab() {
    const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    S.tab = t || null;
    S.granted = (await send({ type: "state" })).granted || {};
    const st = tabState(S.tab);
    const mine = st !== "none" && S.granted[S.tab.id];
    tabInfo.textContent = mine ? tabName(S.tab) + " · 已交给 AI"
      : st === "ok" ? tabName(S.tab) + " · 未交出"
      : st === "unknown" ? "还没读到当前页面的网址 (发送页面指令时会请求权限)"
      : st === "restricted" ? "这是浏览器内部页面, 不能交给 AI, 只能普通聊天"
      : "没有打开的页面, 只能普通聊天";
    tabInfo.className = mine ? "on" : "mut";
    handBtn.classList.toggle("hidden", !mine);
    handBtn.textContent = "收回";
    handBtn.onclick = async () => { await send({ type: "revoke", tabId: S.tab.id }); refreshTab(); };
  }
  chrome.tabs.onActivated.addListener(() => alive() && refreshTab());
  chrome.tabs.onUpdated.addListener((id, info) => { if (alive() && (info.status === "complete" || info.title)) refreshTab(); });
  refreshTab();

  // sending: the first message that needs the page hands the current tab over (the browser asks for access to that one site)
  async function sendMessage() {
    const text = ta.value.trim();
    if (!text || sendBtn.disabled) return;
    const mode0 = text.startsWith("/") || S.active ? "chat" : mode.value;          // a running task: this is an answer or a stop, not a new page command
    const tab = S.tab;
    let m = mode0;
    if (m !== "chat" && !(tab && S.granted[tab.id])) {
      if (tabState(tab) === "unknown") {
        if (!(await allowUrls())) return say("没有得到读取网址的权限, 发不出页面指令; 可以切到「普通聊天」。");       // first await: needs the click / Enter
        await refreshTab();
        return say("已允许读取网址。请再发送一次, 浏览器会接着询问这个网站的访问授权。");
      }
      if (tabState(tab) !== "ok") {         // chrome:// pages and the like: the input still works, as plain chat
        m = "chat";
        list.append(el("div", { class: "note" }, "当前页面不能交给 AI, 这条按普通聊天发送"));
      }
    }
    if (m !== "chat") {
      if (!S.granted[tab.id]) {
        let ok = false;
        try { ok = await chrome.permissions.request({ origins: [new URL(tab.url).origin + "/*"] }); } catch (e) { /* denied */ }       // must be the first await: it needs the click / Enter
        if (!ok) return say("没有得到这个网站的访问授权, 没有发送。");
        const g = await send({ type: "grant", tabId: tab.id });
        if (!g.ok) return say("不能交出这个标签页: " + g.error);
        S.granted[tab.id] = true; refreshTab();
        list.append(el("div", { class: "note" }, "已把当前标签页交给 AI (页面里有红色横幅, 随时可以点「收回」)"));
      }
    }
    sendBtn.disabled = true;
    try {
      const r = await api("/api/chat", { method: "POST", body: { text, mode: m, ...(m !== "chat" ? { tab: { tab_id: tab.id } } : {}) } });
      if (r.ok) { ta.value = ""; say(""); } else if (r.status !== 423) say("发送失败: " + (r.data.error || r.status));
    } catch (e) { say("连不上网关: 请检查 Tailscale 和网关地址"); }
    sendBtn.disabled = false;
    ta.focus();
  }
  sendBtn.addEventListener("click", sendMessage);
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendMessage(); } });

  // screenshots need the device token, so they are fetched and shown from a blob
  const shots = new Map();
  async function shotImg(name) {
    const img = el("img", { class: "shot", alt: "截图" });
    if (!shots.has(name)) {
      shots.set(name, (async () => {
        const s = await chrome.storage.local.get({ server: "", token: "" });
        const r = await fetch(s.server + "/api/screenshots/" + name, { headers: { Authorization: "Bearer " + s.token } });
        return r.ok ? URL.createObjectURL(await r.blob()) : "";
      })());
    }
    shots.get(name).then((u) => { if (u) img.src = u; }).catch(() => {});
    return img;
  }
  async function node(m) {
    const meta = m.meta || {}, shot = SHOT_RE.test(meta.shot || "") ? await shotImg(meta.shot) : null;
    if (meta.kind === "step" || meta.kind === "action") return el("div", { class: "step" }, hhmm(m.ts) + " ", linkify(m.text), shot);
    return el("div", { class: "msg " + (m.role === "user" ? "user" : "bot") }, el("small", {}, [SRC[m.source] || "助手", hhmm(m.ts)].filter(Boolean).join(" · ")), linkify(m.text));
  }

  // chat loop (long poll)
  (async () => {
    let last = 0, first = true, wait = 1000;
    while (alive()) {
      try {
        const r = await api(`/api/chat?since=${last}&wait=20${first ? "&tail=1" : ""}`);
        if (!alive()) return;
        if (r.status === 423) return;
        if (r.status === 401) { dot.className = "dot bad"; conn.textContent = "连接已失效, 请断开后重新连接"; return; }
        if (!r.ok) throw new Error("status " + r.status);
        dot.className = "dot ok"; conn.textContent = "已连接"; S.online = true; wait = 1000;
        const stick = first || list.scrollHeight - list.scrollTop - list.clientHeight < 80;
        for (const m of r.data.messages) list.append(await node(m));
        last = r.data.last; first = false;
        if (stick) list.scrollTop = list.scrollHeight;
      } catch (e) {
        dot.className = "dot bad"; conn.textContent = "连接中断, 重试中…"; S.online = false;
        await sleep(wait); wait = Math.min(wait * 2, 15000);
      }
    }
  })();

  // pending confirmations (cards with screenshot and 确认 / 取消) and the running task
  function card(r) {
    const retype = el("input", { placeholder: `再输入一次「${r.confirm_text}」`, class: r.level === "dangerous" ? "" : "hidden" });
    const decide = (decision) => async (ev) => {
      if (!ev.isTrusted) return;
      const x = await api(`/api/requests/${encodeURIComponent(r.id)}/resolve`, { method: "POST", body: { decision, retype: retype.value } });
      if (!x.ok && x.status !== 423) say(x.data.reason === "retype_mismatch" ? "高风险操作需要再输入一次确认文字" : "没有处理成功: " + (x.data.reason || x.status));
      else loadSide();
    };
    const c = el("div", { class: "req" }, el("strong", {}, r.title), el("pre", {}, r.detail), retype,
      el("div", { class: "row" }, el("button", { class: "primary", onclick: decide("approve") }, "确认"), el("button", { onclick: decide("deny") }, "取消")));
    if (SHOT_RE.test(r.screenshot || "")) shotImg(r.screenshot).then((i) => c.insertBefore(i, c.children[2]));
    return c;
  }
  async function loadSide() {
    try {
      const [rq, stt] = await Promise.all([api("/api/requests"), api("/api/chat/state")]);
      if (!alive() || !rq.ok) return;
      const ids = rq.data.requests.map((r) => r.id).join();
      if (reqBox.dataset.ids !== ids) { reqBox.dataset.ids = ids; reqBox.replaceChildren(...rq.data.requests.map(card)); }
      S.active = stt.data.active || null;
      stopBtn.classList.toggle("hidden", !S.active);
    } catch (e) { /* the chat loop reports connection problems */ }
  }
  (async () => { while (alive()) { await loadSide(); await sleep(2500); } })();
}

render();
