#!/usr/bin/env node
/**
 * Every question and option the page shows has a recording, and that recording
 * says the words on screen.
 *
 * Question clips were keyed by question id alone ("q/immigration_category"), so
 * when the question was reworded in 50c7fa9 the lookup still found the July mp3
 * and the speaker read the old wording — in every language, which is why the
 * word "Canada" was never heard. Option clips were missing outright in some
 * languages (Arabic had no clip for "Canadian citizen", "Permanent resident" or
 * "Prefer not to answer"), and a speaker only exists when a clip does or the
 * device has a voice for that language, so those options silently lost their 🔊
 * button.
 *
 * audio/texts.json records the exact string each clip was generated from. This
 * file re-derives the string the page actually displays, from the same data the
 * app reads, and fails when the two disagree — that is the stale-audio alarm —
 * and fails when a displayed string has no clip at all — that is the missing
 * icon alarm.
 *
 * Run: node tests/test_audio_coverage.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

let failures = 0;
let checks = 0;
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const eq = (actual, expected, msg) => {
  if (actual !== expected) throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

// ── the project's own data ─────────────────────────────────────────────────
const ctx = { window: {}, console };
ctx.global = ctx;
vm.createContext(ctx);
vm.runInContext(read("translations.js"), ctx, { filename: "translations.js" });
vm.runInContext(read("survey-data.js"), ctx, { filename: "survey-data.js" });
const I18N = ctx.window.I18N;
const SURVEY = ctx.window.SURVEY;
const LANGS = (I18N && I18N.LANGS) || [];
const MANIFEST = JSON.parse(read(path.join("audio", "manifest.json")));
const TEXTS = JSON.parse(read(path.join("audio", "texts.json")));

// app.js reads a markdown link aloud as its label only (hasLinks → stripMd).
const MD_LINK = /\[([^\]]+)\]\(([^)]+)\)/g;
const stripMd = (s) => {
  MD_LINK.lastIndex = 0;
  let out = "";
  let last = 0;
  let m;
  while ((m = MD_LINK.exec(String(s)))) {
    out += s.slice(last, m.index) + m[1];
    last = m.index + m[0].length;
  }
  return out + s.slice(last);
};
const dict = (code) => (I18N.dicts && I18N.dicts[code]) || null;
// app.js: const tQ = (key, english) => (dict.q && dict.q[key]) || english
const tQ = (code, key, english) => {
  const d = dict(code);
  return (d && d.q && d.q[key]) || english;
};
// app.js: const optLabel = (q, v) => (dict.o && dict.o[v]) || v
const optLabel = (code, value) => {
  const d = dict(code);
  return (d && d.o && d.o[value]) || value;
};
// app.js: function S(text) { const d = dict(); return (d && d.ui && d.ui[text]) || text; }
const S = (code, text) => {
  const d = dict(code);
  return (d && d.ui && d.ui[text]) || text;
};

/**
 * ENGLISH question text per ref key, taken from survey-data.js. The barrier gate
 * is one question with three wordings picked by answers and keyed
 * work_barrier.a/.b/.c, so its English has to be walked out of its own functions.
 */
function englishQuestionTexts() {
  const byKey = {};
  for (const q of SURVEY.QUESTIONS) {
    if (typeof q.textKey === "function") {
      const emp = (SURVEY.QUESTIONS.find((x) => x.id === "employment_status") || {}).options || [];
      for (const st of emp) {
        for (const intended of ["Yes", "No"]) {
          const a = { employment_status: st, intended_job: intended };
          let key, text;
          try {
            key = q.textKey(a);
            text = q.text(a);
          } catch (e) {
            continue;
          }
          if (!key || !text) continue;
          if (byKey[key] != null && byKey[key] !== text) {
            throw new Error(`survey-data: ${key} has two different wordings (${JSON.stringify([byKey[key], text])})`);
          }
          byKey[key] = text;
        }
      }
      continue; // the app never asks for a clip under this question's own id
    }
    const text = typeof q.text === "function" ? q.text({}) : q.text;
    if (text) byKey[q.id] = text;
  }
  return byKey;
}

const EN_QUESTIONS = englishQuestionTexts();
const OPTIONS = (() => {
  const set = new Set();
  for (const q of SURVEY.QUESTIONS) {
    let opts = q.options;
    if (typeof opts === "function") {
      try {
        opts = opts({});
      } catch (e) {
        opts = null;
      }
    }
    (opts || []).forEach((o) => set.add(o));
  }
  return Array.from(set);
})();
// Section D reads skill names aloud; they are keyed by their English name.
const SKILL_NAMES = Object.keys(SURVEY.SKILL_DEFINITIONS || {});

/** ref -> text the page displays for it. */
function displayedFor(code) {
  const out = {};
  for (const key of Object.keys(EN_QUESTIONS)) {
    const shown = tQ(code, key, EN_QUESTIONS[key]);
    out["q/" + key] = MD_LINK.test(shown) ? stripMd(shown) : shown;
    MD_LINK.lastIndex = 0;
  }
  for (const value of OPTIONS) out["o/" + value] = optLabel(code, value);
  // Section D skill rows are read aloud by name ("sk/" + English name).
  for (const name of SKILL_NAMES) out["sk/" + name] = S(code, name);
  return out;
}

// ── checks ─────────────────────────────────────────────────────────────────
const run = (name, fn) => {
  checks += 1;
  try {
    fn();
    console.log("  ok  " + name);
  } catch (err) {
    failures += 1;
    console.log("  x   " + name + ": " + err.message);
  }
};

run("the page ships more than one language to check", () => {
  assert(LANGS.length >= 2, `translations.js advertises ${LANGS.length} language(s)`);
  assert(LANGS.indexOf("en") !== -1 && LANGS.indexOf("ar") !== -1, "the language list lost en or ar");
});

const DISPLAYED = {};
for (const code of LANGS) DISPLAYED[code] = displayedFor(code);

// The reported bug, as a rule rather than an anecdote: every displayed question
// and every displayed option has a clip in every shipped language, so the 🔊
// button cannot disappear for want of a recording on a device with no voice.
run("every displayed question and option has a recording in every language", () => {
  const missing = [];
  for (const code of LANGS) {
    for (const ref of Object.keys(DISPLAYED[code])) {
      const rel = (MANIFEST[code] || {})[ref];
      if (!rel) missing.push(`${code} ${ref}`);
    }
  }
  eq(missing.length, 0, "no clip, so no speaker button on a device without a voice: " + missing.slice(0, 8).join(", "));
});

run("every clip the page can ask for is a real file", () => {
  const bad = [];
  for (const code of LANGS) {
    for (const ref of Object.keys(DISPLAYED[code])) {
      const rel = MANIFEST[code][ref];
      if (!rel) {
        bad.push(`${code} ${ref} (no manifest entry)`);
        continue;
      }
      const abs = path.join(ROOT, rel);
      if (!fs.existsSync(abs)) bad.push(rel);
      else if (fs.statSync(abs).size < 200) bad.push(rel + " (tiny)");
    }
  }
  eq(bad.length, 0, "the manifest points at missing or empty clips: " + bad.slice(0, 8).join(", "));
});

// The stale-audio alarm: texts.json is what was spoken into the clip, DISPLAYED
// is what the page shows today. Any wording change since generation lands here.
run("every recording says the words the page shows", () => {
  const drift = [];
  for (const code of LANGS) {
    for (const ref of Object.keys(DISPLAYED[code])) {
      const spoken = (TEXTS[code] || {})[ref];
      if (spoken == null) {
        drift.push(`${code} ${ref} (no recorded baseline)`);
        continue;
      }
      if (spoken !== DISPLAYED[code][ref]) {
        drift.push(`${code} ${ref}: clip says ${JSON.stringify(spoken.slice(0, 48))} but the page shows ${JSON.stringify(DISPLAYED[code][ref].slice(0, 48))}`);
      }
    }
  }
  eq(drift.length, 0, "regenerate these clips with `node _audio_jobs.js _jobs.json` then `python _audio_gen.py _jobs.json audio <lang>`: " + drift.slice(0, 5).join(" | "));
});

run("the recorded baseline describes exactly the strings the page can ask for", () => {
  for (const code of LANGS) {
    const have = Object.keys(TEXTS[code] || {}).sort();
    const want = Object.keys(DISPLAYED[code]).sort();
    const extra = have.filter((r) => want.indexOf(r) === -1);
    eq(extra.length, 0, `${code}: audio/texts.json keeps ${extra.length} clip(s) the page no longer asks for (${extra.slice(0, 4).join(", ")})`);
  }
  const unknown = Object.keys(TEXTS).filter((c) => LANGS.indexOf(c) === -1);
  eq(unknown.length, 0, "audio/texts.json covers languages the page does not ship: " + unknown.join(", "));
});

// The user's report, spelled out: the status-in-Canada question is read with the
// word Canada in it, in the languages they tried, and not with its old wording.
run("the status-in-Canada question is read with the word Canada", () => {
  const ref = "q/immigration_category";
  assert(MANIFEST.en[ref], "the English status question has no clip");
  eq(TEXTS.en[ref], "What is your status in Canada?", "the English clip is not built from the current question");
  const mustMention = { en: /canada/i, fr: /canada/i, es: /canad[aá]/i, pt: /canad[aá]/i, ar: /كندا/ };
  for (const code of Object.keys(mustMention)) {
    if (LANGS.indexOf(code) === -1) continue;
    const spoken = (TEXTS[code] || {})[ref];
    assert(spoken, `${code}: the status question has no clip`);
    assert(mustMention[code].test(spoken), `${code}: the clip says ${JSON.stringify(spoken)} — no Canada in it`);
  }
  assert(!/immigration category/i.test(TEXTS.en[ref]), "the English clip still holds the pre-November wording");
});

// The missing-icon complaint, per question: every option of every question that
// renders cards or a list carries a clip in Arabic, the language it was seen in.
run("Arabic has a recording for every option of every question", () => {
  const missing = [];
  for (const q of SURVEY.QUESTIONS) {
    let opts = q.options;
    if (typeof opts === "function") {
      try {
        opts = opts({});
      } catch (e) {
        continue;
      }
    }
    (opts || []).forEach((o) => {
      if (!(MANIFEST.ar || {})["o/" + o]) missing.push(`${q.id}: ${o}`);
    });
  }
  eq(missing.length, 0, "Arabic options with no clip, so no speaker: " + missing.slice(0, 8).join(", "));
});

run("the Arabic clips hold the Arabic label, not the English one", () => {
  const samples = ["Canadian citizen", "Permanent resident", "Prefer not to answer", "Alberta"];
  for (const value of samples) {
    const spoken = (TEXTS.ar || {})["o/" + value];
    assert(spoken, "no Arabic clip for " + value);
    if (optLabel("ar", value) !== value) {
      eq(spoken, optLabel("ar", value), `Arabic clip for ${value}`);
      assert(/[^\x00-\x7F]/.test(spoken), `the Arabic clip for ${value} is plain ASCII: ${JSON.stringify(spoken)}`);
    }
  }
});

// Section D rows had no clip ref at all, so they only ever had a speaker when the
// device carried an Arabic voice — the same disappearing 🔇 as the options.
run("every skill row has a recording in every language", () => {
  const missing = [];
  for (const code of LANGS) {
    for (const name of SKILL_NAMES) {
      if (!(MANIFEST[code] || {})["sk/" + name]) missing.push(`${code} ${name}`);
    }
  }
  eq(missing.length, 0, "skill rows with no clip, so no speaker: " + missing.slice(0, 6).join(", "));
  const ar = (TEXTS.ar || {})["sk/Coordinating"];
  assert(ar && ar !== "Coordinating", `the Arabic skill clip should say the Arabic name, got ${JSON.stringify(ar)}`);
});

run("no language speaks another language's question text", () => {
  const bare = [];
  for (const code of LANGS.filter((c) => c !== "en")) {
    let translated = 0;
    for (const key of Object.keys(EN_QUESTIONS)) {
      const shown = DISPLAYED[code]["q/" + key];
      if (shown !== EN_QUESTIONS[key]) translated += 1;
    }
    if (translated < 20) bare.push(`${code}: only ${translated}`);
  }
  eq(bare.length, 0, "these languages barely translate their questions, so the clip set is suspect: " + bare.join(", "));
});

// ── report ─────────────────────────────────────────────────────────────────
const total = LANGS.length * (Object.keys(EN_QUESTIONS).length + OPTIONS.length + SKILL_NAMES.length);
if (failures) {
  console.error(`\n${failures} of ${checks} checks FAILED.\n`);
  process.exit(1);
}
console.log(`${checks} checks passed: ${total} strings have a recording that matches the page, across ${LANGS.length} languages.`);
