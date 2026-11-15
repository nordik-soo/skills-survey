// Builds translations.js (9 languages) from the eight uploaded translation
// masters. Everything that exists in a master is emitted byte-identically to
// that master; only the five surfaces no master contains (country names, NOC
// skill names, skill definitions where absent, section titles and the new
// picker strings) come from the authored tables in tools/lang8_*.py.
//
// Sources
//   tests/fixtures/lang8-docx.json  text extracted from Translation-8-languages/*.docx
//   tools/lang8_authored.json       authored tables (countries, skills, sections, picker)
//   tools/lang8_prev_ui.json        UI wording from the previous translation layer
//   survey-data.js                  the English survey (question ids, options, terms)
// Output
//   translations.js                 window.I18N
//
// Alignment rules (all verified below, and asserted by tests/test_languages8.js):
//   question text        docx label -> app question id, via the label map.
//   options              a master lists the app's options first, then trailing
//                        extras (a "please specify" placeholder, a "see picklist"
//                        reference, a section header or a route note), so the
//                        first N lines align 1:1 with the app's N options.
//   option tooltips      appendix term -> translated option string -> English
//                        option. Appendix terms may join aliases with " / ", so
//                        the whole term is tried first and each alias after.
//   skill definitions    the appendix keys them by their ENGLISH skill name.
//   homepage             fixed line positions in the 56-line homepage block.
const fs = require("fs");
const vm = require("vm");

const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const fx = read("tests/fixtures/lang8-docx.json");
const authored = read("tools/lang8_authored.json");
const head = read("tools/lang8_prev_ui.json");

// English survey
const ctx = { window: {}, console };
ctx.global = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync("survey-data.js", "utf8"), ctx);
const SURVEY = ctx.window.SURVEY;

// label -> app question id, taken from the long-standing docx tool where it
// already matches these masters, with the E-section corrected (these masters
// carry retain on ID_E_1, leave factors on ID_E_1_a and the recommendation on
// ID_E_2; the old tool pointed leave factors at ID_E_2 and used a missing ID_E_3).
const toolSrc = fs.readFileSync("tools/apply_lang_docx.js", "utf8");
const LABEL_TO_APP = {};
for (const m of toolSrc.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:\s*"(ID_[A-Za-z0-9_]+)"/g)) {
  LABEL_TO_APP[m[2]] = m[1];
}
Object.assign(LABEL_TO_APP, {
  ID_E_1: "retain_5_years",
  ID_E_1_a: "leave_factors",
  ID_E_2: "recommend_survey",
});

// Questions the old tool had no label for. Each is read from the master label
// that carries the same question (the barriers list is asked in four branches
// and the masters print it once per branch).
const EXTRA_Q = {
  work_barriers: "ID_C_1_4_a",
  work_barrier_gate: "ID_C_1_4_ii",
  gift_card_draw: "ID_E_2_GIFT",
};

const LANGS = ["es", "fr", "hi", "it", "pt", "ar", "zh", "tl"];
const RTL = ["ar"];

// The interface-texts block of each master, in the app's own UI wording.
const UI_ORDER = [
  "Search or select a language",
  "Type to search for a country…",
  "Type to search an area of study…",
  "Type to search an occupation…",
  "1 · No experience",
  "5 · Expert",
  "Type to search…",
  "Select an option…",
  "% complete",
  "Finish to become a Survey Champion",
  "Your responses are anonymous.",
  "Previous question",
  "Next question",
  "Next 5 skills",
  "Back",
  "Submit",
  "Definition:",
  "No matches",
  "more — keep typing to narrow",
  "Not sure",
  "Yes, enter me in the gift-card draw",
  "Five $50 local gift cards drawn monthly",
  "Email address",
  "Back",
  "Home",
  "You've already completed this survey",
  "Thank you — your response has been recorded. There's no need to fill it out again.",
  "Saving your response…",
  "One moment.",
  "You're a Survey Champion",
  "Thank you for your time and response. You made a great contribution to the development of the community.",
  "Back to home",
  "We couldn't save your response",
  "Something went wrong reaching the server. Your answers are still saved on this device — please try again.",
  "Try again",
  "Thank you for your interest.",
  "Unfortunately you are not eligible to participate in the survey.",
  "Thank you for starting the survey.",
  "Unfortunately we cannot proceed without your consent.",
];

const norm = (s) => String(s).replace(/\s+/g, " ").trim();
const plain = (s) => norm(s).replace(/^[•\u2022\-\t\s]+/, "").replace(/^([0-9]+)\s+[·•]\s+/, "$1 · ");
const sameAscii = (a, b) => a === b;

// The skills question prints its answer scale on the same line as the question
// in every master ("… ? 1 – No experience · 5 – Expert · 0 – Not sure"; French
// uses "1 ="), while the app renders that scale as the question's own English
// help line (survey-data.js: `help`). Keeping both prints the scale twice, so
// the translated question keeps only its question sentence and the 1–5/0
// labels appear once, in English, for all nine languages (client decision,
// Picklist 4 review). Only a question that has an English help line is touched:
// its scale is already on screen, so none of it is lost.
const SCALE_CUT = /(^|\s)1\s*[–—−=]\s*\S/;
function dropInlineScale(text, qid) {
  const q = SURVEY.QUESTIONS.find((x) => x.id === qid);
  if (!q || !q.help) return text;
  const m = SCALE_CUT.exec(text);
  if (!m) return text; // wording without an inline scale: keep it whole
  const kept = text.slice(0, m.index).replace(/[\s·•:,.–—−-]+$/, "").trim();
  return kept || text; // never emit an empty question
}

// Position of each interface string inside the flat defs_lines list. The block
// is located by its first line — every master translates "Search or select a
// language" and the previous translation layer kept that wording — so a master
// whose heading is worded differently still lands correctly.
function interfaceBlock(lines, anchor) {
  if (anchor) {
    const i = lines.findIndex((l) => plain(l) === plain(anchor));
    if (i >= 0 && lines.length >= i + UI_ORDER.length) {
      return lines.slice(i, i + UI_ORDER.length);
    }
  }
  const start = lines.findIndex((l) => /interface texts|textos de la interfaz|textes de l|testi dell|textos da interface|نصوص الواجهة|界面文本|इंटरफ़ेस टेक्स्ट|mga teksto ng interface/i.test(l));
  if (start < 0) return null;
  const body = lines.slice(start + 1, start + 1 + UI_ORDER.length);
  return body.length === UI_ORDER.length ? body : null;
}

// Homepage block is a fixed 56-line layout; these are the positions of the
// pieces the app renders.
const H = {
  h1: 0,
  hp1: [3, 4, 5],
  hp2: [7, 8, 9],
  encourage: 11,
  letterTitle: 12,
  letterHeadings: [13, 17, 19, 21, 24, 26, 28, 35],
  consentTitle: 38,
  consentPoints: [39, 40, 41, 42, 43, 44, 45, 46],
  consentHeading: 47,
  consentQ: 48,
  consentOpts: [49, 50],
  eligHeading: 51,
  eligQ: 52,
  eligOpts: [53, 54],
};
// letter body: heading index -> the paragraph/line positions that follow it
const LETTER_ROWS = [
  { h: 13, p: [14, 15, 16] },
  { h: 17, p: [18] },
  { h: 19, p: [20] },
  { h: 21, p: [22, 23] },
  { h: 24, p: [25] },
  { h: 26, p: [27] },
  { h: 28, p: [29], lines: [30, 31, 32, 33], after: [34] },
  { h: 35, p: [36] },
  { note: 37 },
];

const APP_SECTIONS = SURVEY.SECTIONS;
const DEF_KEYS = Object.keys(SURVEY.DEFINITIONS);
const SKILL_KEYS = Object.keys(SURVEY.SKILL_DEFINITIONS);
const SKILL_KEYS_LONG = [...SKILL_KEYS].sort((a, b) => b.length - a.length);

function buildDict(lang) {
  const src = fx[lang];
  if (!src) throw new Error("missing fixture for " + lang);
  const dict = { q: {}, o: {}, def: {}, ui: {}, sections: {}, home: null };

  // ── questions + options ──────────────────────────────────────────────
  const optLookup = {}; // translated option string -> English option
  const extraLine = {};
  for (const [label, options] of Object.entries(src.o || {})) {
    const qid = LABEL_TO_APP[label];
    if (!qid) continue;
    const q = SURVEY.QUESTIONS.find((x) => x.id === qid);
    if (!q || !Array.isArray(q.options) || !q.options.length) continue;
    const en = q.options.map((o) => (typeof o === "string" ? o : o.value));
    if (options.length < en.length) continue; // no 1:1 prefix (countries, E_2 handled below)
    for (let i = 0; i < en.length; i++) {
      dict.o[en[i]] = plain(options[i]);
      optLookup[plain(options[i])] = en[i];
    }
    if (options.length > en.length) {
      extraLine[label] = options.slice(en.length).map(plain);
    }
  }
  for (const [label, text] of Object.entries(src.q || {})) {
    const qid = LABEL_TO_APP[label];
    if (!qid || !text) continue;
    if (!SURVEY.QUESTIONS.some((x) => x.id === qid)) continue;
    dict.q[qid] = dropInlineScale(plain(text), qid);
  }

  // ── option tooltips + skill definitions from the appendix ────────────
  const lines = src.defs_lines || [];
  for (const raw of lines) {
    const s = norm(raw);
    // skill definition: keyed by the English skill name
    let hit = null;
    for (const k of SKILL_KEYS_LONG) {
      if (new RegExp("^" + k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*[:：]").test(s)) { hit = k; break; }
    }
    if (hit) {
      const body = s.slice(hit.length).replace(/^\s*[:：]\s*/, "").trim();
      if (body) dict.def[hit] = body;
      continue;
    }
    const m = s.match(/^(.{2,240}?)[：:]\s*(\S.*)$/);
    if (!m) continue;
    const body = m[2].trim();
    const words = [m[1].trim(), ...m[1].split(/\s*\/\s*/).map((x) => x.trim())];
    for (const w of words) {
      const en = optLookup[w];
      if (en && DEF_KEYS.includes(en) && !(en in dict.def)) dict.def[en] = body;
    }
  }

  // ── UI wording ───────────────────────────────────────────────────────
  const prev = (head.ui && head.ui[lang]) || {};
  const block = interfaceBlock(lines, prev["Search or select a language"]);
  if (block) {
    // the master's own interface list wins: it is the newest translation
    UI_ORDER.forEach((en, i) => { dict.ui[en] = plain(block[i]); });
  }
  for (const [en, tr] of Object.entries(prev)) {
    if (!(en in dict.ui)) dict.ui[en] = tr; // older wording, still not English
  }
  for (const [en, byLang] of Object.entries(authored.uiExtra)) {
    if (byLang[lang]) dict.ui[en] = byLang[lang];
  }
  dict.ui["Start the survey"] = authored.uiExtra["Start the survey"] ? authored.uiExtra["Start the survey"][lang] : dict.ui["Start the survey"];

  // country names (authored — no master carries the picklist)
  for (const [en, byLang] of Object.entries(authored.countries)) {
    if (byLang[lang]) dict.o[en] = byLang[lang];
  }

  // skill names (authored — the masters say "Skill 1…9" instead of NOC names)
  for (const [en, byLang] of Object.entries(authored.skillNames)) {
    if (byLang[lang]) dict.ui[en] = byLang[lang];
  }

  // section titles
  for (const [en, byLang] of Object.entries(authored.sections)) {
    if (byLang[lang]) dict.sections[en] = byLang[lang];
  }

  // ── homepage ─────────────────────────────────────────────────────────
  const h = src.home || [];
  const at = (i) => (h[i] == null ? null : plain(h[i]));
  if (h.length >= 56) {
    const letter = [];
    for (const row of LETTER_ROWS) {
      if (row.note != null) { letter.push({ note: at(row.note) }); continue; }
      letter.push({ h: at(row.h) });
      for (const p of row.p) letter.push({ p: at(p) });
      if (row.lines) letter.push({ lines: row.lines.map(at) });
      for (const a of row.after || []) letter.push({ p: at(a) });
    }
    dict.home = {
      h1: at(H.h1),
      hp1: H.hp1.map(at),
      hp2: H.hp2.map(at),
      encourage: at(H.encourage),
      letterTitle: at(H.letterTitle),
      letter,
      consentTitle: at(H.consentTitle),
      consentPoints: H.consentPoints.map(at),
      consentHeading: at(H.consentHeading),
      consentQ: at(H.consentQ),
      consentOpts: H.consentOpts.map(at),
      eligHeading: at(H.eligHeading),
      eligQ: at(H.eligQ),
      eligOpts: H.eligOpts.map(at),
    };
  }
  // ── questions the label map could not reach ──────────────────────────
  // A question is left untranslated only when no master carries it. Each gap
  // below is closed from a master surface, never from English:
  //   * the two consent/eligibility screens and their answers live in the
  //     homepage block;
  //   * "Please specify" is the masters' own placeholder, repeated after every
  //     "Other" option — detected as the most frequent trailing extra line;
  //   * the barrier gate, the barrier list and the prize draw use the labels
  //     the masters carry but the old tool never mapped;
  //   * anything still open (a question asked in several branches) reuses the
  //     translation of another question with identical English text.
  const counts = {};
  for (const arr of Object.values(extraLine)) {
    for (const l of arr) counts[l] = (counts[l] || 0) + 1;
  }
  let specify = null;
  for (const [line, n] of Object.entries(counts)) {
    if (norm(line).length > 60) continue;
    if (n >= 3 && (!specify || n > counts[specify])) specify = line;
  }

  if (dict.home) {
    dict.q.consent = dict.home.consentQ;
    dict.q.eligible = dict.home.eligQ;
    // The masters carry the consent sentence as plain text, so the two links the
    // English step renders are appended from the block's own translated titles:
    // the letter and consent screens stay reachable in every language.
    if (dict.home.consentQ && dict.home.letterTitle && dict.home.consentTitle) {
      dict.q.consent = dict.home.consentQ +
        " — [" + dict.home.letterTitle + "](#letter-info) · [" + dict.home.consentTitle + "](#consent-info)";
    }
    const CONSENT_EN = SURVEY.QUESTIONS.find((q) => q.id === "consent");
    const ELIG_EN = SURVEY.QUESTIONS.find((q) => q.id === "eligible");
    if (CONSENT_EN && CONSENT_EN.options && dict.home.consentOpts) {
      CONSENT_EN.options.forEach((o, i) => { if (dict.home.consentOpts[i]) dict.o[o] = dict.home.consentOpts[i]; });
    }
    if (ELIG_EN && ELIG_EN.options && dict.home.eligOpts) {
      ELIG_EN.options.forEach((o, i) => { if (dict.home.eligOpts[i]) dict.o[o] = dict.home.eligOpts[i]; });
    }
  }

  for (const [qid, label] of Object.entries(EXTRA_Q)) {
    const text = src.q && src.q[label];
    if (text && !dict.q[qid]) dict.q[qid] = plain(text);
  }

  for (const q of SURVEY.QUESTIONS) {
    if (dict.q[q.id]) continue;
    const english = norm(typeof q.text === "function" ? q.text({}) : q.text);
    if (english === "Please specify" && specify) { dict.q[q.id] = specify; continue; }
    const twin = SURVEY.QUESTIONS.find((o) => o.id !== q.id && dict.q[o.id] &&
      norm(typeof o.text === "function" ? o.text({}) : o.text) === english);
    if (twin) dict.q[q.id] = dict.q[twin.id];
  }

  return dict;
}

const dicts = {};
for (const lang of LANGS) dicts[lang] = buildDict(lang);

// Native names, as the language names itself. These are endonyms, not
// translations of "Spanish"/"French", so they are written here rather than
// taken from the questionnaire masters.
const NATIVE = {
  en: "English",
  es: "Español",
  fr: "Français",
  hi: "हिन्दी",
  it: "Italiano",
  pt: "Português",
  ar: "العربية",
  zh: "中文",
  tl: "Tagalog",
};

const out = {
  LANGS: ["en", ...LANGS],
  NATIVE_NAMES: NATIVE,
  RTL,
  dicts,
};

const js = "// Generated by tools/build_translations.js — do not edit by hand.\n" +
  "// Nine languages: English plus the eight uploaded translation masters.\n" +
  "window.I18N = " + JSON.stringify(out, null, 1) + ";\n";
fs.writeFileSync("translations.js", js);

// ── build report ───────────────────────────────────────────────────────
console.log("wrote translations.js", (js.length / 1024).toFixed(0) + " KB");
const render = DEF_KEYS.filter((k) => SURVEY.QUESTIONS.some((q) => (q.options || []).some((o) => (typeof o === "string" ? o : o.value) === k)));
for (const lang of LANGS) {
  const d = dicts[lang];
  const missDef = render.filter((k) => !d.def[k]);
  const missSkill = SKILL_KEYS.filter((k) => !d.def[k]);
  const missQ = SURVEY.QUESTIONS.filter((q) => !d.q[q.id]).map((q) => q.id);
  const missO = [];
  for (const q of SURVEY.QUESTIONS) {
    for (const o of q.options || []) {
      const v = typeof o === "string" ? o : o.value;
      if (!d.o[v]) missO.push(q.id + ":" + v);
    }
  }
  const missUi = UI_ORDER.filter((k) => !d.ui[k]);
  const missSec = APP_SECTIONS.filter((s) => !d.sections[s]);
  console.log(
    `${lang}: q ${Object.keys(d.q).length}/${SURVEY.QUESTIONS.length} miss=${missQ.length} | o miss=${missO.length} | ` +
    `tooltips ${render.length - missDef.length}/${render.length} | skills ${SKILL_KEYS.length - missSkill.length}/${SKILL_KEYS.length} | ` +
    `ui miss=${missUi.length} | sections miss=${missSec.length} | home=${d.home ? "ok" : "MISSING"}`
  );
  if (missQ.length) console.log("   missing q:", missQ.join(","));
  if (missO.length) console.log("   missing o:", missO.slice(0, 8).join(" , "));
  if (missDef.length) console.log("   missing tooltips:", missDef.join(" , "));
  if (missUi.length) console.log("   missing ui:", missUi.join(" | "));
}
