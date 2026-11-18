#!/usr/bin/env node
/**
 * Fill the missing per-language wording from tests/fixtures/lang-docx.json.
 *
 * The thirteen non-Bengali dictionaries never received twelve question prompts
 * or twenty-two questions' option lists, so those rendered in English. The
 * fixture holds the reviewed document wording for them; this script inserts it
 * into _maps/<lang>.js (the rebuild source) and into the shipped DICT in
 * translations.js.
 *
 * Safety
 *  * Only keys that are missing are added. No existing translation is replaced.
 *  * Every label is checked against the app's own English prompt before its
 *    translation is used; a label that does not match is reported and skipped.
 *  * --write is required to change anything; the default is a dry run.
 *
 * Run: node tools/apply_lang_docx.js            (report only)
 *      node tools/apply_lang_docx.js --write    (apply)
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const FIXTURE = path.join(ROOT, "tests/fixtures/lang-docx.json");
const WRITE = process.argv.includes("--write");

// questionnaire label -> app question id (the mapping the Bengali build uses)
const MAP = {
  language: null, // the language selector is not part of the document
  moved_from: "ID_A_01", province: "ID_A_01_a", country_moved_from: "ID_A_01_b",
  gender: "ID_A_02", age_group: "ID_A_03", immigration_category: "ID_A_04_a",
  non_permanent_category: "ID_A_04_a_i", permanent_category: "ID_A_04_b_i",
  identity_groups: "ID_A_04_b", reason: "ID_A_05",
  recent_credential: "ID_B_01", program_name: "ID_B_02", program_name_other: "ID_B_02_a",
  program_location: "ID_B_03", highest_education: "ID_B_04", highest_credential: "ID_B_04_a",
  highest_program_name: "ID_B_04_b", highest_program_name_other: "ID_B_04_b_1",
  highest_completed_location: "ID_B_04_c", current_program: "ID_B_05",
  current_program_name: "ID_B_05_a", current_program_name_other: "ID_B_05_a_1",
  employed_before: "ID_C_01", previous_job_title: "ID_C_01_a", home_emp_before: "ID_C_01_b",
  home_country_job: "ID_C_01_b_1", employment_status: "ID_C_02",
  current_job_title: "ID_C_1_1", intended_job: "ID_C_1_2", intended_job_title: "ID_C_1_2_a",
  job_search_help: "ID_C_1_3", work_barriers: "ID_C_1_4_a", work_support: "ID_C_1_4_b",
  skill_match: "ID_C_1_5", work_confidence: "ID_C_1_6",
  unemployed_intended_job: "ID_C_2_1", unemployed_barrier_gate: "ID_C_2_2",
  unemployment_reasons: "ID_C_2_2_a", unemployed_support: "ID_C_2_2_b",
  not_looking_reasons: "ID_C_3_1", not_looking_expect_look: "ID_C_3_2",
  not_looking_intended_job: "ID_C_3_2_a", not_looking_barrier_gate: "ID_C_3_2_b",
  not_looking_barriers: "ID_C_3_2_b_1", not_looking_support: "ID_C_3_2_b_2",
  student_working: "ID_C_4_1", student_current_job: "ID_C_4_1_a",
  student_job_relevant: "ID_C_4_1_b", student_skill_match: "ID_C_4_1_c",
  student_confidence: "ID_C_4_1_d", student_job_help: "ID_C_4_1_e",
  student_barrier_gate: "ID_C_4_2", student_barriers: "ID_C_1_4_a",
  student_support: "ID_C_4_2_b", planned_intended_job: "ID_C_4_3",
  skills: "ID_D_1",
  retain_5_years: "ID_E_1", leave_factors: "ID_E_2", recommend_survey: "ID_E_3",
};
// "Please specify" inputs: their prompt is the document's own specify line.
const SPECIFY = ["non_permanent_other", "reason_other", "program_name_other",
  "highest_program_name_other", "current_program_name_other", "job_search_other",
  "work_barriers_other", "work_support_other", "unemployment_reasons_other",
  "unemployed_support_other", "not_looking_other", "not_looking_barriers_other",
  "not_looking_support_other", "student_job_help_other", "student_barriers_other",
  "student_support_other", "leave_factors_other"];

// Lists that stay in English by an earlier decision: the country picklist, the
// language selector (each language is shown in its own name) and the skills
// definitions, which the app pulls from the English data.
const ENGLISH_BY_DECISION = new Set(["country_moved_from", "language", "skills"]);

const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

function loadApp() {
  const ctx = { window: {}, console };
  vm.createContext(ctx);
  for (const f of ["survey-data.js", "translations.js"]) vm.runInContext(read(f), ctx, { filename: f });
  return ctx.window;
}

const norm = (s) =>
  String(s || "")
    .replace(/\[[^\]]*\]/g, " ") // routing notes are not part of the wording
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const W = loadApp();
const QUESTIONS = W.SURVEY.QUESTIONS;
const DICT = W.I18N.dicts;
const fixture = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
const enQ = fixture._en.q;
const enO = fixture._en.o;

const englishOf = (q) => (typeof q.text === "function" ? q.text({}) : String(q.text || ""));
const optionValues = (q) => (q.options || []).map((o) => (typeof o === "string" ? o : o.value));

// Some labels differ from the app's English only cosmetically (the documents
// carry a stray "?" or fold the rating scale into the prompt). They are not
// failures, and the questions they belong to already have their wording.
const COSMETIC = new Set(["work_support", "unemployed_support", "not_looking_support",
  "student_support", "skills"]);

// The app asks "Don't know"; the document offers "Not sure" in that position.
const BORROWED = { "Don't know": "not sure" };

// A question whose prompt is chosen at run time keeps its wording under those
// dynamic keys, which every dictionary already carries.
const isDynamic = (q) => typeof q.textKey === "function";

// ── 1. verify the label mapping against the app's English wording ──────────
const problems = [];
const labelFor = {}; // qid -> label
for (const [qid, label] of Object.entries(MAP)) {
  if (!label) continue;
  const q = QUESTIONS.find((x) => x.id === qid);
  if (!q) { problems.push(`no question ${qid}`); continue; }
  const docEn = enQ[label];
  if (!docEn) { problems.push(`${qid}: label ${label} not in fixture`); continue; }
  if (norm(docEn) !== norm(englishOf(q)) && !COSMETIC.has(qid)) {
    problems.push(`${qid} vs ${label}: app "${englishOf(q)}" / doc "${docEn}"`);
  }
  labelFor[qid] = label;
}

// ── 2. work out what is missing per language ───────────────────────────────
const plan = {};
for (const lang of Object.keys(fixture)) {
  if (lang === "_en") continue;
  const d = DICT[lang];
  const fx = fixture[lang];
  const q = {}; // qid -> translated prompt
  const o = {}; // english option value -> translated label
  const unfilled = [];

  for (const question of QUESTIONS) {
    if (ENGLISH_BY_DECISION.has(question.id)) continue;
    if (isDynamic(question)) continue;
    const have = d.q && d.q[question.id];
    if (have) continue;
    const label = labelFor[question.id];
    const text = label ? fx.q[label] : SPECIFY.includes(question.id) ? fx.o["please specify"] : null;
    if (text) q[question.id] = text;
    else unfilled.push("prompt:" + question.id);
  }

  for (const question of QUESTIONS) {
    if (ENGLISH_BY_DECISION.has(question.id)) continue;
    if (question.type === "picklist" || question.type === "contact" || question.type === "text" || question.type === "textarea") continue;
    for (const value of optionValues(question)) {
      if (o[value] !== undefined) continue;
      if (d.o && d.o[value] !== undefined) continue;
      const tr = fx.o[norm(value)] || fx.o[BORROWED[value]];
      if (tr) o[value] = tr;
      else if (!unfilled.includes("option:" + value)) unfilled.push("option:" + value);
    }
  }
  plan[lang] = { q, o, unfilled };
}

// ── 3. report ──────────────────────────────────────────────────────────────
console.log("label mapping check:", problems.length ? `${problems.length} problems` : "all labels match the app's English wording");
for (const p of problems) console.log("   ! " + p);
console.log("");
console.log("lang  prompts  options  unfilled");
for (const [lang, p] of Object.entries(plan)) {
  console.log(`${lang.padEnd(5)} ${String(Object.keys(p.q).length).padStart(7)} ${String(Object.keys(p.o).length).padStart(8)} ${String(p.unfilled.length).padStart(9)}`);
}
const anyUnfilled = Object.values(plan).flatMap((p) => p.unfilled);
if (anyUnfilled.length) {
  console.log("\nnot supplied by the documents (left as English):");
  for (const u of [...new Set(anyUnfilled)].slice(0, 30)) console.log("   - " + u);
  if (new Set(anyUnfilled).size > 30) console.log(`   ... ${new Set(anyUnfilled).size - 30} more`);
}

if (!WRITE) {
  console.log("\ndry run - pass --write to apply");
  process.exit(0);
}
if (problems.length) {
  console.error("\nrefusing to write while the label mapping has problems");
  process.exit(1);
}

// ── 4. write ───────────────────────────────────────────────────────────────
const quote = (s) => JSON.stringify(s);

/** Insert entries just before the closing brace of `bucket` in `text`. */
function insertInto(text, openLine, closeLine, entries, indent, where) {
  const start = text.indexOf(openLine);
  if (start < 0) throw new Error(`${where}: bucket ${openLine.trim()} not found`);
  const close = text.indexOf(closeLine, start + openLine.length);
  if (close < 0) throw new Error(`${where}: closing brace for ${openLine.trim()} not found`);
  // make sure the previous entry ends with a comma
  const before = text.slice(start + openLine.length, close);
  const trimmed = before.replace(/\s+$/, "");
  const needsComma = trimmed.length > 0 && !trimmed.endsWith(",");
  const body = entries.map(([k, v]) => `${indent}${quote(k)}: ${quote(v)},`).join("\n");
  const patched = (needsComma ? trimmed + "," : trimmed) + "\n" + body + "\n";
  return text.slice(0, start + openLine.length) + patched + text.slice(close);
}

let shipped = read("translations.js");
let written = 0;

for (const [lang, p] of Object.entries(plan)) {
  const qEntries = Object.entries(p.q);
  const oEntries = Object.entries(p.o);
  if (!qEntries.length && !oEntries.length) continue;

  // shipped dictionary: "xx": { "q": { ... }, ..., "o": { ... } }
  const langAt = shipped.indexOf(`    "${lang}": {`);
  if (langAt < 0) throw new Error(`${lang}: dictionary block not found in translations.js`);
  let block = shipped.slice(langAt);
  const blockEnd = block.indexOf('\n    },\n');
  block = block.slice(0, blockEnd);

  let patchedBlock = block;
  if (qEntries.length) {
    patchedBlock = insertInto(patchedBlock, '      "q": {', "      },", qEntries, "        ", `${lang}.q`);
  }
  if (oEntries.length) {
    patchedBlock = insertInto(patchedBlock, '      "o": {', "      },", oEntries, "        ", `${lang}.o`);
  }
  shipped = shipped.slice(0, langAt) + patchedBlock + shipped.slice(langAt + block.length);

  // rebuild source: module.exports = { q: { ... }, o: { ... } }
  const mapFile = `_maps/${lang}.js`;
  let map = read(mapFile);
  if (qEntries.length) map = insertInto(map, "  q: {", "  },", qEntries, "    ", `${lang}.map.q`);
  if (oEntries.length) map = insertInto(map, "  o: {", "  },", oEntries, "    ", `${lang}.map.o`);
  fs.writeFileSync(path.join(ROOT, mapFile), map);
  written += qEntries.length + oEntries.length;
}

fs.writeFileSync(path.join(ROOT, "translations.js"), shipped);
console.log(`\nwrote ${written} entries into translations.js and _maps/`);
