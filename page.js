// Runs inside the page. Returns {title,url,elements,blocks,flags}. Never returns input values (so passwords and card numbers cannot reach a model).
(() => {
  const PAY_NAME = /card.?(num|no)|cc.?(num|no)|cvv|cvc|csc|expir|security.?code|卡号|银行卡|信用卡|有效期|安全码|iban|routing/i;
  const PAY_HOST = /(stripe|paypal|adyen|braintree|checkout\.com|alipay|pay\.google|applepay|klarna|squareup|razorpay|worldpay)/i;
  const vis = (e) => {
    const r = e.getBoundingClientRect(), s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && parseFloat(s.opacity || "1") > 0.05;
  };
  const clean = (t) => (t || "").replace(/\s+/g, " ").trim();
  const nameOf = (e) => {
    let n = e.getAttribute("aria-label") || "";
    if (!n && e.labels && e.labels.length) n = [...e.labels].map((l) => l.innerText).join(" ");
    if (!n && e.id) { const l = document.querySelector(`label[for="${CSS.escape(e.id)}"]`); if (l) n = l.innerText; }
    if (!n && (e.tagName === "INPUT") && ["submit", "button", "reset"].includes(e.type)) n = e.value;
    if (!n) n = e.innerText || e.getAttribute("title") || e.getAttribute("alt") || e.getAttribute("placeholder") || e.getAttribute("name") || "";
    if (!n) { const img = e.querySelector("img[alt]"); if (img) n = img.alt; }
    return clean(n).slice(0, 100);
  };
  const roleOf = (e) => {
    const r = e.getAttribute("role"); if (r) return r;
    const t = e.tagName.toLowerCase();
    if (t === "a") return "link";
    if (t === "button") return "button";
    if (t === "select") return "combobox";
    if (t === "textarea") return "textbox";
    if (t === "input") { const ty = (e.type || "text").toLowerCase(); return ty === "checkbox" ? "checkbox" : ty === "radio" ? "radio" : ["submit", "button", "reset", "image"].includes(ty) ? "button" : "textbox"; }
    return "generic";
  };
  document.querySelectorAll("[data-wref]").forEach((e) => e.removeAttribute("data-wref"));
  const els = [], flags = { login: false, payment: false };
  const sel = 'a[href],button,input,select,textarea,[role=button],[role=link],[role=checkbox],[role=menuitem],[role=tab],[onclick]';
  let i = 0;
  for (const e of document.querySelectorAll(sel)) {
    if (!vis(e) || els.length >= 150) continue;
    const t = e.tagName.toLowerCase(), ty = (t === "button" ? (e.getAttribute("type") || "") : (e.type || "")).toLowerCase();
    if (t === "input" && ty === "hidden") continue;
    const ac = (e.getAttribute("autocomplete") || "").toLowerCase();
    const label = [e.name, e.id, e.getAttribute("placeholder"), e.getAttribute("aria-label"), nameOf(e)].join(" ");
    let kind = "normal";
    if (t === "input" && ty === "password") { kind = "password"; flags.login = true; }
    else if (/^cc-/.test(ac) || (["input", "select", "textarea"].includes(t) && PAY_NAME.test(label))) { kind = "payment"; flags.payment = true; }
    const ref = i++;
    e.setAttribute("data-wref", String(ref));
    els.push({ ref, tag: t, role: roleOf(e), name: nameOf(e), type: ty, kind, disabled: !!e.disabled, inForm: !!e.closest("form"),
               href: t === "a" ? e.href : "", checked: ["checkbox", "radio"].includes(ty) ? !!e.checked : undefined, bare: t === "button" && !e.getAttribute("type") });
  }
  for (const f of document.querySelectorAll("iframe")) if (PAY_HOST.test(f.src || "")) flags.payment = true;
  const blocks = [];
  let section = "(页面开头)";
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT);
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "INPUT", "TEXTAREA", "SELECT", "OPTION"]);
  for (let n = walker.currentNode; n; n = walker.nextNode()) {
    if (!(n instanceof Element) || SKIP.has(n.tagName) || !vis(n)) continue;
    if (/^H[1-6]$/.test(n.tagName)) { section = clean(n.innerText).slice(0, 80) || section; blocks.push({ section, text: "## " + section }); continue; }
    if (["P", "LI", "TD", "TH", "PRE", "BLOCKQUOTE", "FIGCAPTION", "DT", "DD", "SUMMARY", "LABEL", "SPAN", "DIV", "A", "BUTTON"].includes(n.tagName)) {
      const own = clean([...n.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join(" "));
      if (own.length > 1) blocks.push({ section, text: own.slice(0, 600) });
    }
  }
  return { title: document.title, url: location.href, elements: els, blocks: blocks.slice(0, 600), flags };
})()
