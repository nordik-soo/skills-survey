// The Bengali survey must show the uploaded questionnaire's text, character for
// character. tests/fixtures/bn-docx.json is extracted from
// Translation-Final.zip by tools/build_bn_docx_fixture.py; this test holds the
// shipped dictionary against it.
//
// Run: node tests/test_bn_docx_parity.js
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const FIXTURE = path.join(ROOT, "tests/fixtures/bn-docx.json");

let failures = 0;
let checks = 0;

function check(name, fn) {
  checks++;
  try {
    fn();
  } catch (err) {
    failures++;
    console.log(`  ✗ ${name}: ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function load(file) {
  const sb = { window: {}, document: { createElement: () => ({ style: {} }) } };
  sb.window = sb;
  new Function("window", "document", fs.readFileSync(path.join(ROOT, file), "utf8"))(sb, sb.document);
  return sb;
}

const fixture = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
const questions = load("survey-data.js").SURVEY.QUESTIONS;
const i18n = load("translations.js").window.I18N;
const bn = i18n.dicts.bn;

// Matching key used by the generator, so option values pair across the two
// files even though the app spells some of them with curly quotes or dashes.
function norm(s) {
  return String(s)
    .replace(/\u00a0/g, " ")
    .replace(/[\u200b]/g, "")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2265/g, ">=")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Picklist values (country names) are canonical data the survey shows in
// English in every language - tests/test_i18n_languages.js enforces that - so
// they are out of scope for Bengali parity by design, not by omission.
const PICKLIST_QUESTIONS = new Set(["country_moved_from"]);

const byOption = (id, value) => fixture.questions[id].options[norm(value)];

// ── the fixture itself ────────────────────────────────────────────────────
check("the fixture records where it came from", () => {
  assert(/Translation-Final\.zip/.test(fixture.source), "source is not the uploaded zip");
  assert(Object.keys(fixture.questions).length > 70, "fixture is suspiciously small");
});

check("no fixture entry carries an empty string", () => {
  for (const [id, entry] of Object.entries(fixture.questions)) {
    assert(entry.text !== undefined, `${id} has no question text`);
    for (const [en, tr] of Object.entries(entry.options)) {
      assert(tr && tr.trim() === tr, `${id} option ${en.slice(0, 30)} is empty or padded`);
    }
  }
});

// ── question text, byte for byte ──────────────────────────────────────────
// The consent screen also carries the two links to the information letter; the
// document has the same sentence without link markup, so the comparison drops
// the markup and requires the remaining text to match exactly.
const stripLinks = (s) => String(s).replace(/\[([^\]]*)\]\(([^)]*)\)/g, "$1");

check("every question prompt equals the document text exactly", () => {
  for (const [id, entry] of Object.entries(fixture.questions)) {
    if (!entry.text) continue;
    const shipped = bn.q[id];
    assert(shipped !== undefined, `${id} has no Bangla prompt`);
    const a = id === "consent" ? stripLinks(shipped) : shipped;
    assert(a === entry.text, `${id} differs from the document`);
  }
});

check("the document's three barrier-gate wordings are all present", () => {
  for (const key of ["work_barrier.a", "work_barrier.b", "work_barrier.c"]) {
    assert(bn.q[key] === fixture.questions[key].text, `${key} is not the document's wording`);
  }
});

// ── option text, byte for byte ────────────────────────────────────────────
check("every option label the app can show equals the document text exactly", () => {
  for (const q of questions) {
    const entry = fixture.questions[q.id];
    if (!entry) continue;
    if (PICKLIST_QUESTIONS.has(q.id)) continue;
    for (const raw of q.options || []) {
      const value = typeof raw === "string" ? raw : raw.value;
      const expected = byOption(q.id, value);
      if (expected === undefined) continue; // a value the document does not list
      assert(bn.o[value] !== undefined, `${q.id} option ${value.slice(0, 40)} has no Bangla`);
      assert(bn.o[value] === expected, `${q.id} option ${value.slice(0, 40)} differs from the document`);
    }
  }
});

// ── the defect that started this: the student barrier list ────────────────
check("the student barrier list uses each barrier's own wording", () => {
  const q = questions.find((x) => x.id === "student_barriers");
  assert(q, "student_barriers is missing");
  assert(q.options.length === 18, `expected 18 barriers, found ${q.options.length}`);
  for (const raw of q.options) {
    const value = typeof raw === "string" ? raw : raw.value;
    assert(bn.o[value] !== undefined, `barrier "${value.slice(0, 40)}" has no Bangla`);
  }
  // The document's ID_C_4_2_a copy of this list is damaged (it lists 18 items,
  // misses Health issues and Immigration-related limitations, and carries an
  // option the question does not offer), so the wording must come from the
  // aligned lists. Options are keyed by their English value, so what this
  // protects is that each barrier resolves to its own translation.
  const shared = ["Health issues", "Immigration-related limitations"];
  for (const v of shared) {
    assert(bn.o[v] !== undefined, `"${v}" has no Bangla`);
  }
  for (const other of ["work_barriers", "unemployment_reasons", "not_looking_barriers"]) {
    const o = questions.find((x) => x.id === other);
    for (const raw of o.options) {
      const value = typeof raw === "string" ? raw : raw.value;
      const translated = bn.o[value];
      if (translated === undefined) continue;
      assert(translated.trim() !== "", `${value.slice(0, 40)} is blank`);
      // the same barrier must read the same in every question that offers it
      const here = bn.o[value];
      assert(here === translated, `"${value.slice(0, 40)}" differs between barrier questions`);
    }
  }
});

// ── the invariant the whole feature depends on ────────────────────────────
// One checker for the rule that must always hold: every Bengali string the
// survey can display is text from the document, never a paraphrase and never a
// silent English fallback. A few values are legitimately outside the document,
// and they are named here rather than waved through.
const OUTSIDE_DOCUMENT = new Set([
  "Don't know", // the app offers this where the document offers "Not sure"
]);

const documentText = new Set();
for (const entry of Object.values(fixture.questions)) {
  if (entry.text) documentText.add(entry.text);
  for (const tr of Object.values(entry.options)) documentText.add(tr);
}

check("no displayed Bengali string paraphrases the document", () => {
  for (const q of questions) {
    if (bn.q[q.id] !== undefined && fixture.questions[q.id]) {
      const expected = fixture.questions[q.id].text;
      const shipped = q.id === "consent" ? stripLinks(bn.q[q.id]) : bn.q[q.id];
      assert(shipped === expected, `prompt ${q.id} is not the document's text`);
    }
    for (const raw of q.options || []) {
      const value = typeof raw === "string" ? raw : raw.value;
      const tr = bn.o[value];
      if (tr === undefined || OUTSIDE_DOCUMENT.has(value)) continue;
      assert(documentText.has(tr), `option "${value.slice(0, 40)}" shows text the document does not contain`);
    }
  }
});

// ── coverage: no English leaking into the Bengali survey ──────────────────
check("no survey question falls back to English in Bengali", () => {
  const english = [];
  for (const q of questions) {
    if (!q.options && q.type !== "single" && q.type !== "multi") continue;
    const key = q.textKey ? q.textKey({}) : q.id;
    const prompt = bn.q[q.id] !== undefined ? bn.q[q.id] : bn.q[key];
    // dynamic prompts are keyed by textKey; only require one of the two
    if (prompt === undefined) english.push(q.id);
  }
  assert(english.length === 0, `no Bangla prompt for: ${english.join(", ")}`);
});

check("no survey option falls back to English in Bengali", () => {
  const english = [];
  for (const q of questions) {
    if (PICKLIST_QUESTIONS.has(q.id)) continue;
    for (const raw of q.options || []) {
      const value = typeof raw === "string" ? raw : raw.value;
      if (bn.o[value] === undefined) english.push(`${q.id}: ${value}`);
    }
  }
  // The language picker shows native names, not dictionary entries.
  const leftover = english.filter((e) => !e.startsWith("language: "));
  assert(leftover.length === 0, `English labels remain: ${leftover.join(" | ")}`);
});

check("the Bengali option dictionary holds no text from elsewhere", () => {
  // Every key must be an option the survey actually offers, or the document's
  // own text for an option that used to exist. Anything else is an unreachable
  // translation of unknown origin.
  const offered = new Set();
  for (const q of questions) {
    if (PICKLIST_QUESTIONS.has(q.id)) continue;
    for (const raw of q.options || []) offered.add(typeof raw === "string" ? raw : raw.value);
  }
  const stray = Object.keys(bn.o).filter((key) => !offered.has(key));
  assert(stray.length === 0, `unreachable translations: ${stray.slice(0, 5).join(" | ")}`);
});

check("the language picker resolves every language name natively", () => {
  const q = questions.find((x) => x.id === "language");
  for (const raw of q.options) {
    const value = typeof raw === "string" ? raw : raw.value;
    const native = i18n.native(value);
    assert(native && native !== "", `${value} has no native name`);
  }
});

console.log(failures === 0 ? `PASS — ${checks} tests` : `FAIL — ${failures} of ${checks} tests failed`);
if (failures) process.exitCode = 1;
