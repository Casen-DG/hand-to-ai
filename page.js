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
  const blocks = [], unread = [];
  let section = "(页面开头)";
  // Content that has no text in the page structure: read what the page itself says about it (MathJax / KaTeX / MathML source, alt text, aria-label,
  // SVG title), otherwise report it in `unread` so the parent can take a screenshot and have a vision model read it.
  document.querySelectorAll("[data-wvis]").forEach((e) => e.removeAttribute("data-wvis"));
  const mark = (e, kind, hint) => {
    if (unread.length >= 12) return;
    const id = unread.length, r = e.getBoundingClientRect();
    e.setAttribute("data-wvis", String(id));
    unread.push({ id, kind, hint: clean(hint).slice(0, 80), w: Math.round(r.width), h: Math.round(r.height) });
  };
  const put = (text) => { text = clean(text).slice(0, 600); if (text && !(blocks.length && blocks[blocks.length - 1].text === text)) blocks.push({ section, text }); };
  const FORMULA = "mjx-container,.katex,.MathJax,.MathJax_Display,.mathjax,math,.mwe-math-element,[data-mathml]";
  const formulaSource = (e) => {
    const ann = e.querySelector('annotation[encoding="application/x-tex"]') || e.querySelector("annotation");
    if (ann && clean(ann.textContent)) return clean(ann.textContent);
    const m = e.matches("math") ? e : e.querySelector("math");
    const alt = (m && m.getAttribute("alttext")) || e.getAttribute("aria-label") || e.getAttribute("data-original") || (e.querySelector("[aria-label]") || { getAttribute: () => "" }).getAttribute("aria-label");
    if (clean(alt)) return clean(alt);
    const img = e.querySelector("img[alt]") || (e.tagName === "IMG" ? e : null);
    if (img && clean(img.alt)) return clean(img.alt);
    const as = e.querySelector("mjx-assistive-mml,.MJX_Assistive_MathML,.katex-mathml");
    return as ? clean(as.textContent) : "";
  };
  // Visual state that plain text loses: right / wrong marks, red / green, tick and cross icons, highlights. Read from class names, aria attributes,
  // icon alt text and computed colours, and appended to the text it belongs to as 「[标记: ...]」.
  const STATE_RE = /(^|[\s_-])(in-?correct|wrong|error|fail(ed|ure)?|invalid|danger|incorrect-answer|correct|right|success|valid|pass(ed)?|selected|checked|chosen|highlight(ed)?|active|missed|unanswered|partial)([\s_-]|$)/i;
  const ICON_RE = /(fa-check|fa-times|fa-xmark|fa-close|fa-circle-check|fa-circle-xmark|glyphicon-(ok|remove)|icon-?(check|tick|cross|close|correct|wrong|ok|x)|mdi-(check|close)|bi-(check|x)|check-?mark|checkmark|tick|cross)/i;
  const colorOf = (c) => {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(c || "");
    if (!m || (m[4] !== undefined && parseFloat(m[4]) < 0.3)) return "";
    const r = +m[1], g = +m[2], b = +m[3];
    if (r > 150 && g < 100 && b < 100) return "红色";
    if (g > 110 && r < 100 && b < 120 && g - r > 40) return "绿色";
    return "";
  };
  const stateOf = (e) => {
    const tags = [];
    for (let a = e, d = 0; a && a !== document.body && d < 3; a = a.parentElement, d++) {
      const cls = typeof a.className === "string" ? a.className : "";
      const m = cls.split(/\s+/).filter((c) => STATE_RE.test(c) || STATE_RE.test(" " + c + " "));
      if (m.length) tags.push("class=" + m.slice(0, 3).join("/"));
      for (const k of ["aria-invalid", "aria-checked", "aria-selected", "aria-current", "data-correct", "data-state", "data-status", "data-result"]) {
        const v = a.getAttribute(k); if (v && v !== "false") tags.push(k + "=" + v);
      }
      const t = a.getAttribute("title"); if (a !== e && t && /correct|wrong|right|incorrect|正确|错误|对|错/i.test(t)) tags.push("title=" + t);
      if (tags.length) break;
    }
    const cs = getComputedStyle(e);
    let col = colorOf(cs.color) ? "文字" + colorOf(cs.color) : "";
    if (!col) for (let a = e, d = 0; a && a !== document.body && d < 3; a = a.parentElement, d++) { const bg = colorOf(getComputedStyle(a).backgroundColor); if (bg) { col = "底色" + bg; break; } }
    if (col) tags.push(col);
    return tags.length ? " [标记: " + [...new Set(tags)].slice(0, 4).join(", ") + "]" : "";
  };
  const iconLabel = (e) => {
    if (!(e.tagName === "I" || e.tagName === "SPAN" || e.tagName === "EM" || e.tagName === "DIV")) return "";
    if (clean(e.textContent) || e.children.length > 1) return "";
    const cls = typeof e.className === "string" ? e.className : "";
    const al = e.getAttribute("aria-label") || e.getAttribute("title") || (e.querySelector("title") || {}).textContent || e.getAttribute("alt") || "";
    if (clean(al)) return "[图标: " + clean(al) + stateOf(e) + "]";
    if (ICON_RE.test(cls)) return "[图标: " + (/times|xmark|close|remove|cross|wrong|\bx\b/i.test(cls) ? "叉 (错)" : "勾 (对)") + " class=" + cls.slice(0, 40) + stateOf(e) + "]";
    return "";
  };
  const big = (e) => { const r = e.getBoundingClientRect(); return r.width >= 40 && r.height >= 40; };
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "INPUT", "TEXTAREA", "SELECT", "OPTION"]);
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT, { acceptNode(n) {
    const tag = n.tagName.toLowerCase();
    if (tag === "script" && /^math\/tex/.test(n.type || "")) { put("[公式] " + n.textContent); return NodeFilter.FILTER_REJECT; }
    if (SKIP.has(n.tagName)) return NodeFilter.FILTER_REJECT;
    if (!vis(n)) return NodeFilter.FILTER_REJECT;
    if (n.matches(FORMULA)) {
      if (n.matches(".MathJax,.MathJax_Display") && n.nextElementSibling && /^math\/tex/.test(n.nextElementSibling.type || "")) return NodeFilter.FILTER_REJECT;   // MathJax v2: the source script follows
      const src = formulaSource(n);
      if (src) put("[公式] " + src); else mark(n, "formula", n.textContent);
      return NodeFilter.FILTER_REJECT;
    }
    if (tag === "img") {
      const alt = n.getAttribute("alt") || n.getAttribute("title") || n.getAttribute("aria-label");
      if (clean(alt)) put("[图片: " + alt + "]" + stateOf(n)); else if (big(n)) mark(n, "image", (n.getAttribute("src") || "").split("/").pop());
      return NodeFilter.FILTER_REJECT;
    }
    if (tag === "canvas") {
      const lab = n.getAttribute("aria-label") || n.textContent;
      if (clean(lab)) put("[画布: " + lab + "]"); else if (big(n)) mark(n, "canvas", n.id || "");
      return NodeFilter.FILTER_REJECT;
    }
    if (tag === "svg") {
      const t = n.querySelector(":scope > title");
      const lab = n.getAttribute("aria-label") || (t && t.textContent) || "";
      const txt = [...n.querySelectorAll("text")].map((x) => x.textContent).join(" ");
      if (clean(lab)) put("[图示: " + lab + "]"); else if (clean(txt)) put("[图示文字: " + txt + "]"); else if (big(n)) mark(n, "svg", "");
      return NodeFilter.FILTER_REJECT;
    }
    return NodeFilter.FILTER_ACCEPT;
  } });
  for (let n = walker.currentNode; n; n = walker.nextNode()) {
    if (!(n instanceof Element)) continue;
    if (/^H[1-6]$/.test(n.tagName)) { section = clean(n.innerText).slice(0, 80) || section; blocks.push({ section, text: "## " + section }); continue; }
    const ic = iconLabel(n);
    if (ic) { blocks.push({ section, text: ic }); continue; }
    if (["P", "LI", "TD", "TH", "PRE", "BLOCKQUOTE", "FIGCAPTION", "DT", "DD", "SUMMARY", "LABEL", "SPAN", "DIV", "A", "BUTTON"].includes(n.tagName)) {
      const own = clean([...n.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join(" "));
      const st = own && blocks.length < 500 ? stateOf(n) : "";
      if (own.length > 1 || (own && st)) blocks.push({ section, text: own.slice(0, 560) + st });
    }
  }
  return { title: document.title, url: location.href, elements: els, blocks: blocks.slice(0, 600), flags, unread };
})()
