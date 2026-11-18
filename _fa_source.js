// Dump the English source for every survey string (keyed exactly like the _maps
// buckets) so a new-language draft (Farsi) can be authored with full coverage.
const fs = require("fs");
global.window = {};
require("./survey-data.js");
require("./translations.js");
const S = window.SURVEY;

const REF = require("./_maps/fr.js"); // canonical key set
const Q_KEYS = Object.keys(REF.q);
const O_KEYS = Object.keys(REF.o);
const DEF_KEYS = Object.keys(REF.def);
const UI_KEYS = Object.keys(REF.ui);
const HELP_KEYS = Object.keys(REF.help);

// English question text per q key (incl. 5 dynamic work_barrier variants)
const gateQ = S.QUESTIONS.find((q) => q.id === "work_barrier_gate");
const GATE = {
  "work_barrier.a": { employment_status: "Employed casual (less than 10 hours/week)", intended_job: "Yes" },
  "work_barrier.c": { employment_status: "Employed casual (less than 10 hours/week)", intended_job: "No" },
  "work_barrier.b": { employment_status: "Employed full time (30+ hours/week)" },
  "work_barrier.d": { employment_status: "Self-employed", intended_job: "Yes" },
  "work_barrier.e": { employment_status: "Self-employed", intended_job: "No" },
};
const q = {};
for (const item of S.QUESTIONS) if (item.id !== "work_barrier_gate") q[item.id] = typeof item.text === "function" ? item.text({}) : item.text;
for (const [k, st] of Object.entries(GATE)) q[k] = gateQ.text(st);

const out = { q: {}, help: {}, o: {}, def: {}, ui: {} };
for (const k of Q_KEYS) out.q[k] = q[k] || "";
for (const k of HELP_KEYS) out.help[k] = (S.QUESTIONS.find((x) => x.id === "skills") || {}).help || "";
for (const v of O_KEYS) out.o[v] = v;                       // English option value
for (const t of DEF_KEYS) out.def[t] = S.DEFINITIONS[t] || "";
for (const u of UI_KEYS) out.ui[u] = u;                     // English source string

fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 2));
console.log("q:%d help:%d o:%d def:%d ui:%d", Q_KEYS.length, HELP_KEYS.length, O_KEYS.length, DEF_KEYS.length, UI_KEYS.length);
