#!/usr/bin/env node
/**
 * tests/test_noc7_k100_parity.js — the app's occupation resolver against the
 * v15 workbook's D_noc7 calculate (survey!K100), checked in bulk rather than by
 * example.
 *
 * K100 is the only place the form decides which occupation the Section D skills
 * are looked up for. It is a chain of eight branches; the FIRST branch whose gate
 * holds and whose field is non-empty wins. A resolver that keeps the branches in
 * the wrong order, or that drops a branch's gate, still looks right on a happy
 * path — so this file attacks the three things that are easy to get wrong:
 *
 *   1. gate groups   which of the 13 employment statuses each status-gated branch
 *                    accepts (K100: C2_current = 1,2,3,4,7,12,13 / 6 / 5,8,10,11 / 9)
 *   2. precedence    every pair of branches that can hold at the same time
 *   3. outer gate    K100 itself yields "" unless consent = Yes and E1 = Yes
 *
 * The v15 labels below are copied from the workbook's `choices` sheet (lists emp,
 * yn, ynd, empbefore, status), so the fixtures use the same wording respondents see.
 *
 * Run: node tests/test_noc7_k100_parity.js
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
  if (actual !== expected) {
    throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function ok(cond, what) {
  if (!cond) throw new Error(what);
}

// ── load the shipped data exactly as the page does ────────────────────────
const ctx = { window: {}, console };
ctx.global = ctx;
vm.createContext(ctx);
for (const file of ["noc-data.js", "survey-data.js"]) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), ctx, { filename: file });
}
const SURVEY = ctx.window.SURVEY;
const NOC = ctx.window.NOC_DATA;
const SKILLS_Q = SURVEY.QUESTIONS.find((q) => q.id === "skills");

// ── v15 ground truth: choices sheet, list "emp" (code → label) ────────────
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

// The status codes K100 accepts, per status-gated branch.
const WORKING = [1, 2, 3, 4, 7, 12, 13]; // C2_current = 1,2,3,4,7,12,13 (branches 1 and 5)
const LOOKING = [6]; //                     C2_current = 6              (branch 2)
const NOT_LOOKING = [5, 8, 10, 11]; //      C2_current = 5,8,10,11      (branch 3)
const STUDENT = [9]; //                     C2_current = 9              (branches 4 and 6)
const ALL_STATUSES = Object.keys(EMP).map(Number);

// ── eight occupations whose skill rows are all different ──────────────────
// If two branches resolved to occupations with identical skill rows, a
// precedence check could pass by accident. Pick one occupation per distinct row.
const occupationForRow = (() => {
  const seen = new Set();
  const out = [];
  for (const code of Object.keys(NOC.SKILLS)) {
    const row = NOC.SKILLS[code] || [];
    if (!row.length) continue;
    const sig = row.join("\u0001");
    if (seen.has(sig)) continue;
    const hit = NOC.OCCUPATIONS.find((o) => o.value === code);
    if (!hit) continue;
    seen.add(sig);
    out.push(hit.label);
    if (out.length === 8) break;
  }
  return out;
})();
const codeOf = (label) => label.split(" - ")[0].replace(/\D/g, "");

// ── the single checker ────────────────────────────────────────────────────
// Every case ends here: visible() and skills() must agree on which occupation was
// resolved, and the ten names must be the skill table's row for that code.
function checker(answers, expectedLabel, what) {
  const code = codeOf(expectedLabel);
  const row = NOC.SKILLS[code];
  ok(Array.isArray(row) && row.length, `${what}: no skill row for ${code}`);

  eq(SKILLS_Q.visible(answers), true, `${what}: skills shown`);
  const list = SKILLS_Q.skills(answers);
  eq(list.length, row.length, `${what}: skill count`);
  list.forEach((entry, i) => eq(entry[0], row[i], `${what}: skill ${i + 1}`));

  // must always hold: visible() and a non-empty list never disagree
  eq(list.length > 0, SKILLS_Q.visible(answers), `${what}: visible agrees with the list`);
  return code;
}

function hidden(answers, what) {
  eq(SKILLS_Q.visible(answers), false, `${what}: skills shown`);
  const list = SKILLS_Q.skills(answers);
  eq(Array.isArray(list) ? list.length : 0, 0, `${what}: skill list`);
}

// ── 1. the status groups ──────────────────────────────────────────────────
// One question per status-gated branch, driven with each of the 13 statuses.
const GATED = [
  {
    name: "branch 1 (C8_a_intended)",
    accepts: WORKING,
    field: (L) => ({ intended_job: "No", intended_job_title: L }),
  },
  {
    name: "branch 2 (C12_intended)",
    accepts: LOOKING,
    field: (L) => ({ unemployed_intended_job: L }),
  },
  {
    name: "branch 3 (C16_not)",
    accepts: NOT_LOOKING,
    field: (L) => ({ not_looking_expect_look: "Yes", not_looking_intended_job: L }),
  },
  {
    name: "branch 4 (S8_a_intended)",
    accepts: STUDENT,
    field: (L) => ({ planned_intended_job: L }),
  },
  {
    name: "branch 5 (C4_job_title)",
    accepts: WORKING,
    field: (L) => ({ current_job_title: L }),
  },
  {
    name: "branch 6 (S4_job_title)",
    accepts: STUDENT,
    field: (L) => ({ student_working: "Yes", student_current_job: L }),
  },
];

test("every v15 status is accepted by exactly the branches K100 accepts it in", () => {
  const label = occupationForRow[0];
  for (const status of ALL_STATUSES) {
    for (const g of GATED) {
      const answers = { employment_status: EMP[status], ...g.field(label) };
      const want = g.accepts.includes(status);
      const what = `status ${status} (${EMP[status]}) through ${g.name}`;
      if (want) checker(answers, label, what);
      else hidden(answers, what);
    }
  }
});

test("the four status groups partition all 13 statuses", () => {
  const all = [...WORKING, ...LOOKING, ...NOT_LOOKING, ...STUDENT].sort((a, b) => a - b);
  eq(all.length, 13, "one status per accepted group");
  eq(new Set(all).size, 13, "no status in two groups");
  eq(JSON.stringify(all), JSON.stringify(ALL_STATUSES), "every status covered");
});

// ── 2. precedence between branches that can hold together ─────────────────
// K100 is if/else: for any two branches that can both be satisfied, the earlier
// one wins. Tested for all 28 pairs, using a different occupation per branch.
const BRANCHES = [
  { id: 1, statuses: WORKING, field: (L) => ({ intended_job: "No", intended_job_title: L }) },
  { id: 2, statuses: LOOKING, field: (L) => ({ unemployed_intended_job: L }) },
  { id: 3, statuses: NOT_LOOKING, field: (L) => ({ not_looking_expect_look: "Yes", not_looking_intended_job: L }) },
  { id: 4, statuses: STUDENT, field: (L) => ({ planned_intended_job: L }) },
  { id: 5, statuses: WORKING, field: (L) => ({ current_job_title: L }) },
  { id: 6, statuses: STUDENT, field: (L) => ({ student_working: "Yes", student_current_job: L }) },
  { id: 7, statuses: ALL_STATUSES, field: (L) => ({ employed_before: "Yes, I was employed", previous_job_title: L }) },
  { id: 8, statuses: ALL_STATUSES, field: (L) => ({ immigration_category: "Permanent resident", home_emp_before: "Yes", home_country_job: L }) },
];
eq(BRANCHES.length, 8, "branch count");

test("of every pair of branches that can hold together, the earlier one wins", () => {
  let checked = 0;
  let skipped = 0;
  for (let i = 0; i < BRANCHES.length; i++) {
    for (let j = i + 1; j < BRANCHES.length; j++) {
      const early = BRANCHES[i];
      const late = BRANCHES[j];
      const shared = early.statuses.filter((s) => late.statuses.includes(s));
      if (!shared.length) {
        // the two gates exclude one another: K100 can never see both at once
        skipped++;
        continue;
      }
      const status = shared[0];
      const answers = {
        employment_status: EMP[status],
        ...early.field(occupationForRow[i]),
        ...late.field(occupationForRow[j]),
      };
      // both must still be live, or the pair tests nothing
      ok(SKILLS_Q.visible(answers), `pair ${early.id}/${late.id}: skills shown`);
      checker(answers, occupationForRow[i], `pair ${early.id} before ${late.id}`);
      checked++;
    }
  }
  eq(checked + skipped, 28, "all pairs accounted for");
  ok(checked >= 14, `only ${checked} pairs could be compared`);
});

test("the two ungated branches (7 and 8) are reachable at all", () => {
  checker(
    { employed_before: "Yes, I was employed", previous_job_title: occupationForRow[6] },
    occupationForRow[6],
    "branch 7 alone"
  );
  checker(
    {
      immigration_category: "Permanent resident",
      home_emp_before: "Yes",
      home_country_job: occupationForRow[7],
    },
    occupationForRow[7],
    "branch 8 alone"
  );
});

// ── 3. branch 8's two gates, from the v15 status list ─────────────────────
test("branch 8 needs A3 = 2 or 3 and C1_3_duties = Yes", () => {
  const label = occupationForRow[7];
  const base = { home_emp_before: "Yes", home_country_job: label };
  // choices sheet, list "status": 2 = permanent resident, 3 = non-permanent resident
  for (const [status, accepted] of [
    ["Permanent resident", true],
    ["Non-permanent resident (e.g., work permit, study permit, refugee claimant)", true],
    ["Canadian citizen", false],
    ["None of the above (do not select any other options)", false],
    ["Prefer not to answer", false],
  ]) {
    const answers = { ...base, immigration_category: status };
    if (accepted) checker(answers, label, `A3 = ${status}`);
    else hidden(answers, `A3 = ${status}`);
  }
  for (const duties of ["No", "Don't know", ""]) {
    hidden(
      { immigration_category: "Permanent resident", home_emp_before: duties, home_country_job: label },
      `C1_3_duties = ${JSON.stringify(duties)}`
    );
  }
});

// ── 4. K100's outer gate: consent = Yes and E1 = Yes ──────────────────────
// The resolver runs under app.js's routing, which stops at the declined /
// ineligible screen (app.js:563-564) — so neither state ever reaches Section D.
test("a respondent who did not consent, or is not eligible, never sees the skills", () => {
  const { mount } = require("./helpers/app-dom.js");
  const label = occupationForRow[0];
  const sectionC = { employment_status: EMP[4], current_job_title: label };
  for (const [what, answers] of [
    ["consent refused", { consent: "No, I do not confirm", eligible: "Yes", ...sectionC }],
    ["not eligible", { consent: "Yes, I confirm", eligible: "No", ...sectionC }],
  ]) {
    const app = mount({
      store: { sault_survey_draft_v1: JSON.stringify({ answers, currentId: "skills" }) },
    });
    const root = app.openSurvey();
    const at = app.root() || root;
    const rows = at.querySelectorAll(".rate-row, .skill-row");
    eq(rows.length, 0, `${what}: skill rows reachable`);
  }

  // the consented, eligible state is the one that does show them
  const app = mount({
    store: {
      sault_survey_draft_v1: JSON.stringify({
        answers: { consent: "Yes, I confirm", eligible: "Yes", ...sectionC },
        currentId: "skills",
      }),
    },
  });
  const rendered = app.openSurvey();
  const at = app.root() || rendered;
  ok(at.querySelectorAll(".rate-row, .skill-row").length > 0, "consented respondent sees skill rows");
});

// ── 5. the label → code step, over the whole picklist ─────────────────────
test("every one of the 900 occupations resolves to its own skill row", () => {
  let checked = 0;
  for (const occ of NOC.OCCUPATIONS) {
    const answers = { employment_status: EMP[4], current_job_title: occ.label };
    const row = NOC.SKILLS[occ.value] || [];
    const list = SKILLS_Q.skills(answers);
    eq(SKILLS_Q.visible(answers), row.length > 0, `visible for ${occ.value}`);
    eq(list.length, row.length, `skill count for ${occ.value}`);
    if (row.length) eq(list[0][0], row[0], `first skill for ${occ.value}`);
    checked++;
  }
  eq(checked, 900, "occupations checked");
});

// ── report ────────────────────────────────────────────────────────────────
console.log("");
if (failures.length) {
  console.log(`FAILED — ${failures.length} of ${passed + failures.length} checks failed:\n`);
  for (const [name, e] of failures) console.log(`  x ${name}\n    ${e.message}`);
  process.exit(1);
}
console.log(`${passed} checks passed: the occupation resolver follows v15 K100's gate groups, precedence and outer gate.`);
