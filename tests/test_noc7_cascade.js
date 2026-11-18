#!/usr/bin/env node
/**
 * tests/test_noc7_cascade.js — the skills lookup picks the occupation the same way
 * the v15 workbook's D_noc7 calculate does (survey!K100).
 *
 * K100 resolves ONE oasis7 code per respondent through a chain of eight branches,
 * in this order, where the first branch whose gate holds AND whose field is
 * non-empty wins:
 *
 *   1 C8_a_intended    status C_emp_block, current job is not the intended one
 *   2 C12_intended     status 6 (unemployed, actively looking)
 *   3 C16_not          status 5/8/10/11 and C15_not = Yes
 *   4 S8_a_intended    status 9 (student), not currently working
 *   5 C4_job_title     status C_emp_block
 *   6 S4_job_title     status 9 and C_stu_working = Yes
 *   7 C1_1_job_title   C1_prev_emp = Yes
 *   8 C1_homeemp       A3 = 2/3 and C1_3_duties = Yes
 *
 * The app used to chain only branches 1-6 and ignore every gate, so 7 and 8 could
 * never be reached and a stale answer for a question the respondent can no longer
 * see could outrank a live one. Both are checked here.
 *
 * Run: node tests/test_noc7_cascade.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("  ok  " + name);
  } catch (e) {
    failures.push([name, e]);
    console.log("  x   " + name + " — " + e.message);
  }
}

function eq(actual, expected, what) {
  if (actual !== expected) throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function ok(cond, what) {
  if (!cond) throw new Error(what);
}

// ── load the survey + NOC data exactly as the page does ───────────────────
const ctx = { window: {}, console };
ctx.global = ctx;
vm.createContext(ctx);
for (const file of ["noc-data.js", "survey-data.js"]) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), ctx, { filename: file });
}
const SURVEY = ctx.window.SURVEY;
const NOC = ctx.window.NOC_DATA;
const SKILLS_Q = SURVEY.QUESTIONS.find((q) => q.id === "skills");

// ── the app's own status groups, so the fixtures use real labels ──────────
const EMP = {
  SELF: "Self-employed",
  FULL: "Employed full time permanent (30+ hours/week)",
  UNEMP_LOOK: "Unemployed and actively looking for work",
  UNEMP_NOT: "Unemployed and not looking for work",
  STUDENT: "Student or recent graduate",
};

// three real occupations, picked by code from the shipped picklist
function labelFor(code) {
  const hit = NOC.OCCUPATIONS.find((o) => o.value === code);
  if (!hit) throw new Error("no occupation with code " + code);
  return hit.label;
}
// independent of the app: a label's code is its digits before " - "
const codeOf = (label) => label.split(" - ")[0].replace(/\D/g, "");

const INTENDED = labelFor("2123100"); // intended job
const CURRENT = labelFor("1002201"); // current job
const PREVIOUS = labelFor("0001000"); // job before/elsewhere
const HOME = labelFor("4122100"); // job in the home country

// ── the single checker: the skills shown are the table's row for the code ──
// Asserted at the end of every case below: visible() and skills() must agree with
// the NOC7 skill table for the code the winning branch pointed at.
function checker(answers, expectedLabel, what) {
  const expectedCode = codeOf(expectedLabel);
  const row = NOC.SKILLS[expectedCode];
  ok(Array.isArray(row) && row.length, `${what}: ${expectedCode} has no row in the skill table`);

  const visible = SKILLS_Q.visible(answers);
  eq(visible, true, `${what}: skills section shown`);

  const list = SKILLS_Q.skills(answers);
  eq(list.length, row.length, `${what}: skill count`);
  list.forEach((entry, i) => eq(entry[0], row[i], `${what}: skill ${i + 1}`));
  return expectedCode;
}

// A case where the skills section must stay hidden.
function hidden(answers, what) {
  eq(SKILLS_Q.visible(answers), false, `${what}: skills section shown`);
  const list = SKILLS_Q.skills(answers);
  eq(Array.isArray(list) ? list.length : 0, 0, `${what}: skill list`);
}

// ── the eight branches, each in the state the form actually produces ──────
test("branch 1 — working, current job is not the intended one", () => {
  const a = {
    employment_status: EMP.FULL,
    intended_job: "No",
    intended_job_title: INTENDED,
    current_job_title: CURRENT,
  };
  eq(checker(a, INTENDED, "branch 1"), "2123100", "resolved code");
});

test("branch 2 — unemployed and actively looking", () => {
  const a = { employment_status: EMP.UNEMP_LOOK, unemployed_intended_job: CURRENT };
  eq(checker(a, CURRENT, "branch 2"), "1002201", "resolved code");
});

test("branch 3 — not looking, expects to look within 12 months", () => {
  const a = {
    employment_status: EMP.UNEMP_NOT,
    not_looking_expect_look: "Yes",
    not_looking_intended_job: PREVIOUS,
  };
  eq(checker(a, PREVIOUS, "branch 3"), "0001000", "resolved code");
});

test("branch 4 — student, planned occupation", () => {
  const a = {
    employment_status: EMP.STUDENT,
    planned_intended_job: INTENDED,
    student_working: "Yes",
    student_current_job: CURRENT,
  };
  eq(checker(a, INTENDED, "branch 4 over 6"), "2123100", "resolved code");
});

test("branch 5 — working, intended job matches the current one", () => {
  const a = { employment_status: EMP.SELF, intended_job: "Yes", current_job_title: CURRENT };
  eq(checker(a, CURRENT, "branch 5"), "1002201", "resolved code");
});

test("branch 6 — student who is currently working", () => {
  const a = {
    employment_status: EMP.STUDENT,
    student_working: "Yes",
    student_current_job: HOME,
  };
  eq(checker(a, HOME, "branch 6"), "4122100", "resolved code");
});

test("branch 7 — employed before moving, now not working (was unreachable)", () => {
  const a = {
    employment_status: EMP.UNEMP_NOT,
    employed_before: "Yes, I was employed",
    previous_job_title: PREVIOUS,
  };
  eq(checker(a, PREVIOUS, "branch 7"), "0001000", "resolved code");
});

test("branch 8 — immigrant employed in the home country (was unreachable)", () => {
  const a = {
    employment_status: EMP.UNEMP_NOT,
    immigration_category: "Permanent resident",
    home_emp_before: "Yes",
    home_country_job: HOME,
  };
  eq(checker(a, HOME, "branch 8"), "4122100", "resolved code");
});

test("all eight branches are reachable — the set of resolved codes covers every branch", () => {
  const cases = [
    [{ employment_status: EMP.FULL, intended_job: "No", intended_job_title: INTENDED }, "2123100"],
    [{ employment_status: EMP.UNEMP_LOOK, unemployed_intended_job: CURRENT }, "1002201"],
    [{ employment_status: EMP.UNEMP_NOT, not_looking_expect_look: "Yes", not_looking_intended_job: PREVIOUS }, "0001000"],
    [{ employment_status: EMP.STUDENT, planned_intended_job: INTENDED }, "2123100"],
    [{ employment_status: EMP.SELF, current_job_title: CURRENT }, "1002201"],
    [{ employment_status: EMP.STUDENT, student_working: "Yes", student_current_job: HOME }, "4122100"],
    [{ employed_before: "Yes, I was employed", previous_job_title: PREVIOUS }, "0001000"],
    [{ immigration_category: "Permanent resident", home_emp_before: "Yes", home_country_job: HOME }, "4122100"],
  ];
  const codes = cases.map(([a, expected]) => {
    eq(SKILLS_Q.visible(a), true, "branch reachable");
    return codeOf(expected);
  });
  eq(codes.length, 8, "branch count");
  for (const c of codes) ok(NOC.SKILLS[c], "code " + c + " has skills");
});

// ── order: the first branch whose gate holds wins, as K100's if/else does ──
test("order — a stale intended-job title loses to the live current job", () => {
  const a = {
    employment_status: EMP.FULL,
    intended_job: "Yes", // so C8_a_intended is not asked any more
    intended_job_title: INTENDED, // left behind by an earlier answer
    current_job_title: CURRENT,
  };
  eq(checker(a, CURRENT, "stale intended title"), "1002201", "resolved code");
});

test("order — current job (5) beats the previous job (7)", () => {
  const a = {
    employment_status: EMP.FULL,
    current_job_title: CURRENT,
    employed_before: "Yes, I was employed",
    previous_job_title: PREVIOUS,
  };
  eq(checker(a, CURRENT, "5 before 7"), "1002201", "resolved code");
});

test("order — previous job (7) beats the home-country job (8)", () => {
  const a = {
    employment_status: EMP.UNEMP_NOT,
    employed_before: "Yes, I was employed",
    previous_job_title: PREVIOUS,
    immigration_category: "Permanent resident",
    home_emp_before: "Yes",
    home_country_job: HOME,
  };
  eq(checker(a, PREVIOUS, "7 before 8"), "0001000", "resolved code");
});

// ── gates: a hidden question's stale answer must not resolve a code ───────
test("gate — previous job without 'employed before' does not count", () => {
  hidden(
    { employment_status: EMP.UNEMP_NOT, employed_before: "No, I wasn't employed", previous_job_title: PREVIOUS },
    "previous job, employed_before=No"
  );
});

test("gate — home-country job without 'employed there' does not count", () => {
  hidden(
    {
      employment_status: EMP.UNEMP_NOT,
      immigration_category: "Permanent resident",
      home_emp_before: "No",
      home_country_job: HOME,
    },
    "home job, home_emp_before=No"
  );
});

test("gate — home-country job for a Canadian citizen does not count", () => {
  hidden(
    {
      employment_status: EMP.UNEMP_NOT,
      immigration_category: "Canadian citizen",
      home_emp_before: "Yes",
      home_country_job: HOME,
    },
    "home job, Canadian citizen"
  );
});

test("gate — not-looking intention needs 'expects to look within 12 months'", () => {
  hidden(
    {
      employment_status: EMP.UNEMP_NOT,
      not_looking_expect_look: "No",
      not_looking_intended_job: PREVIOUS,
    },
    "not looking, expects=No"
  );
  hidden(
    {
      employment_status: EMP.UNEMP_NOT,
      not_looking_expect_look: "Don't know",
      not_looking_intended_job: PREVIOUS,
    },
    "not looking, expects=Don't know"
  );
});

test("gate — an unemployed-looking occupation is ignored for a working respondent", () => {
  const a = {
    employment_status: EMP.FULL,
    unemployed_intended_job: CURRENT, // stale, from an earlier answer
    current_job_title: HOME,
  };
  eq(checker(a, HOME, "unemployed answer on a working respondent"), "4122100", "resolved code");
});

test("gate — a student's planned job is ignored once they are employed", () => {
  const a = {
    employment_status: EMP.FULL,
    planned_intended_job: INTENDED, // stale
    current_job_title: CURRENT,
  };
  eq(checker(a, CURRENT, "student answer on a working respondent"), "1002201", "resolved code");
});

// ── nothing to resolve ────────────────────────────────────────────────────
test("no answers resolve no occupation", () => {
  hidden({}, "empty");
  hidden({ employment_status: EMP.UNEMP_NOT }, "status only");
});

test("an empty or blank pick is not an occupation", () => {
  hidden({ employment_status: EMP.FULL, intended_job: "No", intended_job_title: "" }, "empty title");
  hidden({ employment_status: EMP.FULL, intended_job: "No", intended_job_title: "   " }, "blank title");
  hidden({ employed_before: "Yes, I was employed", previous_job_title: "" }, "empty previous");
});

test("the resolved code always has a skill row, or nothing is shown", () => {
  // exhaustive over every occupation in the picklist, through each branch gate
  const variants = [
    (l) => ({ employment_status: EMP.FULL, intended_job: "No", intended_job_title: l }),
    (l) => ({ employment_status: EMP.UNEMP_LOOK, unemployed_intended_job: l }),
    (l) => ({ employment_status: EMP.STUDENT, planned_intended_job: l }),
    (l) => ({ employment_status: EMP.SELF, current_job_title: l }),
    (l) => ({ employed_before: "Yes, I was employed", previous_job_title: l }),
    (l) => ({ immigration_category: "Permanent resident", home_emp_before: "Yes", home_country_job: l }),
  ];
  let shown = 0;
  for (const occ of NOC.OCCUPATIONS) {
    for (const build of variants) {
      const a = build(occ.label);
      const vis = SKILLS_Q.visible(a);
      const list = SKILLS_Q.skills(a);
      const row = NOC.SKILLS[occ.value] || [];
      eq(vis, row.length > 0, "visible agrees with the skill table for " + occ.value);
      eq(list.length, vis ? row.length : 0, "skill count for " + occ.value);
      if (vis) shown++;
    }
  }
  ok(shown > 0, "the exhaustive pass resolved at least one occupation");
});

// ── the same fix through the rendered page ────────────────────────────────
test("the skills page renders for a previous-job-only respondent", () => {
  const { mount } = require("./helpers/app-dom.js");
  const store = {
    sault_survey_draft_v1: JSON.stringify({
      answers: {
        employment_status: EMP.UNEMP_NOT,
        employed_before: "Yes, I was employed",
        previous_job_title: PREVIOUS,
      },
      currentId: "skills",
    }),
  };
  const app = mount({ store });
  const root = app.openSurvey();
  const at = app.root() || root;

  const rows = at.querySelectorAll(".rate-row, .skill-row");
  const expected = NOC.SKILLS[codeOf(PREVIOUS)];
  ok(expected && expected.length, "the previous job has a skill row");
  // the rating rows are paginated five at a time
  eq(rows.length, Math.min(5, expected.length), "rendered skill rows");
  // the fake DOM keeps text in #TEXT nodes, so collect them by walking
  const textOf = (node) => {
    const out = [];
    (function walk(n) {
      if (n && n.tagName === "#TEXT" && n._text) out.push(n._text);
      for (const c of (n && n.children) || []) walk(c);
    })(node);
    return out.join(" ").replace(/\s+/g, " ");
  };
  const firstRow = textOf(rows[0]);
  ok(firstRow.indexOf(expected[0]) !== -1, `first row shows ${expected[0]}, saw ${JSON.stringify(firstRow.slice(0, 60))}`);
});

// ── report ───────────────────────────────────────────────────────────────
console.log("");
if (failures.length) {
  console.log(`FAILED — ${failures.length} of ${passed + failures.length} checks failed:\n`);
  for (const [name, e] of failures) console.log(`  x ${name}\n    ${e.message}`);
  process.exit(1);
}
console.log(`${passed} checks passed: the skills lookup follows v15 K100's eight branches, in order, behind their gates.`);
