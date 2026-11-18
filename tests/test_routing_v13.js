#!/usr/bin/env node
/**
 * Newcomer Survey 2026 v.13 - routing, English survey.
 *
 * The questions and their conditions are read from survey-data.js and compared
 * against the `relevant` column of "Newcomer Survey 2026 v.13.xlsx". Each check
 * names the v13 field it mirrors.
 *
 * v13 changed eight conditions and two option lists relative to v12:
 *   1. C_student_block          -> every student (was: international students only)
 *   2. S8_skillmatch/S9_confid. -> only a student who is currently working
 *   3. C7_help                  -> adds "On temporary leave" (7)
 *   4. C7_other                 -> same statuses as C7_help (was: 2,3,4)
 *   5. B7/B7_other              -> only credentials 3..8 (was: not 1/2, so 9 slipped in)
 *   6. C_support_unemp_other    -> new "Please specify" for the unemployed support
 *   7. C11_other                -> adds ${C_barrier_unm} = '1'
 *   8. C_18_not_a / C19_not_a   -> add ${C17_not} = '1'
 *   plus C17_not -> list yndlfj ("Didn't look for job") and
 *        S_barrier_a -> list ynna ("Not applicable").
 *
 * Run: node tests/test_routing_v13.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");

let failures = 0;
let checks = 0;

function check(name, fn) {
  checks++;
  try {
    fn();
  } catch (err) {
    failures++;
    console.log(`  x ${name}: ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n     expected ${e}\n     got      ${a}`);
}

// ── load the app's survey definition ──────────────────────────────────────
const ctx = { window: {}, console };
ctx.global = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, "survey-data.js"), "utf8"), ctx, { filename: "survey-data.js" });
const Q = ctx.window.SURVEY.QUESTIONS;

const q = (id) => {
  const found = Q.find((x) => x.id === id);
  assert(found, `question ${id} is missing from survey-data.js`);
  return found;
};
// Does question `id` show for this answer set? (a question with no visible() always does)
const shows = (id, answers) => {
  const question = q(id);
  return question.visible ? !!question.visible(answers) : true;
};
const optionsOf = (id) => (q(id).options || []).map((o) => (typeof o === "string" ? o : o.value));

// ── the statuses v13 uses, by number ──────────────────────────────────────
const EMP = {
  1: "Self-employed",
  2: "Employed casual (less than 10 hours/week)",
  3: "Employed part time permanent (10-30 hours/week)",
  4: "Employed full time permanent (30+ hours/week)",
  5: "Unemployed and not looking for work",
  6: "Unemployed and actively looking for work",
  7: "On temporary leave from a job (e.g., maternity/parental leave)",
  8: "Unable to work",
  9: "Student or recent graduate",
  10: "Retired",
  11: "Household work / Caregiver",
  12: "Employed contract full time (30+ hours/week)",
  13: "Employed contract part time (10-30 hours/week)",
};
const INTL = "Non-permanent resident (e.g., work permit, study permit, refugee claimant)";

// ── the invariant every check below ends with ─────────────────────────────
function assertSurveySane() {
  const ids = Q.map((x) => x.id);
  assert(new Set(ids).size === ids.length, "the question list has a duplicate id");
  assert(ids.length > 70, "the survey shrank unexpectedly");

  for (const question of Q) {
    assert(typeof question.id === "string" && question.id, "a question has no id");
    assert(question.text || question.textKey, `question ${question.id} has no prompt`);
    const opts = question.options;
    if (opts && opts.length) {
      // Picklists fed by cip-data.js start empty and are filled at runtime, so
      // only the lists that are present at load time are checked here.
      const values = opts.map((o) => (typeof o === "string" ? o : o.value));
      assert(values.every((v) => typeof v === "string" && v.trim()), `question ${question.id} has a blank option`);
      assert(new Set(values).size === values.length, `question ${question.id} offers the same option twice`);
    }
    // A condition must be total: it may not throw on a fresh or a finished session.
    if (question.visible) {
      for (const answers of [{}, Object.fromEntries(Q.map((x) => [x.id, "unused"]))]) {
        try {
          question.visible(answers);
        } catch (err) {
          throw new Error(`${question.id}'s condition threw: ${err.message}`);
        }
      }
    }
  }
}

// ── 1. C_student_block ────────────────────────────────────────────────────
check("the student block is open to every student (v13: ${C2_current} = '9')", () => {
  const students = [
    { employment_status: EMP[9], immigration_category: "Canadian citizen" },
    { employment_status: EMP[9], immigration_category: INTL, non_permanent_category: "International Student" },
    { employment_status: EMP[9], immigration_category: INTL, non_permanent_category: "Temporary Foreign Worker" },
    { employment_status: EMP[9] }, // immigration status not answered yet
  ];
  for (const answers of students) {
    assert(shows("student_working", answers), `the student block is hidden from ${JSON.stringify(answers)}`);
  }
  // ...and it stays shut for everyone else.
  for (const status of Object.values(EMP).filter((s) => s !== EMP[9])) {
    assert(!shows("student_working", { employment_status: status, non_permanent_category: "International Student" }),
      `the student block shows for ${status}`);
  }
  assertSurveySane();
});

// ── 2. S8_skillmatch / S9_confidence ──────────────────────────────────────
check("skill match and confidence are asked only of a working student", () => {
  const base = { employment_status: EMP[9] };
  for (const id of ["student_skill_match", "student_confidence"]) {
    assert(!shows(id, base), `${id} shows before the student says whether they work`);
    assert(!shows(id, { ...base, student_working: "No" }), `${id} shows for a student who is not working`);
    assert(shows(id, { ...base, student_working: "Yes" }), `${id} is hidden from a working student`);
  }
  // The rest of the block keeps its own conditions.
  assert(shows("student_barrier_gate", base), "the student barrier gate should not need the working answer");
  assert(shows("planned_intended_job", base), "the intended-job question should not need the working answer");
  assertSurveySane();
});

check("a student who is not working is still asked about barriers", () => {
  const answers = { employment_status: EMP[9], student_working: "No" };
  assert(shows("student_barrier_gate", answers), "the barrier gate is hidden");
  assert(!shows("student_barriers", answers), "barriers show before the gate is answered");
  assert(shows("student_barriers", { ...answers, student_barrier_gate: "Yes" }), "barriers are hidden after Yes");
  assert(shows("student_support", { ...answers, student_barrier_gate: "Yes" }), "support is hidden after Yes");
  assertSurveySane();
});

// ── 3./4. C7_help and C7_other ────────────────────────────────────────────
check("job-search help covers every employed status incl. temporary leave", () => {
  // v13 C7_help: ${C2_current} = '2' or '3' or '4' or '7' or '12' or '13'
  for (const n of [2, 3, 4, 7, 12, 13]) {
    assert(shows("job_search_help", { employment_status: EMP[n] }), `job-search help is hidden for status ${n} (${EMP[n]})`);
  }
  // v13 gives self-employed (1) no job-search question.
  assert(!shows("job_search_help", { employment_status: EMP[1] }), "job-search help shows for the self-employed");
  assertSurveySane();
});

check("the job-search 'Other' box is offered to the same statuses as the question", () => {
  // v13 C7_other: the C7_help statuses AND selected(${C7_help}, '9')
  for (const n of [2, 3, 4, 7, 12, 13]) {
    const answers = { employment_status: EMP[n], job_search_help: ["Other"] };
    assert(shows("job_search_other", answers), `the Other box is hidden for status ${n} (${EMP[n]})`);
  }
  assert(!shows("job_search_other", { employment_status: EMP[1], job_search_help: ["Other"] }),
    "the Other box shows for the self-employed");
  // Choosing Other is what reveals it, not the status alone.
  assert(!shows("job_search_other", { employment_status: EMP[12], job_search_help: ["Job bank"] }),
    "the Other box shows when Other was not chosen");
  assertSurveySane();
});

// ── 5. B7 / B7_other ──────────────────────────────────────────────────────
check("area of study is asked only for a post-secondary credential", () => {
  // v13 B7: ${B5} in 3..8. The v12 condition also let 9 (No formal education) through.
  const asked = ["Apprenticeship", "College certificate", "Diploma", "Advanced Diploma",
    "Undergraduate degree", "Post-graduate degree (e.g., Master's, PhD, MD)"];
  const skipped = ["No formal education", "Primary school", "High school diploma or equivalent"];
  for (const credential of asked) {
    assert(shows("program_name", { recent_credential: credential }), `area of study is hidden for ${credential}`);
  }
  for (const credential of skipped) {
    assert(!shows("program_name", { recent_credential: credential }), `area of study shows for ${credential}`);
    assert(!shows("program_name_other", { recent_credential: credential, program_name: "Not in the list" }),
      `the area-of-study Other box shows for ${credential}`);
  }
  assert(!shows("program_name", {}), "area of study shows before a credential is chosen");
  assertSurveySane();
});

check("an area-of-study pick cannot survive a change of credential", () => {
  // Answer B7, then go back and lower the credential: neither the picklist nor
  // its specify box may reappear.
  const stale = { recent_credential: "No formal education", program_name: "Not in the list" };
  assert(!shows("program_name", stale), "the picklist came back");
  assert(!shows("program_name_other", stale), "the specify box came back");
  assertSurveySane();
});

// ── 6. C_support_unemp_other ──────────────────────────────────────────────
check("the unemployed support question has a v13 'Please specify'", () => {
  const base = { employment_status: EMP[6], unemployed_barrier_gate: "Yes" };
  assert(q("unemployed_support_other"), "unemployed_support_other is missing");
  assert(!shows("unemployed_support_other", base), "the specify box shows before Other is chosen");
  assert(shows("unemployed_support_other", { ...base, unemployed_support: ["Other"] }),
    "the specify box is hidden after choosing Other");
  assert(!shows("unemployed_support_other", { ...base, unemployed_support: ["Job bank"] }),
    "the specify box shows when Other was not chosen");
  // v13 C_support_unemp_other: ${C_barrier_unm} = '1'
  assert(!shows("unemployed_support_other",
    { employment_status: EMP[6], unemployed_barrier_gate: "No", unemployed_support: ["Other"] }),
    "the specify box shows after the gate was changed to No");
  // It belongs to the unemployed branch only.
  assert(!shows("unemployed_support_other", { employment_status: EMP[4], unemployed_barrier_gate: "Yes", unemployed_support: ["Other"] }),
    "the specify box shows for an employed respondent");
  assertSurveySane();
});

// ── 7. C11_other ──────────────────────────────────────────────────────────
check("unemployment reasons 'Other' needs the barrier gate to be Yes", () => {
  const yes = { employment_status: EMP[6], unemployed_barrier_gate: "Yes", unemployment_reasons: ["Other"] };
  assert(shows("unemployment_reasons_other", yes), "the Other box is hidden when the gate is Yes");
  assert(!shows("unemployment_reasons_other", { ...yes, unemployed_barrier_gate: "No" }),
    "the Other box shows after the gate was changed to No");
  assert(!shows("unemployment_reasons_other", { ...yes, unemployment_reasons: ["Language barriers"] }),
    "the Other box shows when Other was not chosen");
  assertSurveySane();
});

// ── 8. C_18_not_a / C19_not_a ─────────────────────────────────────────────
check("the not-looking 'Other' boxes need the barrier gate to be Yes", () => {
  const base = { employment_status: EMP[8], not_looking_barrier_gate: "Yes" };
  assert(shows("not_looking_barriers_other", { ...base, not_looking_barriers: ["Other"] }),
    "the barriers Other box is hidden when the gate is Yes");
  assert(shows("not_looking_support_other", { ...base, not_looking_support: ["Other"] }),
    "the support Other box is hidden when the gate is Yes");
  for (const gate of ["No", "Didn't look for job"]) {
    assert(!shows("not_looking_barriers_other", { ...base, not_looking_barrier_gate: gate, not_looking_barriers: ["Other"] }),
      `the barriers Other box shows when the gate is ${gate}`);
    assert(!shows("not_looking_support_other", { ...base, not_looking_barrier_gate: gate, not_looking_support: ["Other"] }),
      `the support Other box shows when the gate is ${gate}`);
  }
  assertSurveySane();
});

// ── the two option lists ──────────────────────────────────────────────────
check("the not-looking barrier gate offers 'Didn't look for job' (v13 list yndlfj)", () => {
  eq(optionsOf("not_looking_barrier_gate"), ["Yes", "No", "Didn't look for job"], "not_looking_barrier_gate options");
  // Choosing it must skip the barrier and support questions, not fail them.
  const answers = { employment_status: EMP[8], not_looking_barrier_gate: "Didn't look for job" };
  assert(!shows("not_looking_barriers", answers), "barriers show after 'Didn't look for job'");
  assert(!shows("not_looking_support", answers), "support shows after 'Didn't look for job'");
  assertSurveySane();
});

check("the student barrier gate offers 'Not applicable' (v13 list ynna)", () => {
  eq(optionsOf("student_barrier_gate"), ["Yes", "No", "Not applicable"], "student_barrier_gate options");
  const answers = { employment_status: EMP[9], student_barrier_gate: "Not applicable" };
  assert(!shows("student_barriers", answers), "barriers show after 'Not applicable'");
  assert(!shows("student_support", answers), "support shows after 'Not applicable'");
  assertSurveySane();
});

// ── report ────────────────────────────────────────────────────────────────
if (failures) {
  console.error(`\n${failures} of ${checks} checks FAILED.\n`);
  process.exit(1);
}
console.log(`${checks} checks passed: the English survey routes as Newcomer Survey 2026 v.13 does.`);
