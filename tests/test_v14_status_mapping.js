#!/usr/bin/env node
/**
 * Newcomer Survey 2026 v.14 - the Section B questions that depend on the
 * "What is your status in Canada?" answer (A3) and its sub-answers.
 *
 * v14 writes the branch with BOTH parts of the status, for example
 *   B6_b   relevant = ${A3} = '3' and ${A3_a} = '1'
 *   B6     relevant = not(${A3} = '3' and ${A3_a} = '1') and ${B5} != '' and ${B5} != '9'
 * where A3 = '3' is "Non-permanent resident" and A3_a = '1' is
 * "International Student". The conditions in survey-data.js are compared
 * against exactly those expressions, so a sub-answer left over from an earlier
 * status answer cannot move a respondent into the wrong branch.
 *
 * Run: node tests/test_v14_status_mapping.js
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
const byId = Object.fromEntries(Q.map((q) => [q.id, q]));
const q = (id) => {
  const found = byId[id];
  if (!found) throw new Error(`no question "${id}"`);
  return found;
};
const shows = (id, answers) => (q(id).visible ? !!q(id).visible(answers) : true);

// ── v14 vocabulary, read from the workbook's numbers ──────────────────────
// A3: 1 Canadian citizen, 2 Permanent resident, 3 Non-permanent resident,
//     4 None of the above, 5 Prefer not to answer.
const A3 = {
  1: "Canadian citizen",
  2: "Permanent resident",
  3: "Non-permanent resident (e.g., work permit, study permit, refugee claimant)",
  4: "None of the above (do not select any other options)",
  5: "Prefer not to answer",
};
// A3_a (non-permanent residents): 1 International Student, 2 Temporary Foreign
// Worker, 3 Refugee claimant, 4 Other.
const A3A = {
  1: "International Student",
  2: "Temporary Foreign Worker",
  3: "Refugee claimant",
  4: "Other",
};
// B5: 9 = No formal education, 3..8 = post-secondary.
const NO_FORMAL = "No formal education";
const DIPLOMA = "Diploma";
// The picklist's "cannot find my area of study" option.
const CIP_NOT_FOUND = "I cannot find my area of study";

// v14 expression: not(${A3} = '3' and ${A3_a} = '1').
const v14IsIntlStudent = (a) => a.A3 === 3 && a.A3_a === 1;
// v14 expression: ${B5} != '' and ${B5} != '9'.
const v14HasCredential = (a) => !!a.B5 && a.B5 !== NO_FORMAL;

// The eight questions this file guards, with the v14 expression each mirrors.
const B6_A = ["highest_education", "highest_credential", "highest_program_name",
  "highest_program_name_other", "highest_completed_location"];
const B6_B = ["current_program", "current_program_name", "current_program_name_other"];

// Translate the workbook-style answer set into the app's stored answers.
function toApp(a) {
  const out = {};
  if (a.A3 !== undefined) out.immigration_category = A3[a.A3];
  if (a.A3_a !== undefined) out.non_permanent_category = A3A[a.A3_a];
  if (a.B5 !== undefined) out.recent_credential = a.B5;
  if (a.B6 !== undefined) out.highest_education = a.B6;
  if (a.B6_a !== undefined) out.highest_credential = a.B6_a;
  if (a.B6_a_i !== undefined) out.highest_program_name = a.B6_a_i;
  if (a.B6_b !== undefined) out.current_program = a.B6_b;
  if (a.B6_b_i !== undefined) out.current_program_name = a.B6_b_i;
  return out;
}

// Expected v14 relevance for each of the eight questions.
function v14Expected(a) {
  const intl = v14IsIntlStudent(a);
  const cred = v14HasCredential(a);
  const b6No = a.B6 === "No";
  const b6a = !!a.B6_a;
  const b6b = !!a.B6_b;
  return {
    highest_education: !intl && cred,
    highest_credential: !intl && cred && b6No,
    highest_program_name: !intl && cred && b6No && b6a,
    highest_program_name_other: !intl && cred && b6No && b6a && a.B6_a_i === CIP_NOT_FOUND,
    highest_completed_location: !intl && cred && b6No,
    current_program: intl,
    current_program_name: intl && b6b,
    current_program_name_other: intl && b6b && a.B6_b_i === CIP_NOT_FOUND,
  };
}

function compare(a, label) {
  const app = toApp(a);
  const want = v14Expected(a);
  const got = {};
  for (const id of B6_A.concat(B6_B)) got[id] = shows(id, app);
  eq(got, want, `v14 relevance mismatch for ${label} (answers ${JSON.stringify(a)})`);
}

const statuses = [1, 2, 3, 4, 5];
const subanswers = [undefined, 1, 2, 3, 4];
const credentials = [undefined, NO_FORMAL, DIPLOMA];
const b6s = [undefined, "Yes", "No"];
const b6as = [undefined, "College certificate"];
const cips = [undefined, CIP_NOT_FOUND, "01.0101"];
const b6bs = [undefined, "Undergraduate degree"];

// ── 1. every combination agrees with the v14 expressions ──────────────────
check("every status / sub-answer / credential combination follows v14", () => {
  let cases = 0;
  for (const A3n of statuses) {
    for (const a3a of subanswers) {
      for (const cert of credentials) {
        for (const b6 of b6s) {
          for (const b6a of b6as) {
            for (const b6b of b6bs) {
              for (const cip of cips) {
                const a = { A3: A3n, B5: cert, B6: b6, B6_a: b6a, B6_b: b6b,
                  B6_a_i: cip, B6_b_i: cip };
                if (a3a !== undefined) a.A3_a = a3a;
                compare(a, `A3=${A3n} A3_a=${a3a} B5=${cert} B6=${b6}`);
                cases++;
              }
            }
          }
        }
      }
    }
  }
  assert(cases >= 2000, `only ${cases} combinations were checked`);
});

// ── 2. the reported bug: stale "International Student" sub-answer ─────────
check("a citizen or permanent resident never reaches the student questions", () => {
  for (const A3n of [1, 2, 4, 5]) {
    const a = { A3: A3n, A3_a: 1, B5: DIPLOMA };   // A3_a left behind
    const app = toApp(a);
    for (const id of B6_B) {
      assert(!shows(id, app), `${id} shown for A3=${A3n} with a stale International Student sub-answer`);
    }
    assert(shows("highest_education", app),
      `highest_education hidden for A3=${A3n} with a stale International Student sub-answer`);
  }
});

check("switching to Canadian citizen brings back the highest-level questions", () => {
  // The exact sequence seen in the live app: answered as a non-permanent
  // resident student, then changed A3 to "Canadian citizen".
  const wasStudent = toApp({ A3: 3, A3_a: 1, B5: DIPLOMA });
  const nowCitizen = Object.assign({}, wasStudent, { immigration_category: A3[1] });
  eq(shows("current_program", nowCitizen), false, "current_program still shown after switching to citizen");
  eq(shows("current_program_name", Object.assign({}, nowCitizen, { current_program: "Diploma" })), false,
    "current_program_name still shown after switching to citizen");
  eq(shows("highest_education", nowCitizen), true, "highest_education not shown after switching to citizen");
  eq(shows("highest_credential", Object.assign({}, nowCitizen, { highest_education: "No" })), true,
    "highest_credential not shown after switching to citizen");
  eq(shows("highest_completed_location",
    Object.assign({}, nowCitizen, { highest_education: "No", highest_credential: "Diploma" })), true,
  "highest_completed_location not shown after switching to citizen");
});

// ── 3. the reverse direction, and the legitimate student ──────────────────
check("an international student keeps the current-program questions only", () => {
  const a = toApp({ A3: 3, A3_a: 1, B5: DIPLOMA, B6: "No", B6_a: "Diploma" });
  assert(shows("current_program", a), "current_program hidden for an international student");
  for (const id of B6_A) assert(!shows(id, a), `${id} shown for an international student`);
});

check("switching to non-permanent student hides the highest-level questions", () => {
  const wasCitizen = toApp({ A3: 1, B5: DIPLOMA, B6: "No", B6_a: "Diploma" });
  const nowStudent = Object.assign({}, wasCitizen, {
    immigration_category: A3[3], non_permanent_category: A3A[1],
  });
  for (const id of B6_A) assert(!shows(id, nowStudent), `${id} still shown after switching to student`);
  assert(shows("current_program", nowStudent), "current_program not shown after switching to student");
});

check("other non-permanent residents are not international students", () => {
  for (const a3a of [2, 3, 4]) {
    const a = toApp({ A3: 3, A3_a: a3a, B5: DIPLOMA });
    assert(!shows("current_program", a), `current_program shown for A3_a=${a3a}`);
    assert(shows("highest_education", a), `highest_education hidden for A3_a=${a3a}`);
  }
});

// ── 4. no completed credential means no highest-level questions ───────────
check("no formal education or no credential skips the highest-level questions", () => {
  for (const cert of [undefined, NO_FORMAL]) {
    for (const A3n of [1, 2, 4, 5]) {
      const a = toApp({ A3: A3n, B5: cert });
      assert(!shows("highest_education", a), `highest_education shown for B5=${cert}`);
    }
  }
});

// ── 5. the "please specify" boxes follow their parent pick ────────────────
check("the specify boxes follow their parent picklist", () => {
  const citizen = toApp({ A3: 1, B5: DIPLOMA, B6: "No", B6_a: "Diploma" });
  assert(!shows("highest_program_name_other", citizen),
    "highest_program_name_other shown before a picklist answer");
  assert(shows("highest_program_name_other",
    Object.assign({}, citizen, { highest_program_name: CIP_NOT_FOUND })),
  "highest_program_name_other hidden for the not-found pick");
  const student = toApp({ A3: 3, A3_a: 1, B5: DIPLOMA, B6_b: "Diploma" });
  assert(!shows("current_program_name_other", student),
    "current_program_name_other shown before a picklist answer");
  assert(shows("current_program_name_other",
    Object.assign({}, student, { current_program_name: CIP_NOT_FOUND })),
  "current_program_name_other hidden for the not-found pick");
  // A stale not-found pick must not surface the specify box in the other branch.
  const citizen2 = Object.assign({}, citizen, { current_program_name: CIP_NOT_FOUND });
  assert(!shows("current_program_name_other", citizen2),
    "current_program_name_other shown to a citizen");
});

// ── 6. nothing else in Section B moved ────────────────────────────────────
check("the B7 area-of-study picklist still ignores the status answer", () => {
  const a = toApp({ A3: 3, A3_a: 1, B5: DIPLOMA });
  assert(shows("program_name", a), "program_name hidden for an international student");
  const noCert = toApp({ A3: 1, B5: NO_FORMAL });
  assert(!shows("program_name", noCert), "program_name shown for no formal education");
});

console.log(failures === 0
  ? `${checks} checks passed: the Section B education branch follows the v14 status mapping.`
  : `\n${failures} of ${checks} checks FAILED.`);
process.exit(failures === 0 ? 0 : 1);
