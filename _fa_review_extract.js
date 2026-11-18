// Build the review payload for Farsi (fa) from _maps/fa.js, mirroring
// _review_extract.js but for a single language not yet in translations.js.
// Output: <dir>/fa.json  (consumed by _review_build_docs.py)
const fs = require("fs");
const path = require("path");
global.window = {};
require("./survey-data.js");
const S = window.SURVEY;
const M = require("./_maps/fa.js");

const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });

const O_KEYS = new Set(Object.keys(M.o));
const DEF_KEYS = Object.keys(M.def);
const UI_KEYS = Object.keys(M.ui);
const HELP_KEYS = Object.keys(M.help);

const gateQ = S.QUESTIONS.find((q) => q.id === "work_barrier_gate");
const GATE_STATES = [
  { employment_status: "Employed casual (less than 10 hours/week)", intended_job: "Yes" },
  { employment_status: "Employed casual (less than 10 hours/week)", intended_job: "No" },
  { employment_status: "Employed full time (30+ hours/week)" },
  { employment_status: "Self-employed", intended_job: "Yes" },
  { employment_status: "Self-employed", intended_job: "No" },
];
const GATE_VARIANTS = [];
const seen = new Set();
for (const st of GATE_STATES) {
  const key = gateQ.textKey(st);
  if (!seen.has(key)) { seen.add(key); GATE_VARIANTS.push({ key }); }
}

const tQ = (id, en) => (M.q[id] != null ? M.q[id] : en);
const tO = (v) => (M.o[v] != null ? M.o[v] : v);
const tDef = (t) => (M.def[t] != null ? M.def[t] : S.DEFINITIONS[t]);
const tUi = (u) => (M.ui[u] != null ? M.ui[u] : u);

function questionOptions(q) {
  if (!Array.isArray(q.options)) return null;
  if (q.id === "language") return null; // language names are native endonyms, not translated per-language
  const finite = q.options.filter((v) => O_KEYS.has(v));
  return finite.length ? finite : null;
}

const sections = [];
const bySection = new Map();
let qnum = 0;
for (const q of S.QUESTIONS) {
  if (!bySection.has(q.section)) { bySection.set(q.section, []); sections.push({ title: q.section, questions: bySection.get(q.section) }); }
  const bucket = bySection.get(q.section);
  qnum++;
  const item = { num: qnum };
  if (q.id === "work_barrier_gate") {
    item.text = tQ("work_barrier_gate", gateQ.text(GATE_STATES[0]));
    item.note = "This question is worded five ways depending on the person's situation — please review all five:";
    item.variants = GATE_VARIANTS.map((v, i) => ({ label: String.fromCharCode(97 + i) + ")", text: tQ(v.key, "") }));
  } else {
    const en = typeof q.text === "function" ? q.text({}) : q.text;
    item.text = tQ(q.id, en);
  }
  const opts = questionOptions(q);
  if (opts) item.options = opts.map((o) => tO(o));
  if (q.id === "skills" && HELP_KEYS.length) item.help = M.help[HELP_KEYS[0]];
  bucket.push(item);
}

const definitions = DEF_KEYS.map((term, i) => ({ num: i + 1, term: M.o[term] != null ? M.o[term] : term, def: tDef(term) }));
const ui = UI_KEYS.map((en, i) => ({ num: i + 1, text: tUi(en) }));

const payload = { code: "fa", name: "Farsi (Persian)", native: "فارسی", rtl: true, sections, definitions, ui };
fs.writeFileSync(path.join(OUT, "fa.json"), JSON.stringify(payload, null, 2));
console.log("wrote fa.json — sections:%d defs:%d ui:%d", sections.length, definitions.length, ui.length);
