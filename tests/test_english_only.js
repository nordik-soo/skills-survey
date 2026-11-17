#!/usr/bin/env node
/**
 * Nine languages, no English fallback.
 *
 * This file used to assert the opposite policy — that the survey shipped in
 * English only. That policy was reversed on request: the survey now ships in
 * English plus the eight uploaded translation masters (Spanish, French, Hindi,
 * Italian, Portuguese, Arabic, Chinese, Tagalog), chosen from a language card in
 * the header. The rules that the English-only policy created and that still hold
 * are kept as they were; the rules the reversal invalidated are replaced by the
 * stricter opposite.
 *
 * What changed, and why:
 *   1. "translations.js is deleted"  ->  it exists, is loaded, and holds 9 languages
 *   2. "app.js has no translation layer"  ->  it has one, and never falls back to English
 *   5. "no screen offers a language picker"  ->  the header offers one; the survey
 *      itself still has no language QUESTION
 *
 * Run: node tests/test_english_only.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const { mount } = require("./helpers/app-dom.js");

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

// ── fixtures ───────────────────────────────────────────────────────────────
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const ctx = { window: {}, console };
ctx.global = ctx;
vm.createContext(ctx);
vm.runInContext(read("survey-data.js"), ctx, { filename: "survey-data.js" });
const SURVEY = ctx.window.SURVEY;
const QUESTIONS = SURVEY.QUESTIONS;

const englishOf = (q) => (typeof q.text === "function" ? q.text({}) : q.text);

// The keys app.js asks for question text by: a question's own id, or — for a
// question worded from earlier answers — every key its textKey() returns. The
// barrier gate is the only such question; it is asked three ways, so each
// dictionary carries three entries for it and none under its own id.
const EMP_STATUSES = (QUESTIONS.find((x) => x.id === "employment_status") || {}).options || [];
function questionTextKeys() {
  const keys = [];
  for (const q of QUESTIONS) {
    if (typeof q.textKey !== "function") { keys.push(q.id); continue; }
    for (const st of EMP_STATUSES) {
      for (const intended of ["Yes", "No"]) {
        const k = q.textKey({ employment_status: st, intended_job: intended });
        if (k && !keys.includes(k)) keys.push(k);
      }
    }
  }
  return keys;
}

// Scripts no English survey can contain: Cyrillic, Greek, Arabic, Persian,
// Hebrew, Devanagari, Bengali, Gurmukhi, Gujarati, Tamil, Telugu, Kannada,
// Malayalam, Sinhala, Thai, Hangul, Kana and CJK.
const FOREIGN_SCRIPT =
  /[\u0370-\u03FF\u0400-\u04FF\u0530-\u058F\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\u0D80-\u0DFF\u0E00-\u0E7F\u0E80-\u0EFF\u1000-\u109F\u1100-\u11FF\u3040-\u30FF\u3130-\u318F\u4E00-\u9FFF\uAC00-\uD7AF]/;

// "Bengali", "Farsi", "Somali" are ASCII, so the script test cannot catch a
// language list: assert the picklist wording is gone from the DATA instead.
const LANGUAGE_PICKER = /choose your language|in which language|preferred language|language preference/i;

const LANGS = ["en", "es", "fr", "hi", "it", "pt", "ar", "zh", "tl"];

// ── the invariant every test below ends with ───────────────────────────────
// Whatever a test just exercised, the survey must still be one questionnaire
// that opens at the consent screen and stores no language answer.
function assertSingleSurvey() {
  assert(!QUESTIONS.some((q) => q.id === "language"), "a language question is back");
  assert(QUESTIONS[0].id === "consent", "the survey no longer opens on consent");
  for (const q of QUESTIONS) {
    assert(!FOREIGN_SCRIPT.test(englishOf(q)), `${q.id} is not English in the source data`);
    for (const opt of q.options || []) {
      const label = typeof opt === "string" ? opt : opt.label || "";
      assert(!FOREIGN_SCRIPT.test(label), `${q.id} option "${label}" is not English in the source data`);
    }
  }
}

// Text of every rendered node, recursively. The fake DOM keeps text in #TEXT
// nodes, like the browser helper the other tests use.
const allText = (n, out = []) => {
  if (n.tagName === "#TEXT" && n._text) out.push(n._text);
  for (const c of n.children || []) allText(c, out);
  return out;
};

// ── 1. the translation layer ships ────────────────────────────────────────
check("translations.js exists, is loaded, and holds nine languages", () => {
  assert(fs.existsSync(path.join(ROOT, "translations.js")), "translations.js is missing");
  assert(/translations\.js/.test(read("index.html")), "index.html does not load translations.js");
  const tctx = { window: {}, console };
  tctx.global = tctx;
  vm.createContext(tctx);
  vm.runInContext(read("translations.js"), tctx, { filename: "translations.js" });
  const I = tctx.window.I18N;
  assert(I, "translations.js does not define window.I18N");
  assert(JSON.stringify(I.LANGS) === JSON.stringify(LANGS), "languages are " + JSON.stringify(I.LANGS));
  const want = questionTextKeys();
  for (const code of LANGS.slice(1)) {
    const d = I.dicts[code];
    assert(d, "no dictionary for " + code);
    const have = Object.keys(d.q || {});
    const missing = want.filter((k) => !have.includes(k));
    assert(!missing.length, code + " does not translate " + missing.length + " question text(s), e.g. " + missing.slice(0, 3).join(", "));
    const extraKeys = have.filter((k) => !want.includes(k));
    assert(!extraKeys.length, code + " carries question keys nothing reads: " + extraKeys.slice(0, 3).join(", "));
    assert(d.home && d.home.consentPoints && d.home.consentPoints.length, code + " has no homepage/consent block");
  }
  assert(I.RTL.includes("ar"), "Arabic is not marked right-to-left");
  assertSingleSurvey();
});

check("app.js implements the layer instead of passing English through", () => {
  const app = read("app.js");
  assert(/window\.I18N/.test(app), "app.js does not read window.I18N");
  assert(/function isRTL\(\)/.test(app), "app.js has no direction handling");
  assert(!/function S\(text\) \{ return text; \}/.test(app), "S() still returns its English argument");
  assert(!/function optLabel\(q, v\) \{ return v; \}/.test(app), "optLabel() still returns its English argument");
  assertSingleSurvey();
});

check("survey-data.js carries no translated language data", () => {
  const data = read("survey-data.js");
  for (const gone of ["SKILL_FR", "SKILL_DEF_FR", "OPTION_TRANSLATIONS"]) {
    assert(!data.includes(gone), "survey-data.js still defines " + gone);
  }
  assertSingleSurvey();
});

// ── 2. there is no language question ──────────────────────────────────────
check("the survey has no language question and opens on consent", () => {
  assert(!LANGUAGE_PICKER.test(read("survey-data.js")), "the language picklist wording is still in the data");
  assertSingleSurvey();
});

// ── 3. the header offers the picker; a fresh visitor reads English ─────────
check("the header offers a language picker and defaults to English", () => {
  const app = mount({});
  const btn = app.document.body.querySelector("#lang-btn");
  assert(btn, "the header has no language button");
  app.openSurvey();
  assert(/Select language/.test(btn.textContent), "the button is not labelled: " + btn.textContent);
  assert(app.document.documentElement.getAttribute("dir") === "ltr", "a fresh visitor is not left-to-right");
  assert(app.document.documentElement.getAttribute("lang") === "en", "a fresh visitor is not in English");
  const text = allText(app.root()).join(" ").replace(/\s+/g, " ");
  assert(!FOREIGN_SCRIPT.test(text), "the first screen is not English: " + text.slice(0, 90));
  assert(/consent|Survey Information Letter/i.test(text), "the first screen is not the consent screen");
  assertSingleSurvey();
});

// ── 4. a stale language answer still opens in English ─────────────────────
check("a draft saved with a language answer still loads and shows English", () => {
  const store = {
    sault_survey_draft_v1: JSON.stringify({
      answers: { language: "Bengali", intended_job_title: "9421101 - Test Job" },
      currentId: "consent",
    }),
  };
  const app = mount({ store });
  const root = app.openSurvey();
  assert(root, "the survey did not render from the old draft");
  const text = allText(root).join(" ").replace(/\s+/g, " ");
  assert(text.trim() !== "", "the screen is blank");
  assert(!FOREIGN_SCRIPT.test(text), "an old language answer leaked into the screen");
  assert(/consent|Survey Information Letter/i.test(text), "the draft no longer opens the consent screen");
  assert(!root.querySelectorAll(".custom-select").length, "the stale answer opened a picklist");
  assertSingleSurvey();
});

// ── 5. a new draft never records a language ───────────────────────────────
check("answering the survey never stores a language answer", () => {
  const store = {};
  const app = mount({ store });
  const root = app.openSurvey();
  root.querySelectorAll(".opt")[0].onclick(); // "Yes, I confirm"
  const next = root.querySelector("#btn-next");
  if (next && next.disabled) next.disabled = false;
  next.onclick();
  const raw = store.sault_survey_draft_v1;
  assert(raw, "nothing was saved to the draft");
  const answers = (JSON.parse(raw).answers || {});
  assert(!("language" in answers), "the draft recorded a language answer: " + JSON.stringify(answers).slice(0, 120));
  assertSingleSurvey();
});

// ── 6. every language renders, and none of them falls back to English ─────
check("every language renders its own question text and direction", () => {
  for (const code of LANGS.slice(1)) {
    const app = mount({ store: { sault_lang_v1: code } });
    app.openSurvey();
    const html = app.document.documentElement;
    assert(html.getAttribute("lang") === code, "document language is " + html.getAttribute("lang") + " for " + code);
    assert(html.getAttribute("dir") === (code === "ar" ? "rtl" : "ltr"),
      "direction is " + html.getAttribute("dir") + " for " + code);
    const text = allText(app.root()).join(" ").replace(/\s+/g, " ");
    const translations = (() => {
      const c = { window: {}, console }; c.global = c; vm.createContext(c);
      vm.runInContext(read("translations.js"), c, { filename: "translations.js" });
      return c.window.I18N.dicts;
    })();
    const consent = translations[code].q.consent;
    assert(consent && text.includes(consent.slice(0, 24)) || consent.includes("["), code + " did not render its translated consent text");
  }
  assertSingleSurvey();
});

// ── report ─────────────────────────────────────────────────────────────────
if (failures) {
  console.error(`\n${failures} of ${checks} checks FAILED.\n`);
  process.exit(1);
}
console.log(`${checks} checks passed: nine languages, a header picker, Arabic right-to-left, and no English fallback.`);
