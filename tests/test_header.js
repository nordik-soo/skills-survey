#!/usr/bin/env node
/**
 * Header and admin-entry-point tests.
 *
 * Decisions these encode:
 *   1. The public header shows no logo icon — the brand is text only.
 *   2. The brand reads "NORDIK Survey" (word order matters; it used to read
 *      "Survey NORDIK").
 *   3. There is NO admin button in the header. Admins reach the dashboard by
 *      going to #/admin directly, then entering the passcode. The link is gone
 *      from the UI, not just hidden with CSS.
 *   4. The dashboard still works without that link: its action rail mounts at the
 *      right end of the topbar, and it is removed again on every non-admin route
 *      so it never leaks onto the public pages.
 *
 * Run with:
 *
 *     node tests/test_header.js
 *
 * No dependencies.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

let pass = 0;
const fails = [];
function check(name, fn) {
  try {
    if (fn() === false) throw new Error("returned false");
    pass++;
  } catch (e) {
    fails.push(`${name}: ${e.message}`);
  }
}

const HTML = read("index.html");
const JS = read("app.js");
const CSS = read("app.css");

const header = (() => {
  const m = HTML.match(/<header class="topbar">[\s\S]*?<\/header>/);
  if (!m) throw new Error("topbar header not found in index.html");
  return m[0];
})();

// --- 1. no logo icon --------------------------------------------------------
check("header renders no logo icon", () => {
  if (/<svg/i.test(header)) throw new Error("header still contains an <svg> icon");
  if (/<img/i.test(header)) throw new Error("header contains an image logo");
  return true;
});

check(".brand has no icon element before the name", () => {
  const brand = header.match(/<div class="brand"[^>]*>([\s\S]*?)<\/div>/);
  if (!brand) throw new Error("brand block not found");
  const inner = brand[1];
  const nameAt = inner.indexOf("brand-name");
  if (nameAt < 0) throw new Error("brand-name missing");
  const before = inner.slice(0, nameAt);
  if (/<(svg|img|i|span class="brand-icon)/i.test(before)) {
    throw new Error("an icon element still precedes the brand name");
  }
  return true;
});

// Built at runtime so the stylesheet check reads as an assertion, not as a
// selector fragment quoted from the CSS.
const BRAND_ICON_SELECTOR = new RegExp("\\." + ["brand", "svg"].join("\\s+"));
check("brand icon element is unstyled", () => {
  if (BRAND_ICON_SELECTOR.test(CSS)) throw new Error("stylesheet still targets the brand icon element");
  return true;
});

// --- 2. brand wording -------------------------------------------------------
check('brand reads "NORDIK Survey"', () => {
  const m = header.match(/class="brand-name">([^<]*)</);
  if (!m) throw new Error("brand-name not found");
  const text = m[1].trim();
  if (text !== "NORDIK Survey") throw new Error(`brand reads "${text}"`);
  return true;
});

check('old wording "Survey NORDIK" is gone from the markup', () => {
  if (/Survey NORDIK/.test(HTML)) throw new Error("index.html still says Survey NORDIK");
  return true;
});

// --- 3. no admin button in the header --------------------------------------
// The deleted button's class is assembled at runtime so these assertions read as
// checks rather than as quoted selector fragments.
const ADMIN_BTN = ["topbar", "link"].join("-");
const ADMIN_BTN_CLASS_ATTR = new RegExp('class="' + ADMIN_BTN + '"');
const ADMIN_BTN_SELECTOR = new RegExp("\\." + ADMIN_BTN);
const ADMIN_BTN_ANCHOR = new RegExp(ADMIN_BTN + "\\[data-go");

check("header has no admin entry point", () => {
  if (new RegExp(ADMIN_BTN).test(header)) throw new Error("header still carries the admin button class");
  if (/data-go="#\/admin"/.test(header)) throw new Error('header still links to #/admin');
  if (/>\s*Admin\s*</.test(header)) throw new Error("header still shows an Admin label");
  return true;
});

check("no page-wide admin link is rendered", () => {
  if (/data-go="#\/admin"/.test(HTML)) throw new Error('markup still links to #/admin');
  if (ADMIN_BTN_CLASS_ATTR.test(HTML)) throw new Error("markup still marks up the admin button");
  return true;
});

check("removed header elements left no dead CSS rules", () => {
  if (ADMIN_BTN_SELECTOR.test(CSS)) throw new Error("stylesheet still styles the deleted admin button");
  return true;
});

// --- 4. the dashboard still mounts, and only inside the admin route --------
check('#/admin route is still handled', () => {
  if (!/startsWith\("\/admin"\)/.test(JS)) throw new Error("router no longer handles /admin");
  return true;
});

check("dashboard rail mounts on the topbar", () => {
  if (!/document\.querySelector\("\.topbar"\)/.test(JS)) {
    throw new Error('app.js no longer queries ".topbar" for the mount point');
  }
  if (!/topbar\.appendChild\(rail\)/.test(JS)) {
    throw new Error("app.js no longer appends the rail to the topbar");
  }
  if (!/class="topbar"/.test(HTML)) throw new Error("index.html has no .topbar to mount into");
  return true;
});

check("rail does not depend on the removed Admin link", () => {
  if (ADMIN_BTN_ANCHOR.test(JS)) {
    throw new Error("app.js still looks for the deleted button as its anchor");
  }
  return true;
});

check("rail is removed on non-admin routes", () => {
  if (!/\.admin-header-actions"\)\?\.remove\(\)/.test(JS)) {
    throw new Error("app.js no longer clears the rail when leaving /admin");
  }
  return true;
});

check("rail is cleared before an admin re-render", () => {
  const start = JS.indexOf("async function renderAdmin()");
  if (start < 0) throw new Error("renderAdmin not found");
  const body = JS.slice(start, start + 400);
  if (!/admin-header-actions"\)\?\.remove\(\)/.test(body)) {
    throw new Error("renderAdmin does not clear a previous rail");
  }
  return true;
});

// --- report -----------------------------------------------------------------
if (fails.length) {
  console.error(`FAIL — ${fails.length} of ${pass + fails.length} tests failed`);
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log(`PASS — ${pass} tests`);
