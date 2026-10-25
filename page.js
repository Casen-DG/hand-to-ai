// Runs inside the page. Returns {title,url,elements,blocks,flags}. Never returns the value of a text field (so passwords and card numbers cannot reach a model); only the
// state of sliders (value / range), drop-downs (chosen option / options) and check boxes (checked) is read, because the assistant has to set those.
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
    if (t === "input") { const ty = (e.type || "text").toLowerCase(); return ty === "range" ? "slider" : ty === "checkbox" ? "checkbox" : ty === "radio" ? "radio" : ["submit", "button", "reset", "image"].includes(ty) ? "button" : "textbox"; }
    return "generic";
  };
  document.querySelectorAll("[data-wref]").forEach((e) => e.removeAttribute("data-wref"));
  const els = [], flags = { login: false, payment: false };
  const sel = 'a[href],button,input,select,textarea,[role=button],[role=link],[role=checkbox],[role=switch],[role=radio],[role=slider],[role=menuitem],[role=tab],[onclick]';
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
    const item = { ref, tag: t, role: roleOf(e), name: nameOf(e), type: ty, kind, disabled: !!e.disabled, inForm: !!e.closest("form"),
               href: t === "a" ? e.href : "", checked: ["checkbox", "radio"].includes(ty) ? !!e.checked : undefined, bare: t === "button" && !e.getAttribute("type") };
    if (kind === "normal") {
      if (t === "input" && ty === "range") Object.assign(item, { value: e.value, min: e.min === "" ? "0" : e.min, max: e.max === "" ? "100" : e.max, step: e.step === "" ? "1" : e.step });
      else if (t === "select") Object.assign(item, { value: (e.selectedOptions[0] || {}).text || "", options: [...e.options].slice(0, 40).map((o) => clean(o.text).slice(0, 60)) });
      else if (["switch", "checkbox", "radio"].includes(item.role) && item.checked === undefined) item.checked = e.getAttribute("aria-checked") === "true";
      else if (item.role === "slider" && t !== "input") Object.assign(item, { value: e.getAttribute("aria-valuenow") || "", min: e.getAttribute("aria-valuemin") || "", max: e.getAttribute("aria-valuemax") || "" });
    }
    els.push(item);
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
  // MathML to readable text. A table becomes a matrix [[a, b], [c, d]] (a one-column table is a vector), fractions (a)/(b), powers a^b, roots sqrt(...).
  const wrapIf = (s) => (/^[\w.]+$/.test(s) ? s : "(" + s + ")");
  const mml = (n) => {
    if (n.nodeType === 3) return n.textContent.replace(/\s+/g, " ").trim();
    if (!(n instanceof Element)) return "";
    const t = n.localName.replace(/^.*:/, ""), k = [...n.children], all = () => k.map(mml).filter(Boolean).join(" ");
    switch (t) {
      case "mtable": return "[" + k.map((r) => "[" + (r.localName === "mtr" || r.localName === "mlabeledtr" ? [...r.children] : [r]).map(mml).join(", ") + "]").join(", ") + "]";
      case "mfrac": return "(" + mml(k[0]) + ")/(" + mml(k[1]) + ")";
      case "msup": return wrapIf(mml(k[0])) + "^" + wrapIf(mml(k[1]));
      case "msub": return wrapIf(mml(k[0])) + "_" + wrapIf(mml(k[1]));
      case "msubsup": return wrapIf(mml(k[0])) + "_" + wrapIf(mml(k[1])) + "^" + wrapIf(mml(k[2]));
      case "msqrt": return "sqrt(" + all() + ")";
      case "mroot": return "root(" + mml(k[1]) + ")(" + mml(k[0]) + ")";
      case "mover": return mml(k[0]) + " with " + mml(k[1]) + " above";
      case "munder": return mml(k[0]) + " with " + mml(k[1]) + " below";
      case "mfenced": return (n.getAttribute("open") ?? "(") + k.map(mml).join(", ") + (n.getAttribute("close") ?? ")");
      case "annotation": case "annotation-xml": case "semantics": return t === "semantics" ? mml(k[0]) : "";
      case "mspace": return "";
      default: return k.length ? all() : n.textContent.replace(/\s+/g, " ").trim();
    }
  };
  const formulaSource = (e) => {
    const mt = e.matches("math") ? e : e.querySelector("math");
    if (mt && mt.querySelector("mtable")) return clean(mml(mt));          // a matrix / vector: the structure matters more than a flat alt text
    const ann = e.querySelector('annotation[encoding="application/x-tex"]') || e.querySelector("annotation");
    if (ann && clean(ann.textContent)) return clean(ann.textContent);
    const m = e.matches("math") ? e : e.querySelector("math");
    const alt = (m && m.getAttribute("alttext")) || e.getAttribute("aria-label") || e.getAttribute("data-original") || (e.querySelector("[aria-label]") || { getAttribute: () => "" }).getAttribute("aria-label");
    if (clean(alt)) return clean(alt);
    const img = e.querySelector("img[alt]") || (e.tagName === "IMG" ? e : null);
    if (img && clean(img.alt)) return clean(img.alt);
    const as = e.querySelector("mjx-assistive-mml,.MJX_Assistive_MathML,.katex-mathml");
    if (mt && clean(mml(mt))) return clean(mml(mt));          // plain MathML without any TeX / alt text: read its structure
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
  const GLYPH_OK = /^[✓✔☑✅]+$/, GLYPH_BAD = /^[✗✘×✕✖☒❌]+$/;
  const iconLabel = (e) => {
    if (!["I", "SPAN", "EM", "DIV", "B", "STRONG", "TD"].includes(e.tagName)) return "";
    const tx = clean(e.textContent);
    if (tx.length <= 3 && (GLYPH_OK.test(tx) || GLYPH_BAD.test(tx)) && !e.children.length) return "[图标: " + (GLYPH_BAD.test(tx) ? "叉 (错)" : "勾 (对)") + " 符号" + tx + stateOf(e) + "]";
    if (tx || e.children.length > 1) return "";
    const cls = typeof e.className === "string" ? e.className : "";
    const al = e.getAttribute("aria-label") || e.getAttribute("title") || (e.querySelector("title") || {}).textContent || e.getAttribute("alt") || "";
    if (clean(al)) return "[图标: " + clean(al) + stateOf(e) + "]";
    if (ICON_RE.test(cls)) return "[图标: " + (/times|xmark|close|remove|cross|wrong|\bx\b/i.test(cls) ? "叉 (错)" : "勾 (对)") + " class=" + cls.slice(0, 40) + stateOf(e) + "]";
    return "";
  };
  const big = (e) => { const r = e.getBoundingClientRect(); return r.width >= 40 && r.height >= 40; };
  let rowEl = null;
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "INPUT", "TEXTAREA", "SELECT", "OPTION"]);
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT, { acceptNode(n) {
    const tag = n.tagName.toLowerCase();
    if (rowEl && rowEl.contains(n)) return NodeFilter.FILTER_REJECT;          // already part of an option row's single block
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
  // An option row is ONE block: the row's text, its tick / cross icon, its colour and whether its radio / checkbox is chosen all come from the same
  // container element, so a mark can never slip onto the neighbouring option. Found from each icon: the nearest ancestor that carries text.
  const rowText = (r) => {
    const out = [];
    const walk = (x) => {
      if (x.nodeType === 3) { out.push(x.textContent); return; }
      if (!(x instanceof Element) || SKIP_ROW.has(x.tagName) || !vis(x)) return;
      if (x.matches(FORMULA)) { const src = formulaSource(x); out.push(src ? " [公式] " + src + " " : " [公式] "); return; }
      if (x.tagName === "IMG") { const al = clean(x.getAttribute("alt") || x.getAttribute("title")); if (al) out.push(" [图片: " + al + "] "); return; }
      for (const c of x.childNodes) walk(c);
    };
    walk(r);
    return clean(out.join(" "));
  };
  const SKIP_ROW = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "INPUT", "TEXTAREA", "SELECT", "OPTION", "SVG", "svg", "CANVAS"]);
  const rows = new Map();
  for (const ic of document.body ? document.body.querySelectorAll("i,span,em,div,b,strong,td,svg") : []) {
    if (!vis(ic) || !iconLabel(ic)) continue;
    let r = ic.parentElement;
    while (r && r !== document.body && !rowText(r)) r = r.parentElement;
    if (!r || r === document.body || rowText(r).length > 300) continue;
    if (!rows.has(r)) rows.set(r, []);
    rows.get(r).push(ic);
  }
  for (const inp of document.body ? document.body.querySelectorAll("input[type=radio],input[type=checkbox]") : []) {      // every choice is a row, marked or not
    if (!vis(inp)) continue;
    let r = inp.parentElement;
    while (r && r !== document.body && !rowText(r)) r = r.parentElement;
    if (r && r.tagName === "LABEL" && r.parentElement && r.parentElement !== document.body && r.parentElement.querySelectorAll("input[type=radio],input[type=checkbox]").length === 1) r = r.parentElement;
    if (!r || r === document.body || rowText(r).length > 300) continue;
    if (!rows.has(r)) rows.set(r, []);
  }
  for (let n = walker.currentNode; n; n = walker.nextNode()) {
    if (!(n instanceof Element)) continue;
    if (rowEl && rowEl.contains(n)) continue;
    if (rows.has(n)) {
      rowEl = n;
      const icons = rows.get(n).map((ic) => iconLabel(ic)).join(" ");
      const chosen = [...n.querySelectorAll("input[type=radio],input[type=checkbox]")].some((x) => x.checked) ? " [已选中]" : "";
      const inner = new Set();      // the colour of the option's own text, wherever inside THIS row it sits
      for (const x of [...n.querySelectorAll("*")].slice(0, 40)) {
        if (![...x.childNodes].some((c) => c.nodeType === 3 && clean(c.textContent))) continue;
        const c = colorOf(getComputedStyle(x).color); if (c) inner.add("文字" + c);
      }
      const st = stateOf(n), extra = [...inner].filter((c) => !st.includes(c));
      blocks.push({ section, text: ("[选项行] " + rowText(n)).slice(0, 560) + " " + icons + chosen + st + (extra.length ? " [行内标记: " + extra.join(", ") + "]" : "") });
      continue;
    }
    if (/^H[1-6]$/.test(n.tagName)) { section = clean(n.innerText).slice(0, 80) || section; blocks.push({ section, text: "## " + section }); continue; }
    const ic = iconLabel(n);
    if (ic) { blocks.push({ section, text: ic + " (没能确定它属于哪个选项, 不要把它挂到任何选项上)" }); continue; }
    if (["P", "LI", "TD", "TH", "PRE", "BLOCKQUOTE", "FIGCAPTION", "DT", "DD", "SUMMARY", "LABEL", "SPAN", "DIV", "A", "BUTTON"].includes(n.tagName)) {
      const own = clean([...n.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join(" "));
      const st = own && blocks.length < 500 ? stateOf(n) : "";
      if (own.length > 1 || (own && st)) blocks.push({ section, text: own.slice(0, 560) + st });
    }
  }
  return { title: document.title, url: location.href, elements: els, blocks: blocks.slice(0, 600), flags, unread };
})()
