#!/usr/bin/env node
/**
 * The nine-language survey works end to end.
 *
 * English is the source text. The other eight languages come from the uploaded
 * masters in Translation-8-languages/, extracted by
 * tools/build_lang8_docx_fixture.py and compiled into translations.js by
 * tools/build_translations.js. This file checks the result the way a respondent
 * meets it: pick a language in the header and every surface — question, option,
 * tooltip, homepage, consent letter, button — is in that language, with no
 * English left behind and Arabic laid out right-to-left.
 *
 * Run: node tests/test_languages8.js
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

const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

// ── load the app data and the dictionaries ────────────────────────────────
const dctx = { window: {}, console };
dctx.global = dctx;
vm.createContext(dctx);
vm.runInContext(read("survey-data.js"), dctx, { filename: "survey-data.js" });
const SURVEY = dctx.window.SURVEY;
const QUESTIONS = SURVEY.QUESTIONS;

const ictx = { window: {}, console };
ictx.global = ictx;
vm.createContext(ictx);
vm.runInContext(read("translations.js"), ictx, { filename: "translations.js" });
const I18N = ictx.window.I18N;

const LANGS = ["en", "es", "fr", "hi", "it", "pt", "ar", "zh", "tl"];
const NON_EN = LANGS.slice(1);
const D = (code) => I18N.dicts[code];

const optionLabel = (q, o) => (typeof o === "string" ? o : o.label || o.value);

// A bracketed note is a reviewer instruction, a routing rule or a placeholder.
// The uploaded masters carry hundreds of them; none may reach a respondent.
// Markdown links — "[Survey Information Letter](#letter-info)" — are not notes
// and are stripped before the check.
const stripLinks = (s) => String(s).replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
const hasNote = (s) => /\[[^\]]*\]/.test(stripLinks(s));

// Every literal the UI passes through S() must have a translation, or a
// non-English respondent sees English.
function sLiterals() {
  const src = read("app.js");
  const out = new Set();
  const re = /\bS\("((?:[^"\\]|\\.){1,200})"\)/g;
  let m;
  while ((m = re.exec(src))) out.add(m[1]);
  return [...out];
}

const PROVINCES = new Set([
  "Alberta", "British Columbia", "Manitoba", "New Brunswick",
  "Newfoundland and Labrador", "Northwest Territories", "Nova Scotia",
  "Nunavut", "Ontario", "Prince Edward Island", "Quebec", "Saskatchewan", "Yukon",
]);
const AGE_RANGE = /^\d{1,2}\s*[-–]\s*\d{1,2}$/;
const COUNTRIES = new Set(
  ((QUESTIONS.find((q) => q.id === "country_moved_from") || {}).options || []).map((o) => optionLabel(null, o))
);

// ── the invariant every test below ends with ──────────────────────────────
// The compiled dictionaries must agree with the questionnaire they describe:
// every question present, every option covered, nothing bracketed, and every
// page-direction flag consistent with the language.
function assertDictionariesSound() {
  assert(JSON.stringify(I18N.LANGS) === JSON.stringify(LANGS), "languages are " + JSON.stringify(I18N.LANGS));
  for (const code of NON_EN) {
    const d = D(code);
    assert(Object.keys(d.q).length === QUESTIONS.length,
      `${code}: ${Object.keys(d.q).length}/${QUESTIONS.length} questions`);
    for (const q of QUESTIONS) {
      const text = d.q[q.id];
      assert(text && text.trim(), `${code}: ${q.id} has no translated text`);
      assert(!hasNote(text), `${code}: ${q.id} still carries a bracketed note: ${text.slice(0, 60)}`);
      for (const o of q.options || []) {
        const label = optionLabel(q, o);
        const tr = d.o[label];
        assert(tr, `${code}: option "${label}" of ${q.id} is untranslated`);
        assert(!hasNote(tr), `${code}: option "${label}" carries a bracketed note`);
      }
    }
  }
}

// ── 1. nine languages are offered ─────────────────────────────────────────
check("nine languages with native names, Arabic the only RTL one", () => {
  assert(LANGS.length === 9, "expected nine languages");
  for (const code of LANGS) {
    assert(I18N.NATIVE_NAMES[code], "no native name for " + code);
    assert(I18N.NATIVE_NAMES[code] !== code, code + " is labelled with its code instead of its name");
  }
  assert(JSON.stringify(I18N.RTL) === JSON.stringify(["ar"]), "RTL languages are " + JSON.stringify(I18N.RTL));
  assertDictionariesSound();
});

// ── 2. every question and option is translated ────────────────────────────
check("all 77 questions and every option are translated in all eight", () => {
  assertDictionariesSound();
  assert(QUESTIONS.length === 77, "the questionnaire has " + QUESTIONS.length + " questions");
});

check("no question text is left in English", () => {
  for (const code of NON_EN) {
    for (const q of QUESTIONS) {
      assert(D(code).q[q.id] !== (typeof q.text === "function" ? q.text({}) : q.text),
        `${code}: ${q.id} is identical to the English text`);
    }
  }
  assertDictionariesSound();
});

// ── 3. wording really comes from the uploaded masters ─────────────────────
// Comparing against English would flag legitimate coincidences ("Diploma" is
// the Spanish word too), so instead every translated string must appear
// verbatim in that language's uploaded file. That is what "byte identical to
// the uploads" means, and it cannot pass if anything was invented or fell back.
check("question and option wording appears verbatim in the uploaded file", () => {
  const fx = JSON.parse(read("tests/fixtures/lang8-docx.json"));
  for (const code of NON_EN) {
    const d = D(code);
    const f = fx[code];
    assert(f, "no extracted content for " + code);
    const hay = new Set();
    for (const list of Object.values(f.o || {})) for (const s of list) hay.add(String(s).trim());
    for (const s of Object.values(f.q || {})) hay.add(String(s).trim());
    // The consent and eligibility blocks live in the homepage section of the
    // masters, not in a question, so their wording comes from there.
    for (const s of f.home || []) hay.add(String(s).trim());

    for (const [label, value] of Object.entries(d.o)) {
      // Country names are authored (the masters only say "See Picklist 1") and
      // are checked by their own test below.
      if (COUNTRIES.has(label)) continue;
      assert(hay.has(value.trim()), `${code}: option "${label}" -> "${value}" is not in the uploaded file`);
    }
    // The masters line-wrap and double-space, so the prefix test below compares
    // whitespace-collapsed forms.
    const hayNorm = new Set([...hay].map((s) => s.replace(/\s+/g, " ").trim()));
    for (const [id, value] of Object.entries(d.q)) {
      // The consent sentence is the one string the build edits, to re-attach the
      // links to the letter and the consent card that the .docx stores as
      // hyperlink objects (their text is invisible to paragraph extraction).
      if (id === "consent") continue;
      if (COUNTRIES.size && !hay.size) continue;
      const plainValue = value.replace(/<[^>]*>/g, "").trim();
      // The question whose 1–5/0 scale is rendered as its English help line keeps
      // only its question sentence from the master, so the scale stops printing
      // twice (client decision, Picklist 4 review). It must still be the master's
      // own opening wording — a prefix, never a re-wording — and the only thing
      // dropped must be that scale.
      const q = QUESTIONS.find((x) => x.id === id);
      if (q && q.help) {
        const want = plainValue.replace(/\s+/g, " ").trim();
        const host = [...hayNorm].filter((s) => s.startsWith(want) && s.length > want.length);
        assert(host.length, `${code}: question "${id}" is not the opening of its uploaded line`);
        assert(host.some((s) => /(^|\s)1\s*[–—−=]\s*\S/.test(s.slice(want.length))),
          `${code}: question "${id}" dropped more than its answer scale: ${JSON.stringify(host[0].slice(want.length, want.length + 40))}`);
        continue;
      }
      assert(hay.has(plainValue), `${code}: question "${id}" -> "${plainValue.slice(0, 50)}" is not in the uploaded file`);
    }
  }
  assertDictionariesSound();
});

// ── 4. tooltips ───────────────────────────────────────────────────────────
check("every renderable tooltip is translated and none is English", () => {
  const defs = SURVEY.DEFINITIONS;
  const skillDefs = SURVEY.SKILL_DEFINITIONS;
  // A term only ever renders as a tooltip when it is also an option label, so
  // the three keys that match no option can never be shown (and are skipped).
  const allOpts = new Set();
  for (const q of QUESTIONS) for (const o of q.options || []) allOpts.add(optionLabel(q, o));
  const renderable = Object.keys(defs).filter((t) => allOpts.has(t));
  assert(renderable.length === 41, "expected 41 renderable tooltips, found " + renderable.length);

  for (const code of NON_EN) {
    const d = D(code);
    let covered = 0;
    for (const term of renderable) {
      const tr = d.def[term];
      if (!tr) continue;
      covered++;
      assert(tr !== term, `${code}: tooltip "${term}" was copied from English`);
      assert(!hasNote(tr), `${code}: tooltip "${term}" carries a bracketed note`);
    }
    // French groups two of them under its own wording; everything else is full.
    const floor = code === "fr" ? 39 : 41;
    assert(covered >= floor, `${code}: only ${covered}/${renderable.length} tooltips translated`);
    let skills = 0;
    for (const name of Object.keys(skillDefs)) {
      const tr = d.def[name];
      if (tr) { skills++; assert(!hasNote(tr), `${code}: skill definition "${name}" carries a bracketed note`); }
    }
    assert(skills === 33, `${code}: only ${skills}/33 skill definitions translated`);
  }
  // A missing tooltip must disappear rather than fall back to English: tDef()
  // has to return null in a non-English language.
  assert(/return \(d\.def && d\.def\[term\]\) \|\| null;/.test(read("app.js")),
    "tDef() falls back to the English tooltip");
  assertDictionariesSound();
});

// ── 5. countries ──────────────────────────────────────────────────────────
check("all 195 countries are translated in all eight", () => {
  const countryQ = QUESTIONS.find((q) => q.id === "country_moved_from");
  const countries = (countryQ.options || []).map((o) => optionLabel(countryQ, o));
  assert(countries.length === 195, "the app lists " + countries.length + " countries");
  for (const code of NON_EN) {
    const d = D(code);
    let translated = 0;
    for (const c of countries) {
      const tr = d.o[c];
      assert(tr, `${code}: country "${c}" is untranslated`);
      if (tr !== c) translated++;
    }
    // Languages that share a script with English keep many exonyms unchanged
    // (Canada, Chile, Argentina); Tagalog keeps most of them. The non-Latin
    // languages must translate every single one.
    const nonLatin = code === "hi" || code === "ar" || code === "zh";
    const floor = nonLatin ? 195 : 20;
    assert(translated >= floor, `${code}: only ${translated} of 195 country names differ from English`);
  }
  assertDictionariesSound();
});

// ── 6. the UI chrome ──────────────────────────────────────────────────────
check("every UI string the app asks for exists in every language", () => {
  const literals = sLiterals();
  assert(literals.length >= 30, "only found " + literals.length + " S() literals");
  for (const code of NON_EN) {
    const ui = D(code).ui;
    const missing = literals.filter((l) => !ui[l]);
    assert(!missing.length, `${code}: no translation for ${JSON.stringify(missing)}`);
  }
  assertDictionariesSound();
});

check("the header button and the homepage are translated", () => {
  for (const code of NON_EN) {
    const d = D(code);
    assert(d.ui["Select language"], code + ": the language button label is missing");
    assert(d.ui["Start the survey"], code + ": the start button label is missing");
    assert(d.home.h1 && d.home.h1.length > 3, code + ": no homepage heading");
    assert(Array.isArray(d.home.hp1) && d.home.hp1.length, code + ": no homepage intro");
    assert(Array.isArray(d.home.hp2) && d.home.hp2.length, code + ": no invitation intro");
    assert(d.home.consentPoints.length === 8, code + ": " + d.home.consentPoints.length + " consent points instead of 8");
    assert(d.home.letter.length >= 20, code + ": the consent letter has " + d.home.letter.length + " blocks");
    assert(d.home.consentQ && d.home.eligQ, code + ": consent/eligibility questions missing");
    for (const block of d.home.letter) {
      const text = block.h || block.p || block.note || (block.lines || []).join(" ");
      assert(!hasNote(text), code + ": the consent letter carries a bracketed note");
    }
  }
  assertDictionariesSound();
});

// ── 7. right-to-left ──────────────────────────────────────────────────────
check("Arabic lays the page out right-to-left and the others left-to-right", () => {
  const ar = mount({ store: { sault_lang_v1: "ar" } });
  ar.openSurvey();
  const html = ar.document.documentElement;
  assert(html.getAttribute("dir") === "rtl", "Arabic direction is " + html.getAttribute("dir"));
  assert(html.getAttribute("lang") === "ar", "Arabic document language is " + html.getAttribute("lang"));

  for (const code of ["es", "fr", "hi", "it", "pt", "zh", "tl"]) {
    const app = mount({ store: { sault_lang_v1: code } });
    app.openSurvey();
    assert(app.document.documentElement.getAttribute("dir") === "ltr", code + " is right-to-left");
  }
  assertDictionariesSound();
});

// ── 8. the picker itself ──────────────────────────────────────────────────
check("the header pill opens the language list directly and switches the survey", () => {
  const app = mount({});
  app.openSurvey();
  const btn = app.document.body.querySelector("#lang-btn");
  assert(btn, "no language button in the header");
  // before anything is chosen the pill is the plain invitation
  assert(btn.textContent === "Select language", "a fresh visitor's pill shows " + JSON.stringify(btn.textContent));
  btn.onclick();

  // One click must land on the language list itself: no intermediate card, no
  // second panel holding the real choice.
  assert(!app.document.querySelector(".lang-overlay"), "clicking the pill opened an overlay");
  assert(!app.document.querySelector(".modal-card"), "clicking the pill opened an intermediate card");
  assert(!app.document.querySelector(".lang-select"), "the choice is hidden behind a second dropdown");

  const menu = app.document.querySelector(".lang-menu");
  assert(menu, "the pill did not open the language list");
  const items = menu.children.filter((c) => c.classes.has("lang-item"));
  assert(items.length === 9, "the list shows " + items.length + " languages");
  const textOf = (n) => (n.tagName === "#TEXT" ? (n._text || "") : (n.children || []).map(textOf).join(""));
  const names = items.map((c) => textOf(c).trim());
  assert(JSON.stringify(names) === JSON.stringify(LANGS.map((c) => I18N.NATIVE_NAMES[c])),
    "list order is " + JSON.stringify(names));

  // choose Spanish the way a respondent would
  const es = items[LANGS.indexOf("es")];
  es.click();
  assert(!app.document.querySelector(".lang-menu"), "the list stayed open after choosing");
  assert(app.store.sault_lang_v1 === "es", "the choice was not stored");
  const text = (function walk(n, out = []) {
    if (n.tagName === "#TEXT" && n._text) out.push(n._text);
    for (const c of n.children || []) walk(c, out);
    return out;
  })(app.root()).join(" ").replace(/\s+/g, " ");
  const expected = D("es").q.consent.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").slice(0, 24);
  assert(text.includes(expected), "the consent screen did not switch to Spanish: " + text.slice(0, 80));
  assert(!/After reading the/.test(text), "English consent text survived the switch");

  // the pill shows only the language now in use — no "Select language ·" prefix
  const after = app.document.body.querySelector("#lang-btn");
  assert(after.textContent === "Español", "the pill shows " + JSON.stringify(after.textContent) + " instead of just Español");
  assert(!after.textContent.includes(D("es").ui["Select language"]), "the pill kept the 'Select language' prefix");
  assert(after.getAttribute("aria-expanded") === "false", "the pill still reports an open list");

  // and Arabic flips the page
  const app2 = mount({});
  app2.openSurvey();
  app2.document.body.querySelector("#lang-btn").onclick();
  const arItems = app2.document.querySelector(".lang-menu").children.filter((c) => c.classes.has("lang-item"));
  arItems[LANGS.indexOf("ar")].click();
  assert(app2.document.documentElement.getAttribute("dir") === "rtl", "switching to Arabic did not flip the page");
  assertDictionariesSound();
});

// ── 9. no English leaks onto a rendered screen ────────────────────────────
check("a rendered screen in each language contains no English sentence", () => {
  const ENGLISH_WORDS = /\b(the|your|you|which|what|please|select|answer|question|survey|consent)\b/i;
  for (const code of NON_EN) {
    const app = mount({ store: { sault_lang_v1: code } });
    app.openSurvey();
    const text = (function walk(n, out = []) {
      if (n.tagName === "#TEXT" && n._text) out.push(n._text);
      for (const c of n.children || []) walk(c, out);
      return out;
    })(app.root()).join(" ");
    const hits = text.split(/(?<=[.?])\s+/).filter((s) => ENGLISH_WORDS.test(s) && s.trim().split(/\s+/).length > 3);
    assert(!hits.length, `${code}: English text on screen: ${JSON.stringify(hits.slice(0, 2))}`);
  }
  assertDictionariesSound();
});

// ── report ─────────────────────────────────────────────────────────────────
if (failures) {
  console.error(`\n${failures} of ${checks} checks FAILED.\n`);
  process.exit(1);
}
console.log(`${checks} checks passed: nine languages, no English fallback, Arabic right-to-left.`);
