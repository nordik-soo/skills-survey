// The skills rating page used to print a progress counter above the rows —
// "1–5/10", "6–10/10", … — showing which five of the ten skills were on screen.
// The client asked for that indicator to be removed. This test drives the real
// app.js to the skills question and holds both halves of that change: the
// counter is gone on every page, and the rating control itself still works
// (five rows, six dots — 1–5 and 0 — plus the end-point legend).
const { mount } = require("./helpers/app-dom.js");

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

// Every piece of text inside a node, so a counter cannot hide in a wrapper.
function textOf(node) {
  if (!node) return "";
  if (node.tagName === "#TEXT") return node.textContent;
  const kids = (node.children || []).map(textOf).filter(Boolean);
  if (kids.length) return kids.join(" ").replace(/\s+/g, " ").trim();
  return plain(node.innerHTML);
}

// A counter looks like "1–5/10": page start, page end, total.
const COUNTER = /\b\d+\s*[–-]\s*\d+\s*\/\s*\d+\b/;

// Land directly on the skills question: it needs a NOC occupation for its skill
// list, so the draft carries one (9421101 is a real code in noc-data.js).
function openSkills() {
  const store = {
    sault_survey_draft_v1: JSON.stringify({
      answers: {
        // the flow state that shows an intended-job picklist: employed full time,
        // current job is not the intended one.
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
  return { app, at };
}

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
  }
}

// The invariant every skills check ends with: the rating control is intact.
// The end-point labels under the dots are no longer rendered: the control must end
// with its grid of rows, with nothing appended after the last dot. (See
// tests/test_skills_legend_removed.js.)
function assertRatingIntact(at, rows) {
  eq(at().querySelectorAll(".rate-row").length, rows, "rating rows on screen");
  eq(at().querySelectorAll(".rate-dot").length, rows * 6, "rating dots (6 per row)");
  eq(at().querySelectorAll(".rate-legend").length, 0, "label rows under the dots");
  const grid = at().querySelector(".grid-rate");
  ok(grid && grid.parentNode, "the skills grid is missing");
  const siblings = grid.parentNode.children.filter((c) => c.tagName !== "#TEXT");
  eq(siblings.length, 1, "elements inside the rating control");
  ok(siblings[siblings.length - 1] === grid, "an element is printed after the last skill row");
}

// ── the removal ───────────────────────────────────────────────────────────
test("the skills page renders the rating question", () => {
  const { at } = openSkills();
  const h2 = at().querySelector("h2");
  ok(/How would you rate your level/i.test(plain(h2 && h2.innerHTML)),
    `expected the skills question, saw "${plain(h2 && h2.innerHTML)}"`);
});

test("no progress counter is rendered above the skills rows", () => {
  const { at } = openSkills();
  eq(at().querySelectorAll(".rate-count").length, 0, ".rate-count nodes");
  eq(at().querySelectorAll(".rate-one-top").length, 0, ".rate-one-top wrapper");
});

test("no element on the skills page prints an x–y/N counter", () => {
  const { at } = openSkills();
  const offending = [];
  const walk = (n) => {
    if (!n) return;
    if (n.tagName !== "#TEXT") {
      const t = textOf(n);
      if (COUNTER.test(t)) offending.push(`${n.className || n.tagName}: ${t}`);
    }
    for (const c of n.children || []) walk(c);
  };
  walk(at());
  eq(offending, [], "elements showing a page counter");
});

// ── the control still works ───────────────────────────────────────────────
test("the first page still shows five rows of 1–5 plus 0, with no legend row", () => {
  const { at } = openSkills();
  assertRatingIntact(at, 5);
  const firstRow = at().querySelectorAll(".rate-row")[0];
  const labels = firstRow.querySelectorAll(".rate-dot").map((d) => plain(textOf(d)));
  eq(labels, ["1", "2", "3", "4", "5", "0"], "dot labels in the first row");
});

test("answering a page still advances to the second five, also without a counter", () => {
  const { at } = openSkills();
  const rows = at().querySelectorAll(".rate-row");
  eq(rows.length, 5, "first page rows");
  const before = textOf(at().querySelectorAll(".rate-row")[0]);
  for (const row of rows) {
    const dot = row.querySelectorAll(".rate-dot")[2]; // "3"
    ok(dot, "a rating row has no dots");
    dot.onclick();
  }
  // The app advances the page itself once all five are answered.
  const after = at().querySelectorAll(".rate-row");
  eq(after.length, 5, "second page rows");
  ok(textOf(after[0]) !== before, "the page did not advance to the next five skills");
  eq(at().querySelectorAll(".rate-count").length, 0, ".rate-count on the second page");
  assertRatingIntact(at, 5);
});

if (failures.length) {
  console.error(failures.map((f) => "  x " + f).join("\n"));
  console.error(`\n${failures.length} of ${passed + failures.length} checks FAILED.`);
  process.exitCode = 1;
} else {
  console.log(`${passed} checks passed: the skills rating shows no x–y/N indicator and still rates correctly.`);
}
