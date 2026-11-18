// Build one review payload per language for the translation-review .docx files.
// Drives from survey-data.js (question order + option sets) and pulls translated
// strings from _maps/<code>.js. English is the source (no map). Output: JSON per
// language written to the dir given as argv[2].
const fs = require("fs");
const path = require("path");
global.window = {};
require("./survey-data.js");
require("./translations.js"); // sets window.I18N (LANG_CODES, NATIVE_NAMES, native())
const S = window.SURVEY;
const I = window.I18N;

const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });

const LANG_CODES = I.LANG_CODES;                       // {English:"en", French:"fr", ...}
const NATIVE = I.NATIVE_NAMES;                          // {English:"English", French:"Français", ...}
const RTL = new Set(["ar", "ur"]);
// English name per code
const NAME_BY_CODE = Object.fromEntries(Object.entries(LANG_CODES).map(([n, c]) => [c, n]));

// Reference map (any language) → canonical key order for def & ui buckets.
const REF = require("./_maps/fr.js");
const DEF_KEYS = Object.keys(REF.def);                  // 44 English terms
const UI_KEYS = Object.keys(REF.ui);                    // 41 English source strings
const O_KEYS = new Set(Object.keys(REF.o));             // finite translated option values
const HELP_KEYS = Object.keys(REF.help);               // ["skills"] or similar

// Resolve the 5 dynamic work-barrier-gate variants (key + English text).
const gateQ = S.QUESTIONS.find((q) => q.id === "work_barrier_gate");
const GATE_STATES = [
  { employment_status: "Employed casual (less than 10 hours/week)", intended_job: "Yes" },
  { employment_status: "Employed casual (less than 10 hours/week)", intended_job: "No" },
  { employment_status: "Employed full time (30+ hours/week)" },
  { employment_status: "Self-employed", intended_job: "Yes" },
  { employment_status: "Self-employed", intended_job: "No" },
];
const GATE_VARIANTS = [];
const seenGate = new Set();
for (const st of GATE_STATES) {
  const key = gateQ.textKey(st), en = gateQ.text(st);
  if (!seenGate.has(key)) { seenGate.add(key); GATE_VARIANTS.push({ key, en }); }
}

const missOpt = new Set();

// Build the ordered section→question structure once (English skeleton).
function questionOptions(q) {
  if (!Array.isArray(q.options)) return null;           // picklist / text / rating → no finite options
  // language selector: show native endonyms (what respondents see), same in every doc
  if (q.id === "language") return q.options.map((v) => ({ en: v, native: NATIVE[v] || v, isLang: true }));
  const finite = q.options.filter((v) => O_KEYS.has(v));
  if (!finite.length) return null;
  return finite.map((v) => ({ en: v }));
}

function buildForCode(code) {
  const isEn = code === "en";
  const M = isEn ? null : require("./_maps/" + code + ".js");
  const tQ = (id, en) => (isEn ? en : (M.q[id] != null ? M.q[id] : en));
  const tO = (v) => {
    if (isEn) return v;
    if (M.o[v] != null) return M.o[v];
    missOpt.add(code + ":" + v);
    return v;
  };
  const tDef = (term) => (isEn ? S.DEFINITIONS[term] : (M.def[term] != null ? M.def[term] : S.DEFINITIONS[term]));
  const tUi = (en) => (isEn ? en : (M.ui[en] != null ? M.ui[en] : en));
  const tHelp = (k, en) => (isEn ? en : (M.help[k] != null ? M.help[k] : en));

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
      item.variants = GATE_VARIANTS.map((v, i) => ({
        label: String.fromCharCode(97 + i) + ")",
        text: tQ(v.key, v.en),
      }));
    } else {
      const en = typeof q.text === "function" ? q.text({}) : q.text;
      item.text = tQ(q.id, en);
    }

    const opts = questionOptions(q);
    if (opts) item.options = opts.map((o) => (o.isLang ? o.native : tO(o.en)));

    // skills rating scale help line
    if (q.id === "skills" && HELP_KEYS.length) {
      item.help = tHelp(HELP_KEYS[0], (S.QUESTIONS.find((x) => x.id === "skills") || {}).help || "");
    }
    bucket.push(item);
  }

  const definitions = DEF_KEYS.map((term, i) => ({
    num: i + 1,
    term: isEn ? term : (M.o[term] != null ? M.o[term] : term), // in-language label where the term is an option
    def: tDef(term),
  }));

  const ui = UI_KEYS.map((en, i) => ({ num: i + 1, text: tUi(en) }));

  return {
    code, name: NAME_BY_CODE[code] || code, native: NATIVE[NAME_BY_CODE[code]] || code,
    rtl: RTL.has(code),
    sections, definitions, ui,
  };
}

const codes = ["en", ...Object.values(LANG_CODES).filter((c) => c !== "en")];
let n = 0;
for (const code of codes) {
  const payload = buildForCode(code);
  fs.writeFileSync(path.join(OUT, code + ".json"), JSON.stringify(payload, null, 2));
  n++;
}
console.log("wrote", n, "language payloads to", OUT);
if (missOpt.size) { console.log("WARNING option values missing from o bucket (shown in English):"); console.log("  " + [...missOpt].join("\n  ")); }
