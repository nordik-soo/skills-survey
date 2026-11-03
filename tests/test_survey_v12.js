#!/usr/bin/env node
/**
 * Spec tests for the v12 survey (Newcomer Survey 2026 v.12.xlsx).
 *
 * These assert the survey definition as data: question presence, exact wording,
 * exact option lists, and the branching (relevant) rules. Run with:
 *
 *     node tests/test_survey_v12.js
 *
 * No dependencies — survey-data.js and translations.js are loaded into a bare
 * vm context so this runs anywhere node runs.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");

function loadSurvey() {
  const ctx = { window: {}, console };
  ctx.global = ctx;
  vm.createContext(ctx);
  for (const f of ["noc-data.js", "cip-data.js", "survey-data.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx, { filename: f });
  }
  return ctx.window.SURVEY;
}

const SURVEY = loadSurvey();
const Q = SURVEY.QUESTIONS;
const byId = (id) => Q.find((q) => q.id === id);

// ── tiny harness ─────────────────────────────────────────────────────────
let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
  }
}
function eq(actual, expected, what) {
  if (actual !== expected) {
    throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function deepEq(actual, expected, what) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${what || "value"}:\n  expected ${b}\n  actual   ${a}`);
}
function ok(cond, what) {
  if (!cond) throw new Error(what || "expected truthy");
}
function text(q) {
  return typeof q.text === "function" ? q.text({}) : q.text;
}
function visible(id, answers) {
  const q = byId(id);
  if (!q) throw new Error(`no question ${id}`);
  if (typeof q.visible !== "function") return true;
  return q.visible(answers) === true;
}
function options(id) {
  return byId(id).options.map((o) => (o && o.label ? o.label : o));
}
const includes = (arr, v) => Array.isArray(arr) && arr.indexOf(v) !== -1;

// The v12 answer sets used across the branch tests.
const PR = "Permanent resident";
const NPR = "Non-permanent resident (e.g., work permit, study permit, refugee claimant)";
const EMP = {
  fullPerm: "Employed full time permanent (30+ hours/week)",
  partPerm: "Employed part time permanent (10-30 hours/week)",
  casual: "Employed casual (less than 10 hours/week)",
  contractFull: "Employed contract full time (30+ hours/week)",
  contractPart: "Employed contract part time (10-30 hours/week)",
  household: "Household work / Caregiver",
  tempLeave: "On temporary leave from a job (e.g., maternity/parental leave)",
  retired: "Retired",
  self: "Self-employed",
  student: "Student or recent graduate",
  unable: "Unable to work",
  unempLook: "Unemployed and actively looking for work",
  unempNotLook: "Unemployed and not looking for work",
};

// ── structure ────────────────────────────────────────────────────────────
test("77 questions in v12", () => eq(Q.length, 77, "question count"));

test("no duplicate question ids", () => {
  const seen = new Set();
  for (const q of Q) {
    ok(!seen.has(q.id), `duplicate id ${q.id}`);
    seen.add(q.id);
  }
});

test("every question has an id, a section and renderable text", () => {
  for (const q of Q) {
    ok(typeof q.id === "string" && q.id.length, "id");
    ok(typeof q.section === "string" && q.section.length, `section of ${q.id}`);
    ok(typeof q.type === "string" && q.type.length, `type of ${q.id}`);
    const t = text(q);
    ok(typeof t === "string" && t.trim().length, `text of ${q.id}`);
    if (q.options) ok(q.options.length > 0, `empty options on ${q.id}`);
  }
});

test("every section is declared in SECTIONS (Language is the pre-step)", () => {
  for (const q of Q) {
    if (q.section === "Language") continue;
    ok(SURVEY.SECTIONS.indexOf(q.section) !== -1, `undeclared section ${q.section}`);
  }
});

test("Retention is a declared section, ordered before the gift-card draw", () => {
  ok(SURVEY.SECTIONS.indexOf("Retention") !== -1, "Retention missing from SECTIONS");
  ok(
    SURVEY.SECTIONS.indexOf("Retention") > SURVEY.SECTIONS.indexOf("Section D: Skills"),
    "Retention must follow Section D"
  );
  ok(
    SURVEY.SECTIONS.indexOf("Retention") < SURVEY.SECTIONS.indexOf("Gift Card Draw"),
    "Retention must precede Gift Card Draw"
  );
  const ids = Q.map((q) => q.id);
  ok(ids.indexOf("gift_card_draw") === ids.length - 1, "gift_card_draw must stay last");
});

test("option lists contain no duplicates", () => {
  for (const q of Q) {
    if (!Array.isArray(q.options)) continue;
    const vals = q.options.map((o) => (o && o.label ? o.label : o)).filter((o) => typeof o === "string");
    if (vals.length !== q.options.length) continue; // picklists hold objects
    eq(new Set(vals).size, vals.length, `duplicate option in ${q.id}`);
  }
});

// ── v12 content: wording that changed ────────────────────────────────────
test("eligibility asks about Sault Ste. Marie after November 2021", () => {
  eq(
    text(byId("eligible")),
    "Did you move to Sault Ste. Marie after November 2021 with the intention of living here?",
    "eligible text"
  );
});

test("status question is 'What is your status in Canada?' with v12 options", () => {
  eq(text(byId("immigration_category")), "What is your status in Canada?", "status text");
  deepEq(
    options("immigration_category"),
    [
      "Canadian citizen",
      PR,
      NPR,
      "None of the above (do not select any other options)",
      "Prefer not to answer",
    ],
    "status options"
  );
});

test("status is asked of everyone; the two category selects are gated", () => {
  ok(visible("immigration_category", {}), "status must always show");
  ok(!visible("non_permanent_category", {}), "non-permanent category hidden until answered");
  ok(visible("non_permanent_category", { immigration_category: NPR }), "visible for non-permanent");
  ok(!visible("non_permanent_category", { immigration_category: PR }), "hidden for permanent");
  ok(visible("permanent_category", { immigration_category: PR }), "visible for permanent");
  ok(!visible("permanent_category", { immigration_category: NPR }), "hidden for non-permanent");
  deepEq(
    options("permanent_category"),
    ["Economic Immigrant", "Family Sponsored", "Refugee"],
    "permanent resident categories"
  );
});

test("identity is single-select with four v12 options", () => {
  eq(byId("identity_groups").type, "single", "identity type");
  deepEq(
    options("identity_groups"),
    [
      "Indigenous (First Nations, Métis, Inuit/Inuk)",
      "Visible minority (e.g., South Asian, Chinese, Black)",
      "None of the above (do not select any other options)",
      "Prefer not to answer",
    ],
    "identity options"
  );
  ok(!/select all that apply/i.test(text(byId("identity_groups"))), "identity must not ask select-all");
});

test("no mojibake in any v12 string", () => {
  const strings = [];
  for (const q of Q) {
    const t = text(q);
    if (typeof t === "string") strings.push(t);
    if (Array.isArray(q.options)) {
      for (const o of q.options) if (typeof o === "string") strings.push(o);
    }
  }
  for (const s of strings) {
    ok(!/Ã|â€/.test(s), `mojibake in: ${s}`);
  }
});

test("employment status has the 13 v12 options", () => {
  const opts = options("employment_status");
  eq(opts.length, 13, "employment option count");
  for (const expected of [EMP.fullPerm, EMP.partPerm, EMP.casual, EMP.contractFull, EMP.contractPart]) {
    ok(includes(opts, expected), `missing ${expected}`);
  }
});

test("barrier / reason / gender / age / education lists match v12", () => {
  eq(options("work_barriers").length, 18, "work_barriers");
  eq(options("unemployment_reasons").length, 17, "unemployment_reasons");
  eq(options("not_looking_reasons").length, 10, "not_looking_reasons");
  eq(options("gender").length, 5, "gender");
  eq(options("age_group").length, 9, "age_group");
  eq(options("recent_credential").length, 9, "recent_credential");
  eq(options("recent_credential")[0], "No formal education", "education first option");
  ok(includes(options("age_group"), "Prefer not to answer"), "age must offer prefer not to answer");
  ok(includes(options("gender"), "Prefer not to answer"), "gender must offer prefer not to answer");
  ok(includes(options("not_looking_reasons"), "Prefer not to answer"), "not-looking reasons prefer not to answer");
  ok(includes(options("not_looking_expect_look"), "Don't know"), "expect-to-look must offer Don't know");
});

test("language list drops four and adds Somali + Farsi", () => {
  const opts = options("language");
  eq(opts.length, 18, "language option count");
  for (const gone of ["Finnish", "Malayalam", "Kurdish", "Polish"]) {
    ok(!includes(opts, gone), `${gone} should be removed`);
  }
  for (const added of ["Somali", "Farsi"]) ok(includes(opts, added), `${added} should be added`);
});

test("occupation questions end with 'Select the closest match'", () => {
  for (const id of [
    "previous_job_title", "home_country_job", "current_job_title",
    "intended_job_title", "student_current_job", "planned_intended_job",
  ]) {
    ok(/Select the closest match$/.test(text(byId(id))), `${id} missing suffix`);
  }
});

test("job-search help questions no longer say 'Northern Ontario'", () => {
  for (const id of ["job_search_help", "student_job_help"]) {
    const t = text(byId(id));
    ok(!/Northern Ontario/.test(t), `${id} still mentions Northern Ontario`);
    ok(/Sault Ste\. Marie/.test(t), `${id} must name Sault Ste. Marie`);
  }
});

test("draw question names the laptop and VISA gift cards", () => {
  ok(/prize draw for laptop and VISA gift cards/i.test(text(byId("gift_card_draw"))), "draw wording");
});

test("new v12 questions exist with the sheet's wording", () => {
  const expected = {
    reason: "Why did you choose to move to Sault Ste. Marie?",
    highest_completed_location: "Where did you complete your highest level of education?",
    skill_match: "Do you feel that your current job matches your skills?",
    work_confidence: "How confident are you communicating in English in the workplace?",
    student_skill_match: "Do you feel that your current job matches your skills?",
    student_confidence: "How confident are you communicating in English in the workplace?",
    retain_5_years: "Do you expect to remain in Sault Ste. Marie over the next five years?",
    recommend_survey: "Would you recommend that other newcomers complete this survey?",
  };
  for (const [id, t] of Object.entries(expected)) {
    ok(byId(id), `missing question ${id}`);
    eq(text(byId(id)), t, `${id} text`);
  }
  ok(byId("leave_factors"), "missing leave_factors");
  ok(/Select all that apply/.test(text(byId("leave_factors"))), "leave_factors is select-all");
  eq(options("leave_factors").length, 17, "leave_factors option count");
  eq(options("reason").length, 5, "reason option count");
  eq(options("skill_match").length, 5, "skill_match option count");
  eq(options("work_confidence").length, 4, "confidence option count");
  eq(options("retain_5_years").length, 5, "retention option count");
});

// ── branching: education ─────────────────────────────────────────────────
test("program_location needs a completed credential other than 'No formal education'", () => {
  ok(!visible("program_location", {}), "hidden with no answer");
  ok(!visible("program_location", { recent_credential: "No formal education" }), "hidden for no formal education");
  ok(visible("program_location", { recent_credential: "College certificate" }), "shown for a credential");
});

test("highest_education is skipped for international students and for no formal education", () => {
  ok(!visible("highest_education", {}), "hidden with no answers");
  ok(
    !visible("highest_education", { non_permanent_category: "International Student", recent_credential: "Diploma" }),
    "hidden for international students"
  );
  ok(!visible("highest_education", { recent_credential: "No formal education" }), "hidden for no formal education");
  ok(visible("highest_education", { recent_credential: "Diploma" }), "shown otherwise");
});

test("highest_completed_location follows the highest-education question", () => {
  ok(!visible("highest_completed_location", {}), "hidden before answering");
  ok(
    visible("highest_completed_location", { highest_education: "No", recent_credential: "Diploma" }),
    "shown when the credential is not the highest"
  );
  ok(
    !visible("highest_completed_location", { highest_education: "Yes", recent_credential: "Diploma" }),
    "hidden when it is the highest"
  );
  deepEq(options("highest_completed_location"), ["In Canada", "Outside Canada"], "completion location options");
});

// ── branching: working block and barrier gates ───────────────────────────
test("working block covers self-employed through contract staff, not students", () => {
  for (const st of [EMP.self, EMP.casual, EMP.partPerm, EMP.fullPerm, EMP.tempLeave, EMP.contractFull, EMP.contractPart]) {
    ok(visible("current_job_title", { employment_status: st }), `working block for ${st}`);
  }
  for (const st of [EMP.student, EMP.retired, EMP.household, EMP.unempLook, EMP.unempNotLook, EMP.unable]) {
    ok(!visible("current_job_title", { employment_status: st }), `no working block for ${st}`);
  }
});

test("job-search help is asked of employees only; 'Other' only for non-contract staff", () => {
  for (const st of [EMP.casual, EMP.partPerm, EMP.fullPerm, EMP.contractFull, EMP.contractPart]) {
    ok(visible("job_search_help", { employment_status: st }), `help for ${st}`);
  }
  for (const st of [EMP.self, EMP.tempLeave]) {
    ok(!visible("job_search_help", { employment_status: st }), `no help for ${st}`);
  }
  const other = { employment_status: EMP.fullPerm, job_search_help: ["Other"] };
  ok(visible("job_search_other", other), "other shown for full time permanent");
  ok(!visible("job_search_other", { employment_status: EMP.contractFull, job_search_help: ["Other"] }),
    "other hidden for contract staff");
});

test("barrier gate: one question, wording by status × intended match", () => {
  const gate = (answers) => byId("work_barrier_gate").text(answers);
  const casualPart = [EMP.casual, EMP.partPerm, EMP.contractPart];
  const fullish = [EMP.fullPerm, EMP.contractFull];

  // Gate shown for casual/part/contract-part once the match answer exists, and for
  // full/contract-full only when the current job is not the intended one.
  for (const st of casualPart) {
    ok(!visible("work_barrier_gate", { employment_status: st }), `gate hidden before match answer (${st})`);
    ok(visible("work_barrier_gate", { employment_status: st, intended_job: "Yes" }), `gate shown (${st})`);
    ok(visible("work_barrier_gate", { employment_status: st, intended_job: "No" }), `gate shown (${st})`);
  }
  for (const st of fullish) {
    ok(!visible("work_barrier_gate", { employment_status: st }), `gate hidden before match answer (${st})`);
    ok(!visible("work_barrier_gate", { employment_status: st, intended_job: "Yes" }),
      `no gate when already in the intended job (${st})`);
    ok(visible("work_barrier_gate", { employment_status: st, intended_job: "No" }), `gate shown (${st})`);
  }
  // Self-employed and temp-leave have no gate in v12.
  for (const st of [EMP.self, EMP.tempLeave]) {
    ok(!visible("work_barrier_gate", { employment_status: st, intended_job: "Yes" }), `no gate for ${st}`);
  }
  // Sheet C_barrier_a: casual/part/contract-part AND the job matches.
  for (const st of casualPart) {
    eq(gate({ employment_status: st, intended_job: "Yes" }),
      "Is there a barrier preventing you from getting a full time job?", `gate A for ${st}`);
    eq(gate({ employment_status: st, intended_job: "No" }),
      "Is there a barrier preventing you from working full time and from doing intended job?", `gate C for ${st}`);
  }
  // Sheet C_barrier_b: full time staff whose job is NOT the intended one.
  for (const st of fullish) {
    eq(gate({ employment_status: st, intended_job: "No" }),
      "Is there a barrier preventing you from doing your intended job?", `gate B for ${st}`);
  }
  // Full time staff in their intended job get no gate at all.
  ok(!visible("work_barrier_gate", { employment_status: EMP.fullPerm, intended_job: "Yes" }), "no gate B case");
});

test("gate translations keys line up with the three wordings", () => {
  const q = byId("work_barrier_gate");
  ok(typeof q.textKey === "function", "gate needs a textKey");
  const seen = new Set();
  for (const st of [EMP.casual, EMP.fullPerm, EMP.contractFull]) {
    for (const intended of ["Yes", "No"]) {
      const a = { employment_status: st, intended_job: intended };
      if (!q.visible(a)) continue;
      const key = q.textKey(a);
      ok(/^work_barrier\.[abc]$/.test(key), `unexpected key ${key}`);
      seen.add(key);
      eq(q.text(a), byId("work_barrier_gate").text(a), "text is deterministic");
    }
  }
  ok(seen.size === 3, `expected all three gate keys, saw ${[...seen].join(",")}`);
});

test("barriers and support follow a Yes gate, and 'Other' reveals a specify field", () => {
  const yes = { employment_status: EMP.fullPerm, intended_job: "No", work_barrier_gate: "Yes" };
  ok(visible("work_barriers", yes), "barriers after a Yes gate");
  ok(!visible("work_barriers", { ...yes, work_barrier_gate: "No" }), "no barriers after No");
  ok(visible("work_support", yes), "support after a Yes gate");
  ok(!visible("work_support", { ...yes, work_barrier_gate: "No" }), "no support after No");
  ok(visible("work_barriers_other", { ...yes, work_barriers: ["Other"] }), "other specify");
  ok(!visible("work_barriers_other", { ...yes, work_barriers: ["Health issues"] }), "no other specify");
  ok(visible("work_support_other", { ...yes, work_support: ["Other"] }), "support other specify");
});

test("skill match and confidence are asked in the working block", () => {
  for (const st of [EMP.self, EMP.casual, EMP.fullPerm, EMP.tempLeave, EMP.contractFull]) {
    ok(visible("skill_match", { employment_status: st }), `skill_match for ${st}`);
    ok(visible("work_confidence", { employment_status: st }), `confidence for ${st}`);
  }
  ok(!visible("skill_match", { employment_status: EMP.unempLook }), "no skill_match when unemployed");
});

// ── branching: unemployed and not-looking blocks ─────────────────────────
test("unemployed block: gate -> reasons/support", () => {
  const base = { employment_status: EMP.unempLook };
  ok(visible("unemployed_intended_job", base), "intended job asked");
  ok(visible("unemployed_barrier_gate", base), "gate asked");
  ok(!visible("unemployment_reasons", base), "reasons hidden until gate answered");
  ok(visible("unemployment_reasons", { ...base, unemployed_barrier_gate: "Yes" }), "reasons after Yes");
  ok(visible("unemployed_support", { ...base, unemployed_barrier_gate: "Yes" }), "support after Yes");
  ok(!visible("unemployment_reasons", { employment_status: EMP.unempNotLook }), "not asked of not-looking group");
});

test("not-looking block covers the four v12 statuses", () => {
  for (const st of [EMP.unempNotLook, EMP.unable, EMP.retired, EMP.household]) {
    ok(visible("not_looking_reasons", { employment_status: st }), `not-looking block for ${st}`);
  }
  for (const st of [EMP.unempLook, EMP.student, EMP.fullPerm]) {
    ok(!visible("not_looking_reasons", { employment_status: st }), `no not-looking block for ${st}`);
  }
  ok(
    !visible("not_looking_intended_job", { employment_status: EMP.retired, not_looking_expect_look: "Don't know" }),
    "intended job hidden for Don't know"
  );
  ok(
    visible("not_looking_intended_job", { employment_status: EMP.retired, not_looking_expect_look: "Yes" }),
    "intended job after Yes"
  );
});

// ── branching: student block ─────────────────────────────────────────────
test("student block needs both 'student' and an international study permit", () => {
  ok(!visible("student_working", { employment_status: EMP.student }), "needs the permit answer too");
  ok(
    visible("student_working", { employment_status: EMP.student, non_permanent_category: "International Student" }),
    "shown for international students"
  );
  ok(
    !visible("student_working", { employment_status: EMP.fullPerm, non_permanent_category: "International Student" }),
    "not shown to employed non-students"
  );
});

test("student skill match and confidence are in the block, job questions need a job", () => {
  const base = { employment_status: EMP.student, non_permanent_category: "International Student" };
  ok(visible("student_skill_match", base), "student skill match");
  ok(visible("student_confidence", base), "student confidence");
  ok(!visible("student_skill_match", {}), "hidden on a blank survey");
  ok(!visible("student_current_job", base), "job title hidden until working is answered");
  ok(visible("student_current_job", { ...base, student_working: "Yes" }), "job title after Yes");
  ok(visible("student_barrier_gate", base), "student gate");
  ok(!visible("student_barriers", base), "student barriers hidden until gate answered");
  ok(visible("student_barriers", { ...base, student_barrier_gate: "Yes" }), "student barriers after Yes");
});

// ── branching: retention ─────────────────────────────────────────────────
test("retention R1 is asked of everyone", () => {
  ok(visible("retain_5_years", {}), "R1 must be unconditional");
  ok(visible("recommend_survey", {}), "R3 must be unconditional");
});

test("leave factors follow Not sure / Probably not / Definitely not", () => {
  for (const r1 of ["Not sure", "Probably not", "Definitely not"]) {
    ok(visible("leave_factors", { retain_5_years: r1 }), `leave factors for ${r1}`);
  }
  for (const r1 of ["Definitely yes", "Probably yes"]) {
    ok(!visible("leave_factors", { retain_5_years: r1 }), `no leave factors for ${r1}`);
  }
  ok(!visible("leave_factors", {}), "leave factors hidden before R1");
  ok(visible("leave_factors_other", { leave_factors: ["Other"] }), "leave other specify");
});

// ── invariants ───────────────────────────────────────────────────────────
test("every visible() returns a strict boolean, and hides on a blank survey", () => {
  for (const q of Q) {
    if (typeof q.visible !== "function") continue;
    const r = q.visible({});
    ok(r === true || r === false, `${q.id} returned ${typeof r}`);
  }
  // Only the unconditional questions may show before any answer.
  const unconditional = new Set([
    "language", "consent", "eligible", "moved_from", "gender", "age_group",
    "immigration_category", "identity_groups", "reason", "recent_credential",
    "employed_before", "employment_status", "retain_5_years", "recommend_survey",
    "gift_card_draw", "skills", "program_location",
  ]);
  for (const q of Q) {
    if (typeof q.visible !== "function" || q.visible({}) !== true) continue;
    ok(unconditional.has(q.id), `${q.id} should not show on a blank survey`);
  }
});

test("dependent questions never show without their parent answer", () => {
  const pairs = [
    ["reason_other", "reason"],
    ["program_name", "recent_credential"],
    ["previous_job_title", "employed_before"],
    ["home_emp_before", "immigration_category"],
    ["home_country_job", "home_emp_before"],
    ["intended_job_title", "intended_job"],
    ["job_search_other", "job_search_help"],
    ["work_barriers_other", "work_barriers"],
    ["work_support_other", "work_support"],
    ["unemployment_reasons_other", "unemployment_reasons"],
    ["not_looking_other", "not_looking_reasons"],
    ["not_looking_barriers_other", "not_looking_barriers"],
    ["not_looking_support_other", "not_looking_support"],
    ["student_job_help_other", "student_job_help"],
    ["student_barriers_other", "student_barriers"],
    ["student_support_other", "student_support"],
    ["leave_factors_other", "leave_factors"],
    ["permanent_category", "immigration_category"],
    ["non_permanent_category", "immigration_category"],
  ];
  for (const [child, parent] of pairs) {
    ok(byId(parent), `missing parent ${parent}`);
    ok(!visible(child, {}), `${child} must not show without ${parent}`);
  }
});

// ── persistence mapping (api/server.js) ──────────────────────────────────
test("server exposes every v12 question that needs a column", () => {
  const src = fs.readFileSync(path.join(ROOT, "api", "server.js"), "utf8");
  const mapped = [
    "permanent_resident_category", "reason_to_move", "reason_to_move_other",
    "highest_completed_location", "skill_match", "work_confidence",
    "student_skill_match", "student_confidence",
    "retain_5_years", "leave_factors", "leave_factors_other", "recommend_survey",
  ];
  for (const col of mapped) {
    ok(src.includes(col), `server.js has no column mapping for ${col}`);
  }
  ok(/GATE_COLS = \["C_barrier_a", "C_barrier_b", "C_barrier_c"\]/.test(src), "v12 has exactly three barrier gates");
  ok(src.includes("section_e_retention"), "retention table missing");
  ok(src.includes("survey_version"), "submissions must record their survey version");
});

test("v12 export field names are used for the remapped questions", () => {
  const src = fs.readFileSync(path.join(ROOT, "api", "server.js"), "utf8");
  const pairs = [
    ['immigration_category: "A3"', "status is A3"],
    ['non_permanent_resident_category: "A3_a"', "non-permanent category is A3_a"],
    ['permanent_resident_category: "A3_b"', "permanent category is A3_b"],
    ['reason_to_move: "A5"', "reason is A5"],
    ['highest_completed_location: "B6_a_ii"', "completion location is B6_a_ii"],
    ['skill_match: "C8_skillmatch"', "skill match is C8_skillmatch"],
    ['work_confidence: "C9_confidence"', "confidence is C9_confidence"],
    ['retain_5_years: "R1"', "retention is R1"],
    ['recommend_survey: "R3"', "recommend is R3"],
  ];
  for (const [needle, why] of pairs) ok(src.includes(needle), why);
});

test("translations register the two new languages", () => {
  const src = fs.readFileSync(path.join(ROOT, "translations.js"), "utf8");
  ok(/Somali: "so"/.test(src), "Somali code");
  ok(/Farsi: "fa"/.test(src), "Farsi code");
});

// ── report ───────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\nFAIL — ${failures.length} of ${passed + failures.length} tests failed:\n`);
  for (const f of failures) console.error("  ✗ " + f);
  process.exit(1);
}
console.log(`PASS — ${passed} tests`);
