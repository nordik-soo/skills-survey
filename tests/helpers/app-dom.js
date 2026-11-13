// A minimal DOM that can boot app.js outside a browser, so tests can drive the
// real render path: the language picklist, the consent screen, the rating pages
// and the shop-storage paths all behave as they do in the page.
//
// mount({ brokenStorage: true }) simulates a browser where localStorage throws
// (blocked cookies / private mode / quota exceeded).
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..");
const SCRIPTS = ["noc-data.js", "cip-data.js", "survey-data.js", "translations.js", "timing.js"];
const BOOT_ELEMENTS = ["#view-home", "#view-survey", "#view-admin", "#survey-root", "#home-body", "#home-h1", "#start-btn", "#lang-btn", ".admin-header-actions"];

let uid = 0;

function makeEl(tag) {
  const classes = new Set();
  const el = {
    tagName: (tag || "div").toUpperCase(),
    _id: uid++,
    children: [],
    attrs: {},
    style: {},
    dataset: {},
    _text: "",
    _html: "",
    type: "",
    value: "",
    disabled: false,
    checked: false,
    placeholder: "",
    onclick: null, oninput: null, onkeydown: null, onchange: null,
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      contains: (c) => classes.has(c),
      toggle: (c, on) => { const want = on === undefined ? !classes.has(c) : !!on; if (want) classes.add(c); else classes.delete(c); return want; },
    },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; },
    removeAttribute(k) { delete this.attrs[k]; },
    appendChild(c) { if (c) { c.parentNode = this; this.children.push(c); } return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    insertBefore(c, ref) { const i = this.children.indexOf(ref); this.children.splice(i < 0 ? 0 : i, 0, c); c.parentNode = this; return c; },
    focus() {}, blur() {}, scrollIntoView() {},
    click() { if (this.onclick) this.onclick({ target: this, preventDefault() {} }); },
    _listeners: {},
    addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
    removeEventListener(ev, fn) { const a = this._listeners[ev] || []; this._listeners[ev] = a.filter((x) => x !== fn); },
    // Dispatch an event to listeners registered with addEventListener, the way a
    // browser would. Tests use this to drive <select> changes and clicks.
    fireEvent(ev, extra) {
      const event = Object.assign({ type: ev, target: this, preventDefault() {} }, extra || {});
      (this._listeners[ev] || []).forEach((fn) => fn(event));
      const handler = this["on" + ev];
      if (typeof handler === "function") handler(event);
      return event;
    },
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v); this.children = []; },
    get innerHTML() { return this._html; },
    set innerHTML(v) {
      this._html = String(v);
      this.children = [];
      for (const c of parseHTML(this._html)) { c.parentNode = this; this.children.push(c); }
    },
    get className() { return [...classes].join(" "); },
    set className(v) { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
    get classes() { return classes; },
    querySelector(sel) { return queryFrom(this, sel)[0] || null; },
    querySelectorAll(sel) { return queryFrom(this, sel); },
    closest(sel) { let n = this; while (n) { if (matches(n, sel)) return n; n = n.parentNode; } return null; },
    contains(n) { let p = n; while (p) { if (p === this) return true; p = p.parentNode; } return false; },
    get firstChild() { return this.children[0] || null; },
  };
  Object.defineProperty(el, "id", { get() { return el.attrs.id || ""; }, set(v) { el.attrs.id = String(v); }, configurable: true });
  return el;
}

// Elements with class/style/role attributes, nested, plus text.
function parseHTML(html) {
  const out = [];
  const stack = [{ children: out }];
  const token = /<(\/?)([a-zA-Z0-9]+)((?:"[^"]*"|'[^']*'|[^>"'])*)>|([^<]+)/g;
  let m;
  while ((m = token.exec(html))) {
    if (m[4] !== undefined) {
      if (m[4].trim()) {
        const t = makeEl("#text");
        t._text = m[4];
        const top = stack[stack.length - 1];
        t.parentNode = top;
        top.children.push(t);
      }
      continue;
    }
    if (m[1] === "/") { if (stack.length > 1) stack.pop(); continue; }
    const e = makeEl(m[2]);
    applyAttrs(e, m[3] || "");
    const top = stack[stack.length - 1];
    e.parentNode = top;
    top.children.push(e);
    if (!/^(br|img|input|meta|link|hr)$/i.test(m[2])) stack.push(e);
  }
  return out;
}

function applyAttrs(el, attrs) {
  const re = /([a-zA-Z0-9:-]+)(?:="([^"]*)")?/g;
  let m;
  while ((m = re.exec(attrs))) {
    const k = m[1].toLowerCase();
    const v = m[2] === undefined ? "" : m[2];
    el.attrs[k] = v;
    if (k === "class") v.split(/\s+/).filter(Boolean).forEach((c) => el.classes.add(c));
    if (k === "style") el.style = v;
    if (k === "value") el.value = v;
    if (k === "selected") el.selected = true;
    if (k.startsWith("data-")) el.dataset[k.slice(5)] = v;
  }
}

function matches(el, sel) {
  if (!sel) return false;
  if (sel.startsWith("#")) return el.id === sel.slice(1);
  if (sel.startsWith(".")) return el.classes.has(sel.slice(1));
  if (sel.startsWith("[")) {
    const m = sel.match(/^\[([^\]=]+)(?:="([^"]*)")?\]$/);
    if (!m) return false;
    const v = el.attrs[m[1]];
    return m[2] === undefined ? v !== undefined : v === m[2];
  }
  return el.tagName === sel.toUpperCase();
}

function queryFrom(root, sel) {
  const parts = sel.split(",").map((s) => s.trim()).filter(Boolean);
  const out = [];
  (function walk(n) {
    for (const c of n.children) {
      if (parts.some((p) => matches(c, p.split(/\s+/).pop()))) out.push(c);
      walk(c);
    }
  })(root);
  return out;
}

function mount(opts = {}) {
  const broken = !!opts.brokenStorage;
  const store = opts.store || {};
  const throwErr = (name) => { const e = new Error(name); e.name = name; throw e; };

  const document = {
    body: makeEl("body"),
    head: makeEl("head"),
    documentElement: makeEl("html"),
    createElement: (t) => makeEl(t),
    _extra: [],
    _listeners: {},
    getElementById(id) { return this.body.querySelector("#" + id) || this._extra.find((e) => e.id === id) || null; },
    querySelector(sel) { return this.body.querySelector(sel) || this._extra.find((e) => matches(e, sel)) || null; },
    querySelectorAll(sel) { return [...queryFrom(this.body, sel), ...this._extra.filter((e) => matches(e, sel))]; },
    addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
    removeEventListener() {},
    fire(ev) { (this._listeners[ev] || []).forEach((fn) => fn({ type: ev })); },
  };

  function add(sel) {
    const m = sel.match(/^([#.])(.+)$/);
    const e = makeEl(sel.startsWith("#") ? "div" : "button");
    if (m && sel.startsWith("#")) e.id = m[2];
    else if (m) { e.classes.add(m[2]); e.setAttribute("data-go", "/survey"); }
    document.body.appendChild(e);
    document._extra.push(e);
    return e;
  }

  const localStorage = broken
    ? {
        getItem: () => throwErr("SecurityError"),
        setItem: () => throwErr("QuotaExceededError"),
        removeItem: () => throwErr("SecurityError"),
      }
    : {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
      };

  const window = {
    document,
    location: { hash: "", search: "", href: "http://localhost:8000/", origin: "http://localhost:8000", hostname: "localhost" },
    localStorage,
    addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
    removeEventListener() {},
    _listeners: {},
    fire(ev) { (this._listeners[ev] || []).forEach((fn) => fn({ type: ev })); },
    scrollTo() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    navigator: { userAgent: "node", language: "en" },
    setTimeout: (fn) => { try { fn(); } catch (e) {} return 0; },
    clearTimeout() {},
    fetch: () => Promise.reject(new Error("offline")),
    URLSearchParams,
    console,
    speechSynthesis: undefined,
    requestAnimationFrame: (fn) => { try { fn(); } catch (e) {} },
  };
  window.window = window;
  window.self = window;
  window.globalThis = window;

  const ctx = vm.createContext(window);
  const run = (f) => vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx, { filename: f });

  for (const f of SCRIPTS) if (fs.existsSync(path.join(ROOT, f))) run(f);
  for (const sel of BOOT_ELEMENTS) add(sel);
  run("app.js");

  return {
    window,
    document,
    ctx,
    store,
    fire: (ev) => document.fire(ev),
    openSurvey() {
      document.fire("DOMContentLoaded");
      window.location.hash = "#/survey";
      window.fire("hashchange");
      return document.body.querySelector("#survey-root");
    },
    root: () => document.body.querySelector("#survey-root"),
  };
}

module.exports = { mount, makeEl };
