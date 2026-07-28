// Emit the TTS job list: every question (q) and option (o) string that has a
// read-aloud button, per language, keyed for a stable filename + manifest.
// Output: JSON { jobs:[{lang,bucket,key,text}], keys:{q:[...],o:[...]} } to argv[2].
const fs = require("fs");
global.window = {};
require("./survey-data.js");
require("./translations.js");
const S = window.SURVEY;
const I = window.I18N;
const LANG_CODES = I.LANG_CODES;
const NAME_BY_CODE = Object.fromEntries(Object.entries(LANG_CODES).map(([n, c]) => [c, n]));
const codes = Object.values(LANG_CODES); // includes en

// question keys (ids) in survey order + the 5 dynamic work_barrier variants
const REF = require("./_maps/fr.js");
const Q_KEYS = Object.keys(REF.q);           // 69 (incl work_barrier.a..e)
const O_KEYS = Object.keys(REF.o);           // finite translated option values

// English source text for each q key (needed for the "en" jobs + fallback)
const gateQ = S.QUESTIONS.find((q) => q.id === "work_barrier_gate");
const GATE = {
  "work_barrier.a": { employment_status: "Employed casual (less than 10 hours/week)", intended_job: "Yes" },
  "work_barrier.c": { employment_status: "Employed casual (less than 10 hours/week)", intended_job: "No" },
  "work_barrier.b": { employment_status: "Employed full time (30+ hours/week)" },
  "work_barrier.d": { employment_status: "Self-employed", intended_job: "Yes" },
  "work_barrier.e": { employment_status: "Self-employed", intended_job: "No" },
};
const qEnglish = {};
for (const q of S.QUESTIONS) {
  if (q.id === "work_barrier_gate") continue;
  qEnglish[q.id] = typeof q.text === "function" ? q.text({}) : q.text;
}
for (const [k, st] of Object.entries(GATE)) qEnglish[k] = gateQ.text(st);

const jobs = [];
for (const code of codes) {
  const isEn = code === "en";
  const M = isEn ? null : require("./_maps/" + code + ".js");
  for (const id of Q_KEYS) {
    const text = isEn ? qEnglish[id] : (M.q[id] != null ? M.q[id] : qEnglish[id]);
    if (text) jobs.push({ lang: code, bucket: "q", key: id, text });
  }
  for (const v of O_KEYS) {
    const text = isEn ? v : (M.o[v] != null ? M.o[v] : v);
    if (text) jobs.push({ lang: code, bucket: "o", key: v, text });
  }
}

fs.writeFileSync(process.argv[2], JSON.stringify({ jobs, qKeys: Q_KEYS, oKeys: O_KEYS }, null, 0));
const byLang = {};
for (const j of jobs) byLang[j.lang] = (byLang[j.lang] || 0) + 1;
console.log("langs:", codes.length, "| total jobs:", jobs.length, "| per lang:", byLang[codes[0]]);
