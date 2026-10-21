const root = document.getElementById("root");
const send = (m) => chrome.runtime.sendMessage(m);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); kids.forEach((k) => e.append(k)); return e; };

async function render() {
  const st = await send({ type: "state" });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  root.replaceChildren();
  if (!st.paired && !st.pairing) {
    const input = el("input", { value: st.server || "", placeholder: "https://你的网关地址:端口" });
    const msg = el("div", { style: "color:#b00020;margin-top:6px" });
    const say = (t) => { msg.textContent = t; };
    root.append(el("div", {}, "输入你的网关地址 (运行 ai gateway url 可以看到):"), input,
      el("button", { textContent: "连接", onclick: async () => {
        const addr = input.value.trim();
        if (!addr) return say("请先填网关地址");
        let origin;
        try { origin = new URL(addr).origin; } catch (e) { return say("网关地址格式不对"); }
        // ask the browser for access to this ONE address; it must happen here, inside the click, and the background then makes the request
        let granted = false;
        try { granted = await chrome.permissions.request({ origins: [origin + "/*"] }); } catch (e) { return say("不能申请权限: " + e.message); }
        if (!granted) return say("没有访问网关的权限: 你拒绝了浏览器的权限申请, 或地址不是 https://。需要点「允许」才能连接");
        const r = await send({ type: "pair", server: addr.replace(/\/$/, ""), name: navigator.platform });
        if (!r.ok) return say(r.error);
        render();
      } }), msg);
    return;
  }
  if (!st.paired) {
    const poll = async () => {
      const r = await send({ type: "pair-poll" });
      if (r.ok && r.status === "approved") return render();
      if (r.ok && r.status === "pending") return setTimeout(poll, 2000);
      const why = r.ok ? "配对码已过期或被拒绝" : r.error;      // an error or an expired / denied code ends the wait; no endless retrying
      root.replaceChildren(el("div", { style: "color:#b00020" }, "配对失败: " + why), el("button", { textContent: "重试", onclick: () => chrome.storage.local.set({ pair: null }).then(render) }));
    };
    const s = await chrome.storage.local.get("pair");
    root.append(el("div", {}, "在 Mac mini 终端运行:"), el("div", { className: "code", textContent: s.pair ? s.pair.code : "" }),
      el("div", { className: "small" }, "ai gateway approve " + (s.pair ? s.pair.code : "")), el("div", { className: "small" }, "等待批准…"));
    poll();
    return;
  }
  if (st.outdated) root.append(el("div", { style: "background:#fff3cd;padding:6px;margin-bottom:6px;border-radius:4px" }, `有新版本 ${st.latest} (当前 ${st.current}),请 git pull 后重新加载扩展`));
  const mine = st.granted[tab.id];
  root.append(el("div", { className: "small" }, "当前标签页: " + (tab.title || "").slice(0, 40)));
  if (mine) {
    root.append(el("div", { className: "on" }, "已交给 AI"), el("button", { textContent: "收回", onclick: async () => { await send({ type: "revoke", tabId: tab.id }); render(); } }));
  } else {
    root.append(el("button", { textContent: "交给 AI", onclick: async () => {
      let origin;
      try { origin = new URL(tab.url).origin + "/*"; } catch (e) { return alert("不能交出这个标签页"); }
      if (!/^https?:/.test(tab.url)) return alert("只能交出 http(s) 网页");
      if (!(await chrome.permissions.request({ origins: [origin] }))) return;      // asks for THIS site only; must run here, in the click
      const r = await send({ type: "grant", tabId: tab.id });
      if (!r.ok) return alert("不能交出这个标签页: " + r.error);
      render();
    } }), el("div", { className: "small" }, "只申请这个网站的访问权限, 收回时一并撤销。只有这一个标签页。AI 登录页/付款页会停下来等你; 提交、购买、发送、删除要你打字确认。"));
  }
  const others = Object.keys(st.granted).filter((id) => Number(id) !== tab.id);
  if (others.length) root.append(el("div", { className: "small" }, `另有 ${others.length} 个标签页已交出`), el("button", { textContent: "全部收回", onclick: async () => { for (const id of others) await send({ type: "revoke", tabId: Number(id) }); render(); } }));
  root.append(el("div", {}, el("button", { textContent: "断开与网关的连接", onclick: async () => { await send({ type: "disconnect" }); render(); } })));
}
render();
