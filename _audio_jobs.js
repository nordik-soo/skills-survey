// Emit the TTS job list from the strings the UI actually displays, so a clip
// can never say something different from what is on screen. Mirrors app.js:
//   tQ(key, english)  → dict.q[key] || english
//   optLabel(q, v)    → dict.o[v] || v
//   stripMd(text)     → link label only (the read-aloud text of a linked question)
// Older versions of this file read ./_maps/<lang>.js, a second translation store
// that drifted from translations.js, so recordings could say a question the user
// was not looking at. translations.js is the single source now.
//   node _audio_jobs.js <out.json>
// Output: { jobs:[{lang,bucket,key,text}], texts:{lang:{ref:text}} }
const fs = require("fs");
global.window = {};
require("./survey-data.js");
require("./translations.js");
const S = window.SURVEY;
const I = window.I18N;
const LANGS = (I && I.LANGS) || ["en"];
const dict = (code) => (I && I.dicts && I.dicts[code]) || null;
const MD_LINK = /\[([^\]]+)\]\(([^)]+)\)/g;
const stripMd = (s) => String(s).replace(MD_LINK, "$1");
const tQ = (code, key, english) => {
  const d = dict(code);
  return (d && d.q && d.q[key]) || english;
};
const optLabel = (code, value) => {
  const d = dict(code);
  return (d && d.o && d.o[value]) || value;
};

// English question text per ref key. The barrier gate is one question with three
// wordings chosen by answers, keyed work_barrier.a/.b/.c; it has no clip under
// its own id because the app never asks for one.
const qEnglish = {};
const qByKey = {};
for (const q of S.QUESTIONS) {
  if (typeof q.textKey === "function") {
    // walk every (employment status × intended job) pair and keep the wording
    // each key produces; a key with two different wordings is a data bug
    const emp = (S.QUESTIONS.find((x) => x.id === "employment_status") || {}).options || [];
    for (const st of emp) {
      for (const intended of ["Yes", "No"]) {
        const a = { employment_status: st, intended_job: intended };
        const k = q.textKey(a);
        const text = q.text(a);
        if (!text) continue;
        if (qEnglish[k] != null && qEnglish[k] !== text) {
          throw new Error("key " + k + " has two wordings: " + JSON.stringify([qEnglish[k], text]));
        }
        qEnglish[k] = text;
      }
    }
    qByKey[q.id] = q.textKey;
    continue;
  }
  qEnglish[q.id] = typeof q.text === "function" ? q.text({}) : q.text;
}

const optionSet = new Set();
for (const q of S.QUESTIONS) {
  const opts = typeof q.options === "function" ? q.options({}) : q.options;
  (opts || []).forEach((o) => optionSet.add(o));
}
// Skill rows in Section D are read aloud by name too ("sk/" + English name).
const skillNames = Object.keys(S.SKILL_DEFINITIONS || {});

const jobs = [];
const texts = {};
for (const code of LANGS) {
  const seen = (texts[code] = {});
  for (const key of Object.keys(qEnglish)) {
    const shown = tQ(code, key, qEnglish[key]);
    if (!shown) continue;
    MD_LINK.lastIndex = 0;
    const spoken = MD_LINK.test(shown) ? stripMd(shown) : shown; // matches app.js
    const ref = "q/" + key;
    seen[ref] = spoken;
    jobs.push({ lang: code, bucket: "q", key, text: spoken });
  }
  for (const value of optionSet) {
    const shown = optLabel(code, value);
    if (!shown) continue;
    const ref = "o/" + value;
    seen[ref] = shown;
    jobs.push({ lang: code, bucket: "o", key: value, text: shown });
  }
  // app.js reads a skill row with S(name) — the ui dictionary, not the option one.
  for (const name of skillNames) {
    const d = dict(code);
    const shown = (d && d.ui && d.ui[name]) || name;
    const ref = "sk/" + name;
    seen[ref] = shown;
    jobs.push({ lang: code, bucket: "sk", key: name, text: shown });
  }
}

fs.writeFileSync(process.argv[2], JSON.stringify({ jobs, texts }));
const perLang = {};
for (const j of jobs) perLang[j.lang] = (perLang[j.lang] || 0) + 1;
console.log(
  "langs: " + LANGS.length + " | q keys: " + Object.keys(qEnglish).length +
  " | option strings: " + optionSet.size + " | skill names: " + skillNames.length +
  " | total jobs: " + jobs.length +
  " | per lang: " + perLang[LANGS[0]]
);
