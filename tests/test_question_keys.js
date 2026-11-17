#!/usr/bin/env node
/**
 * The barrier gate asks one question three ways, and each wording must reach a
 * non-English respondent translated — on screen and in the recording.
 *
 * app.js renders it as
 *
 *     const qKey = typeof q.textKey === "function" ? q.textKey(answers) : q.id;
 *     const qText = tQ(qKey, qEnglish);              // dict.q[qKey] || English
 *
 * so the dictionary entry it reads is "work_barrier.a", ".b" or ".c" — never the
 * question id "work_barrier_gate". The build used to store a single master row
 * under "work_barrier_gate", which meant the key the app asked for was empty and
 * the question printed English while its Yes/No answers were translated. These
 * checks pin the fix at three levels: the dictionary keys, the rendered page, and
 * the read-aloud recording.
 *
 * Run: node tests/test_question_keys.js
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

// ── app data, dictionaries, audio record ──────────────────────────────────
const sctx = { window: {}, console };
sctx.global = sctx;
vm.createContext(sctx);
vm.runInContext(read("survey-data.js"), sctx, { filename: "survey-data.js" });
const SURVEY = sctx.window.SURVEY;
const QUESTIONS = SURVEY.QUESTIONS;

const ictx = { window: {}, console };
ictx.global = ictx;
vm.createContext(ictx);
vm.runInContext(read("translations.js"), ictx, { filename: "translations.js" });
const I18N = ictx.window.I18N;

const LANGS = ["en", "es", "fr", "hi", "it", "pt", "ar", "zh", "tl"];
const NON_EN = LANGS.slice(1);
const D = (code) => I18N.dicts[code];

const TEXTS = JSON.parse(read("audio/texts.json"));
const MANIFEST = JSON.parse(read("audio/manifest.json"));

const GATE = QUESTIONS.find((q) => q.id === "work_barrier_gate");
const EMP_OPTIONS = (QUESTIONS.find((q) => q.id === "employment_status") || {}).options || [];

// A state that makes each gate wording visible, taken from the survey's own
// visibility rule rather than assumed: statuses in the casual/part group ask once
// the intended-match answer is known, the full/contract-full group only when the
// job is not the intended one.
const CASUAL = EMP_OPTIONS.find((s) => /casual/i.test(s));
const FULL = EMP_OPTIONS.find((s) => /full time|Contract full/i.test(s));

function stateFor(key) {
  const candidates = [];
  for (const st of EMP_OPTIONS) {
    for (const intended of ["Yes", "No"]) {
      candidates.push({ employment_status: st, intended_job: intended });
    }
  }
  const hit = candidates.find((a) => GATE.visible(a) && GATE.textKey(a) === key);
  if (!hit) throw new Error("no answer state produces " + key);
  return hit;
}

const GATE_KEYS = ["work_barrier.a", "work_barrier.b", "work_barrier.c"];

// ── the invariant every check ends with ───────────────────────────────────
// The dictionary must hold exactly the keys the app can ask for: nothing
// missing (an empty key prints English) and nothing extra (a key nothing reads
// is how the gate stayed English for months without a test noticing).
function assertQuestionKeysSound() {
  const asked = [];
  for (const q of QUESTIONS) {
    if (typeof q.textKey !== "function") { asked.push(q.id); continue; }
    for (const st of EMP_OPTIONS) {
      for (const intended of ["Yes", "No"]) {
        const a = { employment_status: st, intended_job: intended };
        const k = q.textKey(a);
        if (k && !asked.includes(k)) asked.push(k);
      }
    }
  }
  assert(!asked.includes("work_barrier_gate"), "the app never reads a question under 'work_barrier_gate'");
  // English is the source text in survey-data.js, so only the eight uploaded
  // languages carry a dictionary.
  assert(!I18N.dicts.en, "English must not carry a dictionary (it is the source text)");
  for (const code of NON_EN) {
    const have = Object.keys(D(code).q).sort();
    const want = [...asked].sort();
    const missing = want.filter((k) => !have.includes(k));
    const extra = have.filter((k) => !want.includes(k));
    assert(!missing.length, `${code}: the app asks for keys the dictionary lacks: ${missing.slice(0, 4).join(",")}`);
    assert(!extra.length, `${code}: dictionary holds keys nothing reads: ${extra.slice(0, 4).join(",")}`);
    for (const k of GATE_KEYS) {
      const text = D(code).q[k];
      assert(text && text.trim(), `${code}: ${k} is empty`);
    }
  }
}

// ── 1. the three wordings are stored under the keys the app asks for ──────
check("all three gate wordings are translated under their own keys", () => {
  assert(CASUAL && FULL, "could not find the employment statuses the gate branches on");
  for (const [key, label] of [[GATE_KEYS[0], "full-time job"], [GATE_KEYS[1], "intended job"], [GATE_KEYS[2], "both"]]) {
    const state = stateFor(key);
    // the wording this key carries is the one the app will render there
    assert(GATE.textKey(state) === key, key + " is not the key for " + JSON.stringify(state));
    for (const code of NON_EN) {
      const text = D(code).q[key];
      assert(text !== GATE.text(state), `${code}: ${key} (${label}) is still English: ${text}`);
      assert(!/^Is there a barrier/.test(text), `${code}: ${key} fell back to English`);
    }
  }
  assertQuestionKeysSound();
});

// ── 2. the wording really comes from each language's upload ───────────────
// The masters print the three wordings on their own rows; the build maps them by
// meaning because the masters' English differs slightly from the app's. Pin the
// mapping so a re-ordered master cannot silently pair a translation with the
// wrong wording.
check("each wording is the master's own sentence for that case", () => {
  const fx = JSON.parse(read("tests/fixtures/lang8-docx.json"));
  const ROW = {
    "work_barrier.a": "ID_C_1_4_i",     // working full time
    "work_barrier.b": "ID_C_1_4_ii",    // the intended job
    "work_barrier.c": "ID_C_1_4_iii",   // both
  };
  for (const code of NON_EN) {
    const f = fx[code];
    assert(f && f.q, "no extracted questions for " + code);
    for (const key of GATE_KEYS) {
      const master = String(f.q[ROW[key]] || "").replace(/\s+/g, " ").trim();
      assert(master, `${code}: the master has no row ${ROW[key]} for ${key}`);
      const shown = String(D(code).q[key]).replace(/\s+/g, " ").trim();
      assert(shown === master, `${code}: ${key} is not the master's ${ROW[key]} (${JSON.stringify(shown)} vs ${JSON.stringify(master)})`);
    }
  }
  assertQuestionKeysSound();
});

// ── 3. the page renders it translated ─────────────────────────────────────
// Drive the real render path: seed a draft that opens on the gate, then read the
// question heading the respondent sees.
function renderGate(code, state) {
  const app = mount({
    store: {
      sault_lang_v1: code,
      sault_survey_draft_v1: JSON.stringify({ answers: state, currentId: "work_barrier_gate", respondentId: "r1" }),
    },
  });
  app.openSurvey();
  const h2 = app.root().querySelector(".q-text");
  if (!h2) throw new Error(code + ": no question heading rendered");
  const text = (function walk(n, out = []) {
    // the read-aloud button sits inside the heading; its label is not the question
    if (n.classes && n.classes.has("q-speak")) return out;
    if (n.tagName === "#TEXT" && n._text) out.push(n._text);
    for (const c of n.children || []) walk(c, out);
    return out;
  })(h2).join(" ").replace(/\s+/g, " ").trim();
  return text;
}

check("the gate renders in the chosen language for every wording", () => {
  for (const key of GATE_KEYS) {
    const state = stateFor(key);
    for (const code of NON_EN) {
      const shown = renderGate(code, state);
      const want = D(code).q[key];
      assert(shown === want, `${code}: ${key} renders ${JSON.stringify(shown)} instead of ${JSON.stringify(want)}`);
      assert(shown !== GATE.text(state), `${code}: ${key} rendered English on screen`);
    }
  }
  assertQuestionKeysSound();
});

// ── 4. the recording says what the page shows ─────────────────────────────
check("each wording's recording matches the page and exists", () => {
  for (const key of GATE_KEYS) {
    const state = stateFor(key);
    for (const code of LANGS) {
      const ref = "q/" + key;
      const spoken = TEXTS[code] && TEXTS[code][ref];
      assert(spoken, `${code}: no read-aloud text for ${ref}`);
      const english = GATE.text(state);
      const d = D(code);
      const page = (d && d.q && d.q[key]) || english;
      assert(spoken === page, `${code}: ${ref} says ${JSON.stringify(spoken)} but the page shows ${JSON.stringify(page)}`);
      if (code !== "en") {
        assert(spoken !== english, `${code}: ${ref} is recorded in English`);
      }
      const clip = MANIFEST[code] && MANIFEST[code][ref];
      assert(clip, `${code}: no clip listed for ${ref}`);
      const file = path.join(ROOT, clip);
      assert(fs.existsSync(file), `${code}: listed clip is missing on disk: ${clip}`);
      assert(fs.statSync(file).size > 200, `${code}: clip is too small to hold speech: ${clip}`);
    }
  }
  assertQuestionKeysSound();
});

// ── 5. the three wordings stay distinct ───────────────────────────────────
check("the three wordings remain three distinct sentences in every language", () => {
  for (const code of LANGS) {
    const seen = GATE_KEYS.map((k) => {
      const d = D(code);
      return (d && d.q && d.q[k]) || GATE.text(stateFor(k));
    });
    assert(new Set(seen).size === 3, `${code}: the gate's wordings collapsed: ${JSON.stringify(seen)}`);
  }
  assertQuestionKeysSound();
});

// ── report ────────────────────────────────────────────────────────────────
if (failures) {
  console.error(`\n${failures} of ${checks} checks FAILED.\n`);
  process.exit(1);
}
console.log(`${checks} checks passed: the gate's three wordings are translated, rendered and recorded.`);
