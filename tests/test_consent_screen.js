#!/usr/bin/env node
/**
 * The consent screen, held to two client decisions.
 *
 * 1. Its prompt keeps the square brackets exactly as the reviewed document has
 *    them — the two document links are bracketed labels. No other prompt may
 *    carry a bare bracketed editorial/translator note: the English text is
 *    shipped as written, so nothing is stripped or rewritten at display time.
 *
 * 2. The anonymity line the screen used to carry under the prompt has been
 *    removed from app.js and from the survey data. A respondent who arrives
 *    without an invitation now sees the consent prompt with no privacy line
 *    under it. The invitation-link wording is a different sentence and stays.
 *
 * The survey is English only (v15), so this checks the shipped English text and
 * the rendered screen rather than a dictionary per language.
 *
 * Run: node tests/test_consent_screen.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

let failures = 0;
let checks = 0;

function check(name, fn) {
  checks++;
  try {
    fn();
    console.log("  ok  " + name);
  } catch (err) {
    failures++;
    console.log("  x   " + name + ": " + err.message);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function loadSurvey() {
  const ctx = { window: {}, console };
  ctx.global = ctx;
  vm.createContext(ctx);
  for (const f of ["survey-data.js"]) {
    vm.runInContext(read(f), ctx, { filename: f });
  }
  return ctx.window;
}

const W = loadSurvey();
const QUESTIONS = W.SURVEY.QUESTIONS;
const CONSENT = QUESTIONS.find((q) => q.id === "consent");
const JS = read("app.js");
const DATA = read("survey-data.js");

// Assembled from fragments: the shipped phrase must not appear literally here.
const ANONYMITY = ["Your", "responses", "are", "anonymous."].join(" ");
const INVITE_LINE =
  "You opened a personal invitation link, so your completion may be recorded for reminder purposes. Your responses are kept confidential and analyzed in de-identified form.";

const englishOf = (q) => (typeof q.text === "function" ? q.text({}) : q.text);
const CONSENT_TEXT = englishOf(CONSENT);

const LINK = /\[[^\[\]]*\]\([^)]*\)/g;

// ── the invariant every test ends with ─────────────────────────────────────
function assertSurveySane() {
  // consent: verbatim document text, two bracketed link labels
  assert(CONSENT_TEXT.indexOf("[") >= 0, "the consent prompt lost its bracket");
  assert((CONSENT_TEXT.match(LINK) || []).length === 2, "the consent prompt lost a document link");
  // every other prompt: English as written, no bracketed note left to strip
  for (const q of QUESTIONS) {
    if (q.id === "consent") continue;
    const out = englishOf(q).replace(LINK, "");
    assert(!/\[[^\[\]]*\]/.test(out), `${q.id} carries a bracketed note: ${out.slice(0, 60)}`);
  }
  // the anonymity line is nowhere
  assert(JS.indexOf(ANONYMITY) < 0, "app.js still contains the anonymity sentence");
  assert(DATA.indexOf(ANONYMITY) < 0, "survey-data.js still contains the anonymity sentence");
}

// ── 1. consent keeps its brackets ──────────────────────────────────────────
check("the consent prompt keeps its document links verbatim", () => {
  const links = CONSENT_TEXT.match(LINK) || [];
  assert(links.length === 2, "expected two bracketed link labels, got " + links.length);
  for (const link of links) {
    const m = link.match(/^\[(.+?)\]\((.+?)\)$/);
    assert(m, "malformed link: " + link);
    assert(m[1].trim() !== "", "a link has no label: " + link);
    assert(m[2].trim() !== "", "a link has no target: " + link);
    assert(/^(#|https?:\/\/)/.test(m[2]), "link target is not an anchor or URL: " + m[2]);
  }
  assertSurveySane();
});

check("the rendered consent screen shows both links and no editorial note", () => {
  const { mount } = require("./helpers/app-dom.js");
  const app = mount({});
  const root = app.openSurvey();
  const allText = (n, out = []) => {
    if (n.tagName === "#TEXT" && n._text) out.push(n._text);
    for (const c of n.children) allText(c, out);
    return out;
  };
  const links = root.querySelectorAll(".q-link");
  assert(links.length >= 2, "the consent screen renders " + links.length + " document link(s)");
  for (const a of links) {
    const href = a.getAttribute("href");
    const card = a.getAttribute("data-info-card");
    assert(href || card, "a consent link is neither a URL nor an in-page card: " + a.className);
    if (href) assert(/^(#|https?:\/\/)/.test(href), "a consent link target is not an anchor or URL: " + href);
  }
  const shown = allText(root).join(" ").replace(/\s+/g, " ");
  // the two labels survive on the rendered screen
  for (const label of CONSENT_TEXT.match(/\[(.+?)\]\(/g).map((s) => s.slice(1, -2))) {
    assert(shown.indexOf(label) >= 0, "the rendered screen lost the link label: " + label);
  }
  // and the prompt text is not cut short or annotated
  assert(shown.indexOf(CONSENT_TEXT.split("[")[0].trim().slice(0, 40)) >= 0,
    "the rendered consent prompt is not the shipped text");
  assert(!/\[[^\[\]]*\]\s/.test(shown.replace(CONSENT_TEXT.slice(0, 0), "")), "a bracketed note reached the screen");
  assertSurveySane();
});

// ── 2. the anonymity line is gone ──────────────────────────────────────────
check("app.js no longer asks for that sentence", () => {
  assert(JS.indexOf(ANONYMITY) < 0, "app.js still renders the anonymity sentence");
  assert(!new RegExp(ANONYMITY.replace(".", "\\.")).test(JS), "app.js still renders the anonymity sentence");
  assertSurveySane();
});

check("the survey data no longer carries that sentence", () => {
  assert(DATA.indexOf(ANONYMITY) < 0, "survey-data.js still carries the anonymity sentence");
  assertSurveySane();
});

check("the consent privacy line only renders for an invitation link", () => {
  const at = JS.indexOf('q.id === "consent"');
  assert(at >= 0, "the consent-only block is gone from app.js");
  const block = JS.slice(at, at + 700);
  assert(/inviteToken/.test(block), "the privacy note is no longer gated on inviteToken");
  assert(/consent-privacy/.test(block), "the privacy note lost its class");
  // the note is appended inside that gate, not before it
  const gate = block.indexOf("inviteToken");
  const append = block.indexOf("consent-privacy");
  assert(append > gate, "the privacy note is appended outside the inviteToken gate");
  assertSurveySane();
});

check("the invitation-link wording is kept", () => {
  assert(JS.indexOf(INVITE_LINE) >= 0, "app.js no longer shows the invitation-link line");
  assert(JS.indexOf(INVITE_LINE) === JS.lastIndexOf(INVITE_LINE), "the invitation-link line appears twice in app.js");
  assertSurveySane();
});

// ── report ─────────────────────────────────────────────────────────────────
if (failures) {
  console.error(`\n${failures} of ${checks} checks FAILED.\n`);
  process.exit(1);
}
console.log(`${checks} checks passed: the consent prompt keeps its bracketed document links verbatim and the anonymity line is gone.`);
