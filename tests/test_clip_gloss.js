#!/usr/bin/env node
/**
 * One option label must lose its English gloss — and only that one.
 *
 * Six of the uploaded masters write the status-in-Canada option as the
 * translated term plus an English gloss in brackets:
 *
 *   "Titular de un permiso de residencia temporal (Temporary Resident Permit)"
 *   "临时居民许可证持有人（Temporary Resident Permit Holder）"
 *
 * English and French have the translated term alone, and the client asked for
 * that shape in every language. tools/build_translations.js therefore strips
 * the exact suffix from that one option, which also changes what its recording
 * says (audio/texts.json and the six clips follow translations.js).
 *
 * Three things this file guards:
 *   1. the six languages now show the bare term, and the term really is the
 *      master line minus the known gloss (nothing was retyped or invented);
 *   2. nothing else moved — every other option still appears verbatim in its
 *      uploaded file, and legitimate bracketed wording (asides, country names)
 *      is untouched, so a future blanket strip fails here;
 *   3. the recording of the six matches the label on the page, and English,
 *      French and Tagalog are exactly as they were.
 *
 * Run: node tests/test_clip_gloss.js
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

// ── fixtures ───────────────────────────────────────────────────────────────
const ctx = { window: {}, console };
ctx.global = ctx;
vm.createContext(ctx);
vm.runInContext(read("survey-data.js"), ctx, { filename: "survey-data.js" });
vm.runInContext(read("translations.js"), ctx, { filename: "translations.js" });
const SURVEY = ctx.window.SURVEY;
const I18N = ctx.window.I18N;
const QUESTIONS = SURVEY.QUESTIONS;
const fx = JSON.parse(read("tests/fixtures/lang8-docx.json"));
const texts = JSON.parse(read("audio/texts.json"));
const manifest = JSON.parse(read("audio/manifest.json"));

const OPTION = "Temporary Resident Permit Holder";
const REF = "o/" + OPTION;

// Kept in step with GLOSS_SUFFIX in tools/build_translations.js.
const GLOSS = {
  es: " (Temporary Resident Permit)",
  hi: " (Temporary Resident Permit)",
  it: " (Temporary Resident Permit)",
  pt: " (Temporary Resident Permit)",
  ar: " (Temporary Resident Permit)",
  zh: "（Temporary Resident Permit Holder）",
};
const STRIPPED = Object.keys(GLOSS);

// English and French were already the shape every language now has. Tagalog
// says the term in English but never added a gloss, so it must not move either.
const UNTOUCHED = ["fr", "tl"];

const label = (o) => (typeof o === "string" ? o : o.label || o.value);
const COUNTRIES = new Set(
  ((QUESTIONS.find((q) => q.id === "country_moved_from") || {}).options || []).map(label)
);

function masterHay(code) {
  const f = fx[code];
  assert(f, "no extracted content for " + code);
  const hay = new Set();
  for (const list of Object.values(f.o || {})) for (const s of list) hay.add(String(s).trim());
  for (const s of Object.values(f.q || {})) hay.add(String(s).trim());
  for (const s of f.home || []) hay.add(String(s).trim());
  return hay;
}

// app.js: optLabel(q, v) -> dict.o[v] || v  (no bracket handling anywhere).
const shown = (code, value) => {
  const d = I18N.dicts[code];
  return (d && d.o && d.o[value]) || value;
};

// ── the invariant every test below ends with ───────────────────────────────
// The change must stay a single-option edit: the glossed option loses exactly
// its gloss, and every other option string still appears verbatim in the
// uploaded file it came from.
function assertOnlyThisOptionMoved() {
  for (const code of Object.keys(fx)) {
    if (!I18N.dicts[code]) continue;
    const hay = masterHay(code);
    for (const [key, value] of Object.entries(I18N.dicts[code].o || {})) {
      if (COUNTRIES.has(key)) continue;
      if (key === OPTION && GLOSS[code]) {
        const master = (value + GLOSS[code]).trim();
        assert(hay.has(master), `${code}: "${value}" is not the master line "${master}" minus its gloss`);
        continue;
      }
      assert(hay.has(value.trim()), `${code}: option "${key}" -> "${value}" drifted from the uploaded file`);
    }
  }
}

// ── 1. the six labels lost the gloss ──────────────────────────────────────
check("the six languages show the bare term, with no bracketed gloss", () => {
  const EXPECTED = {
    es: "Titular de un permiso de residencia temporal",
    hi: "टेम्पररी रेज़िडेंट परमिट धारक",
    it: "Titolare di un permesso di soggiorno temporaneo",
    pt: "Titular de autorização de residência temporária",
    ar: "حامل تصريح إقامة مؤقتة",
    zh: "临时居民许可证持有人",
  };
  for (const code of STRIPPED) {
    const value = shown(code, OPTION);
    assert(!/[()（）]/.test(value), `${code}: still shows a bracket: ${value}`);
    assert(value === EXPECTED[code], `${code}: shows ${JSON.stringify(value)}`);
    // the term is the master line minus the gloss: it was cut, not retyped
    const master = [...masterHay(code)].find((s) => s.startsWith(value));
    assert(master === value + GLOSS[code], `${code}: master line is ${JSON.stringify(master)}`);
  }
  assertOnlyThisOptionMoved();
});

check("the gloss exists only in the uploads, so the strip is not a no-op", () => {
  for (const code of STRIPPED) {
    const value = shown(code, OPTION);
    assert(!masterHay(code).has(value.trim()), `${code}: the upload already matched "${value}"`);
  }
  assertOnlyThisOptionMoved();
});

// ── 2. nothing else moved ─────────────────────────────────────────────────
check("English, French and Tagalog are exactly as they were", () => {
  // English ships the bare term (there is no translation layer for it).
  const en = QUESTIONS.flatMap((q) => q.options || []).map(label).find((s) => s === OPTION);
  assert(en === OPTION, "the English option is not the bare term: " + JSON.stringify(en));
  for (const code of UNTOUCHED) {
    const value = shown(code, OPTION);
    assert(value && !/[(（]/.test(value), `${code}: gained a bracket: ${value}`);
    // untouched means the label is still a verbatim master line
    assert(masterHay(code).has(value.trim()), `${code}: "${value}" is no longer verbatim in the upload`);
  }
  assertOnlyThisOptionMoved();
});

check("legitimate bracketed wording elsewhere survives", () => {
  // A blanket "remove everything in brackets" would break these real strings,
  // so each one must still carry its bracket in the same six languages.
  const KEEP = {
    es: "Ninguna de las anteriores (no seleccione ninguna otra opción)",
    it: "Nessuna delle precedenti (non selezionare altre opzioni)",
  };
  for (const [code, value] of Object.entries(KEEP)) {
    assert(shown(code, value) === value, `${code}: the aside was stripped: ${shown(code, value)}`);
  }
  // country names keep their native alternative in brackets
  for (const code of STRIPPED) {
    const withBracket = Object.entries(I18N.dicts[code].o || {})
      .filter(([k, v]) => COUNTRIES.has(k) && /[(（]/.test(v));
    assert(withBracket.length > 0, `${code}: every country bracket vanished`);
  }
  assertOnlyThisOptionMoved();
});

check("the tooltip for the option survived the strip", () => {
  for (const code of STRIPPED) {
    const def = I18N.dicts[code].def && I18N.dicts[code].def[OPTION];
    assert(def && def.trim(), `${code}: the option lost its tooltip`);
    assert(def !== shown(code, OPTION), `${code}: the tooltip is just the label`);
  }
  assertOnlyThisOptionMoved();
});

// ── 3. the recording follows the label ────────────────────────────────────
check("each of the six clips was recorded from the new label", () => {
  for (const code of STRIPPED) {
    const value = shown(code, OPTION);
    assert(texts[code] && texts[code][REF] === value,
      `${code}: clip text ${JSON.stringify(texts[code] && texts[code][REF])} != label ${JSON.stringify(value)}`);
    const rel = manifest[code] && manifest[code][REF];
    assert(rel, `${code}: no recording in the manifest`);
    const file = path.join(ROOT, rel);
    assert(fs.existsSync(file), `${code}: missing clip ${rel}`);
    assert(fs.statSync(file).size > 200, `${code}: clip ${rel} is empty`);
  }
  assertOnlyThisOptionMoved();
});

check("English, French and Tagalog recordings are unchanged", () => {
  for (const code of ["en", "fr", "tl"]) {
    const value = shown(code, OPTION);
    assert(texts[code][REF] === value, `${code}: clip text no longer matches the label`);
    assert(!/[(（]/.test(texts[code][REF]), `${code}: the clip still speaks a gloss`);
  }
  assertOnlyThisOptionMoved();
});

check("no other recording text moved", () => {
  // texts.json is the record of what each clip says; only the six may differ
  // from the label the page shows, and only for this one option.
  for (const [code, refs] of Object.entries(texts)) {
    for (const [ref, value] of Object.entries(refs)) {
      if (ref === REF && GLOSS[code]) continue;
      if (!ref.startsWith("o/")) continue;
      const key = ref.slice(2);
      if (COUNTRIES.has(key)) continue;
      assert(value === shown(code, key), `${code}: ${ref} speaks ${JSON.stringify(value)} but the page shows ${JSON.stringify(shown(code, key))}`);
    }
  }
  assertOnlyThisOptionMoved();
});

// ── report ─────────────────────────────────────────────────────────────────
if (failures) {
  console.error(`\n${failures} of ${checks} checks FAILED.\n`);
  process.exit(1);
}
console.log(`${checks} checks passed: one option lost its English gloss in six languages, the recordings follow, and nothing else moved.`);
