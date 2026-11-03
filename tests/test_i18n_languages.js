#!/usr/bin/env node
/**
 * Spec tests for the v12 translation layer (translations.js).
 *
 * Decisions these encode (v12 final):
 *   1. The survey offers exactly 18 languages: English + 17 reviewed translations.
 *   2. Finnish, Kurdish, Malayalam and Polish are removed COMPLETELY — no language
 *      code, no native name, no dictionary. Nothing can select them any more.
 *   3. Country names, NOC/OaSIS occupations, CIP areas of study and skill names
 *      stay ENGLISH in all 18 languages (including Bengali).
 *
 * Run with:
 *
 *     node tests/test_i18n_languages.js
 *
 * No dependencies — survey-data.js and translations.js are loaded into a bare vm
 * context so this runs anywhere node runs.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");

function loadAll() {
  const ctx = { window: {}, console };
  ctx.global = ctx;
  vm.createContext(ctx);
  for (const f of ["noc-data.js", "cip-data.js", "survey-data.js", "translations.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx, { filename: f });
  }
  return ctx.window;
}

const W = loadAll();
const SURVEY = W.SURVEY;
const I18N = W.I18N;
const Q = SURVEY.QUESTIONS;
const byId = (id) => Q.find((q) => q.id === id);

// ── tiny harness ─────────────────────────────────────────────────────────
let passed = 0;
const failures = [];
function eq(actual, expected, what) {
  if (actual !== expected) {
    throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function deepEq(actual, expected, what) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${what || "value"}:\n  expected ${b}\n  actual   ${a}`);
}
function ok(cond, what) {
  if (!cond) throw new Error(what || "expected truthy");
}

// ── the invariant checker ────────────────────────────────────────────────
// Rules that must hold in EVERY state of the translation layer. Runs after each
// test, so a test that breaks a global rule fails even if it only meant to check
// something narrower.
const REMOVED = ["Finnish", "Kurdish", "Malayalam", "Polish"];
const REMOVED_CODES = ["fi", "ku", "ml", "pl"];
const LANG_Q = byId("language");

function pickerNames() {
  return LANG_Q.options.map((o) => (o && o.label ? o.label : o));
}
function codes() {
  return Object.values(I18N.LANG_CODES);
}

function checkInvariants() {
  const names = Object.keys(I18N.LANG_CODES);
  const codeVals = codes();
  const picker = pickerNames();

  // (a) exactly 18 languages, English included
  eq(codeVals.length, 18, "LANG_CODES entries");
  eq(picker.length, 18, "language picker options");
  ok(codeVals.indexOf("en") !== -1, "English must be a language");
  eq(new Set(codeVals).size, codeVals.length, "LANG_CODES codes are unique");

  // (b) the picker and LANG_CODES describe the same 18 languages, same order
  deepEq(names, picker, "LANG_CODES names vs language picker");

  // (c) the four removed languages are gone from the config
  for (const n of REMOVED) {
    ok(names.indexOf(n) === -1, `${n} must not be in LANG_CODES`);
    ok(picker.indexOf(n) === -1, `${n} must not be in the language picker`);
    ok(!(n in I18N.NATIVE_NAMES), `${n} must not have a native name`);
  }
  for (const c of REMOVED_CODES) {
    ok(codeVals.indexOf(c) === -1, `code ${c} must not be in LANG_CODES`);
  }

  // (d) every language has a non-empty native display name, and nothing extra
  deepEq(Object.keys(I18N.NATIVE_NAMES), names, "NATIVE_NAMES keys vs LANG_CODES");
  for (const n of names) {
    const v = I18N.NATIVE_NAMES[n];
    ok(typeof v === "string" && v.trim() !== "", `native name for ${n} must be non-empty`);
  }

  // (e) no dictionary survives for a language that cannot be selected
  ok(typeof I18N.dicts === "object" && I18N.dicts !== null, "I18N.dicts must be exposed");
  for (const c of Object.keys(I18N.dicts)) {
    ok(codeVals.indexOf(c) !== -1, `dictionary "${c}" has no language in LANG_CODES`);
    ok(c !== "en", "English is the source and must not have a dictionary");
  }

  // (f) no blank translations anywhere — an empty string would render as nothing
  for (const c of Object.keys(I18N.dicts)) {
    for (const bucket of ["q", "o", "help", "def", "ui"]) {
      const b = I18N.dicts[c][bucket] || {};
      for (const k of Object.keys(b)) {
        ok(typeof b[k] === "string" && b[k].trim() !== "",
          `[${c}.${bucket}] "${k}" is empty`);
      }
    }
  }
}

function test(name, fn) {
  try {
    fn();
    checkInvariants();
    passed++;
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
  }
}

// ── the 18-language list ─────────────────────────────────────────────────
test("the survey offers exactly 18 languages", () => {
  eq(pickerNames().length, 18, "language options");
});

test("the 18 languages are the v12 final list, in picker order", () => {
  deepEq(codes(), ["en", "fr", "it", "pa", "es", "ar", "zh", "gu", "hi", "pt",
    "tl", "de", "ta", "bn", "ur", "uk", "so", "fa"], "LANG_CODES");
});

test("Somali and Farsi are selectable and store their own codes", () => {
  eq(I18N.code("Somali"), "so", "Somali");
  eq(I18N.code("Farsi"), "fa", "Farsi");
  eq(I18N.native("Somali"), "Soomaali", "Somali endonym");
  eq(I18N.native("Farsi"), "فارسی", "Farsi endonym");
});

// ── the removed languages ────────────────────────────────────────────────
test("Malayalam is removed completely", () => {
  ok(!("Malayalam" in I18N.LANG_CODES), "Malayalam in LANG_CODES");
  ok(!("Malayalam" in I18N.NATIVE_NAMES), "Malayalam in NATIVE_NAMES");
  ok(!(("ml") in I18N.dicts), "ml dictionary still present");
  eq(I18N.code("Malayalam"), "en", "a removed language falls back to English");
  eq(I18N.native("Malayalam"), "Malayalam", "native() falls back to the given name");
});

test("Finnish, Kurdish and Polish are removed completely", () => {
  for (const [name, code] of [["Finnish", "fi"], ["Kurdish", "ku"], ["Polish", "pl"]]) {
    ok(!(name in I18N.LANG_CODES), `${name} in LANG_CODES`);
    ok(!(name in I18N.NATIVE_NAMES), `${name} in NATIVE_NAMES`);
    ok(!(code in I18N.dicts), `${code} dictionary still present`);
    eq(I18N.code(name), "en", `${name} falls back to English`);
  }
});

test("no removed language is right-to-left or has a dictionary", () => {
  for (const c of REMOVED_CODES) {
    eq(I18N.isRTL(c), false, `${c} must not be RTL`);
  }
});

// ── RTL ──────────────────────────────────────────────────────────────────
test("only Arabic and Urdu are right-to-left", () => {
  for (const c of codes()) {
    const expected = c === "ar" || c === "ur";
    eq(I18N.isRTL(c), expected, `isRTL(${c})`);
  }
});

// ── picklists stay English in all 18 languages ───────────────────────────
const COUNTRY = SURVEY.QUESTIONS.find((q) => q.id === "country_moved_from").options[0];
const CIP = W.CIP_DATA.OPTIONS[1];
const OCCUPATION = W.NOC_DATA.OCCUPATIONS[0].label;
const SKILL = W.NOC_DATA.SKILLS[Object.keys(W.NOC_DATA.SKILLS)[0]][0];

test("country names stay English in every language", () => {
  for (const c of codes()) eq(I18N.o(COUNTRY, c), COUNTRY, `country in ${c}`);
});

test("CIP areas of study stay English in every language", () => {
  for (const c of codes()) eq(I18N.o(CIP, c), CIP, `CIP in ${c}`);
});

test("NOC occupations stay English in every language", () => {
  for (const c of codes()) eq(I18N.o(OCCUPATION, c), OCCUPATION, `occupation in ${c}`);
});

test("skill names stay English in every language", () => {
  for (const c of codes()) eq(I18N.o(SKILL, c), SKILL, `skill in ${c}`);
});

test("Bengali keeps the picklists in English like every other language", () => {
  eq(I18N.o(COUNTRY, "bn"), COUNTRY, "Bengali country");
  eq(I18N.o(CIP, "bn"), CIP, "Bengali CIP");
  eq(I18N.o(OCCUPATION, "bn"), OCCUPATION, "Bengali occupation");
  eq(I18N.o(SKILL, "bn"), SKILL, "Bengali skill");
});

test("no dictionary translates any picklist value", () => {
  const pick = new Set();
  pick.add(COUNTRY);
  for (const o of SURVEY.QUESTIONS.find((q) => q.id === "country_moved_from").options) pick.add(o);
  for (const o of W.CIP_DATA.OPTIONS) pick.add(o);
  for (const o of W.NOC_DATA.OCCUPATIONS) pick.add(o.label);
  for (const k of Object.keys(W.NOC_DATA.SKILLS)) for (const s of W.NOC_DATA.SKILLS[k]) pick.add(s);
  for (const c of Object.keys(I18N.dicts)) {
    const o = I18N.dicts[c].o || {};
    for (const k of Object.keys(o)) {
      ok(!pick.has(k), `[${c}] translates picklist value "${k}"`);
    }
  }
});

// ── lookup behaviour ─────────────────────────────────────────────────────
test("a missing translation falls back to the English source", () => {
  eq(I18N.q("no_such_question", "English text", "fr"), "English text", "q fallback");
  eq(I18N.o("no such option", "fr"), "no such option", "o fallback");
  eq(I18N.def("no such term", "en def", "de"), "en def", "def fallback");
  eq(I18N.ui("no such ui", "fr"), "no such ui", "ui fallback");
});

test("English renders the English source for every language question", () => {
  const q = byId("consent");
  const english = typeof q.text === "function" ? q.text({}) : q.text;
  eq(I18N.q("consent", english, "en"), english, "en q");
});

test("every question id resolves to a non-blank label in every language", () => {
  for (const c of Object.keys(I18N.dicts)) {
    for (const q of Q) {
      if (typeof q.text !== "string") continue;
      const out = I18N.q(q.id, q.text, c);
      ok(typeof out === "string" && out.trim() !== "", `[${c}] ${q.id} rendered blank`);
    }
  }
});

// ── report ───────────────────────────────────────────────────────────────
const total = passed + failures.length;
if (failures.length) {
  console.error(`\n${failures.length} of ${total} tests FAILED:\n`);
  for (const f of failures) console.error("  ✗ " + f);
  process.exit(1);
}
console.log(`${passed} of ${total} tests passed.`);
