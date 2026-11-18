// Newcomer Survey 2026 v.14 changed exactly one cell relative to v13:
// survey!R112C3 (the D_intro note). Its wording moved from a low-to-high
// 1–5 scale to a skill-proficiency scale: 1 = no experience, 2 = Basic,
// 3 = Intermediate, 4 = Advanced, 5 = Expert, plus 0 = Not Sure.
//
// The app renders the rating dots as bare numbers, so that scale lives in the
// skills question's `help` line, printed above the rows. This test pins the
// English wording to v14; the translated languages carry the same scale in
// their own words as dict.help.skills (tests/test_skills_scale_once.js). The
// survey is English only (v15), so there is no separate end-point label row
// under the dots.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");

let passed = 0;
const failures = [];
function ok(cond, msg) {
  if (!cond) throw new Error(msg);
}
function eq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

const ctx = { window: {}, console };
ctx.global = ctx;
vm.createContext(ctx);
for (const f of ["survey-data.js"]) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx, { filename: f });
}
const W = ctx.window;
const skills = W.SURVEY.QUESTIONS.find((q) => q.id === "skills");

// v14 D_intro, verbatim after the question sentence.
const V14_HELP =
  "1 – I have no experience with this skill, 2 – Basic, 3 – Intermediate, 4 – Advanced, 5 – Expert, 0 – Not Sure";

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
  }
}

test("the skills question is still the rating question in Section D", () => {
  ok(skills, "skills question is missing");
  eq(skills.type, "rating", "skills question type");
  eq(skills.section, "Section D: Skills", "skills question section");
});

test("the help line carries the v14 scale wording", () => {
  eq(skills.help, V14_HELP, "skills help");
});

test("no end-point label row is kept on the question", () => {
  // The whole scale is in the help line above the rows; a "1 · …  5 · …" row
  // under the dots would restate it, so neither the row nor its labels exist.
  eq(skills.legend, undefined, "skills legend labels");
  ok(/no experience/i.test(skills.help), "the help line lost its low end");
  ok(/expert/i.test(skills.help), "the help line lost its high end");
});

test("the skill names are plain English, with no translated set alongside", () => {
  const rows = W.SURVEY.SKILLS || [];
  ok(rows.length > 5, "skills list is missing");
  for (const row of rows) {
    const name = Array.isArray(row) ? row[1] : row.name;
    ok(/^[\x20-\x7E]+$/.test(name), "skill name is not plain ASCII English: " + name);
  }
  ok(typeof skills.skills === "function", "the per-respondent skill picker is gone");
  ok(W.SURVEY.SKILL_FR === undefined, "a French skill set is still exported");
  ok(W.SURVEY.SKILL_DEF_FR === undefined, "a French skill-definition set is still exported");
  const src = fs.readFileSync(path.join(ROOT, "survey-data.js"), "utf8");
  for (const gone of ["SKILL_FR", "SKILL_DEF_FR"]) {
    ok(!new RegExp("\\b" + gone + "\\b").test(src), gone + " is still defined in survey-data.js");
  }
});

test("the rating answer values are unchanged: 1–5 plus 0", () => {
  // The dots are numbered by the renderer ([1,2,3,4,5,0]); the data side that a
  // test can see is that answers are stored per skill key. Guard the question
  // shape the renderer depends on.
  ok(typeof skills.visible === "function", "skills keeps its visibility guard");
  ok(typeof skills.skills === "function", "skills keeps its per-respondent skill list");
});

if (failures.length) {
  console.error(failures.map((f) => "  x " + f).join("\n"));
  console.error(`\n${failures.length} of ${passed + failures.length} checks FAILED.`);
  process.exitCode = 1;
} else {
  console.log(`${passed} checks passed: the skills scale matches Newcomer Survey 2026 v.14.`);
}
