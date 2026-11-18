// The skills rating page used to print an end-point legend under the dots: the
// low label pinned left, the high label pinned right. That row is gone, because
// the help line above the rows already spells out the whole v14 scale verbatim
// ("1 – I have no experience with this skill … 0 – Not Sure").
//
// The survey is English only (v15), so the row is gone from the one language it
// shipped in: no label row, no labels in the data, no CSS for it.
//
// This test drives the real app.js render path (not just the data) and holds:
//   1. the help line is still there, verbatim, above the first row, and no
//      legend row is rendered — on either rating page, and no element prints
//      the two end-point labels;
//   2. the labels are gone from survey-data.js and nothing styles the row;
//   3. the rating control still rates: dots store answers and the page advances.
//
// Run: node tests/test_skills_legend_removed.js
const fs = require("fs");
const path = require("path");
const { mount } = require("./helpers/app-dom.js");

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

const plain = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

// Every piece of text inside a node, so a label cannot hide in a wrapper.
function textOf(node) {
  if (!node) return "";
  if (node.tagName === "#TEXT") return node.textContent;
  const kids = (node.children || []).map(textOf).filter(Boolean);
  if (kids.length) return kids.join(" ").replace(/\s+/g, " ").trim();
  return plain(node.innerHTML);
}

// Pre-order walk, so two nodes can be compared by document position.
function preorder(root) {
  const out = [];
  (function walk(n) {
    out.push(n);
    for (const c of n.children || []) walk(c);
  })(root);
  return out;
}

const V14_HELP =
  "1 – I have no experience with this skill, 2 – Basic, 3 – Intermediate, 4 – Advanced, 5 – Expert, 0 – Not Sure";

// The removed labels, as the row printed them.
const LEGEND_LEFT = /1\s*·\s*No experience/;
const LEGEND_RIGHT = /5\s*·\s*Expert/;

function openSkills() {
  const store = {
    sault_survey_draft_v1: JSON.stringify({
      answers: {
        // the real flow state that makes an intended-job title visible at all:
        // employed full time and the current job is not the intended one.
        employment_status: "Employed full time permanent (30+ hours/week)",
        intended_job: "No",
        intended_job_title: "9421101 - Test Job",
      },
      currentId: "skills",
    }),
  };
  const app = mount({ store });
  const root = app.openSurvey();
  const at = () => app.root() || root;
  return { app, at, store };
}

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
  }
}

// The one checker every test ends with: the help line sits above the rows, the
// control ends with its grid, and nothing prints the two labels.
function assertPageIntact(at) {
  eq(at().querySelectorAll(".rate-row").length, 5, "rating rows on screen");
  eq(at().querySelectorAll(".rate-dot").length, 30, "rating dots (6 per row)");

  const nodes = preorder(at());
  const helpAt = nodes.findIndex((n) => n.classes && n.classes.has("q-help"));
  const firstRowAt = nodes.findIndex((n) => n.classes && n.classes.has("rate-row"));
  ok(helpAt >= 0, "the help line is missing");
  ok(helpAt < firstRowAt, "the help line moved below the skill rows");

  // Nothing follows the grid: the control's only element is the grid of rows.
  const grid = at().querySelector(".grid-rate");
  ok(grid && grid.parentNode, "the skills grid is missing");
  const siblings = grid.parentNode.children.filter((c) => c.tagName !== "#TEXT");
  eq(siblings.length, 1, "elements inside the rating control");
  ok(siblings[siblings.length - 1] === grid, "an element is printed after the last skill row");

  // No element on the page prints either end-point label.
  const body = textOf(at());
  ok(!LEGEND_LEFT.test(body), `"1 · No experience" is still printed: ${body.slice(0, 160)}`);
  ok(!LEGEND_RIGHT.test(body), `"5 · Expert" is still printed: ${body.slice(0, 160)}`);
}

// ── 1. help line above, no label row ──────────────────────────────────────
test("the v14 help line is verbatim above the rows", () => {
  const { at } = openSkills();
  const help = at().querySelector(".q-help");
  ok(help, "the help line is missing");
  eq(plain(textOf(help)), V14_HELP, "help line text");
  assertPageIntact(at);
});

test("no end-point row is rendered under the first page of skills", () => {
  const { at } = openSkills();
  eq(at().querySelectorAll(".rate-legend").length, 0, "label rows under the dots");
  assertPageIntact(at);
});

test("the second page has no label row either (re-rendered, not hidden)", () => {
  const { at } = openSkills();
  const rows = at().querySelectorAll(".rate-row");
  eq(rows.length, 5, "first page rows");
  const before = textOf(rows[0]);
  for (const row of rows) row.querySelectorAll(".rate-dot")[2].onclick(); // "3"
  const after = at().querySelectorAll(".rate-row");
  ok(textOf(after[0]) !== before, "the page did not advance to the second five skills");
  eq(at().querySelectorAll(".rate-legend").length, 0, "label rows on the second page");
  assertPageIntact(at);
});

// ── 2. the labels and their CSS are gone with the row ─────────────────────
test("the legend labels are gone from the question", () => {
  const { app } = openSkills();
  const q = app.window.SURVEY.QUESTIONS.find((x) => x.id === "skills");
  eq(q.legend, undefined, "skills legend labels");
  eq(q.type, "rating", "skills question type");
  ok(typeof q.help === "string" && q.help.length > 0, "the help line is gone");
  ok(typeof q.visible === "function", "the visibility guard is gone");
  ok(typeof q.skills === "function", "the per-respondent skill list is gone");
  const src = fs.readFileSync(path.join(ROOT, "survey-data.js"), "utf8");
  ok(!/No experience"\s*,?\s*"5/.test(src), "the label pair is still in survey-data.js");
});

test("nothing styles the removed row", () => {
  const css = fs.readFileSync(path.join(ROOT, "app.css"), "utf8");
  const rules = css.split("\n").filter((l) => /\.rate-legend\s*\{/.test(l));
  eq(rules.length, 0, ".rate-legend CSS rules in app.css");
  // The stylesheet is still a well-formed file.
  let depth = 0;
  for (const ch of css) {
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    ok(depth >= 0, "app.css closes a block it never opened");
  }
  eq(depth, 0, "app.css has unbalanced braces");
});

// ── 3. the control still rates ────────────────────────────────────────────
test("rating a skill still stores the answer and marks the dot", () => {
  const { at, store } = openSkills();
  const row = at().querySelectorAll(".rate-row")[0];
  const dot = row.querySelectorAll(".rate-dot")[3]; // "4"
  dot.onclick();
  ok(dot.classes.has("on"), "the clicked dot is not marked");
  const draft = JSON.parse(store.sault_survey_draft_v1 || "{}");
  const skills = (draft.answers || {}).skills || {};
  const keys = Object.keys(skills);
  eq(keys.length, 1, "one skill answered");
  eq(skills[keys[0]], 4, "stored rating");
  assertPageIntact(at);
});

test("dropping the row did not change what is stored", () => {
  // The row was presentation only: the same dot stores the same value, and the
  // page advances the same way, so the removal cannot touch the saved answers.
  const a = openSkills();
  const b = openSkills();
  for (const c of [a, b]) {
    const row = c.at().querySelectorAll(".rate-row")[0];
    row.querySelectorAll(".rate-dot")[4].onclick(); // "5"
  }
  const read = (c) => {
    const d = JSON.parse(c.store.sault_survey_draft_v1 || "{}");
    const s = (d.answers || {}).skills || {};
    return Object.keys(s).map((k) => [k, s[k]]);
  };
  eq(read(a), read(b), "the same dot stored different answers on two runs");
  ok(!("language" in JSON.parse(a.store.sault_survey_draft_v1).answers), "the draft still records a language");
});

if (failures.length) {
  console.error(failures.map((f) => "  x " + f).join("\n"));
  console.error(`\n${failures.length} of ${passed + failures.length} checks FAILED.`);
  process.exitCode = 1;
} else {
  console.log(`${passed} checks passed: the skills page keeps the v14 help line and no end-point label row.`);
}
