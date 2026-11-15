// Two respondent columns must never be blank: home_variant (one of the two live
// homepage variants, HP1/HP2 — the pilot's third, HP3, is retired) and
// language_preference (the code the header language picker shows at submit time).
//
// The normalisation helpers are pure, so this test evaluates the shipped block
// from api/server.js directly rather than restating its rules. The wiring (which
// SQL columns each endpoint writes) and the schema guarantees are asserted
// against the shipped files, and both are exercised for real by the Docker
// end-to-end check described in the project notes.
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const SERVER = read(path.join("api", "server.js"));
const APP = read("app.js");
const INIT = read(path.join("db", "init", "01_schema.sql"));

const START_MARK = "// ── variant + language normalisation";
const END_MARK = "// ── end variant + language normalisation";

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed++; }
  catch (e) { failures.push(name + ": " + e.message); }
}

// ── the shipped helpers, evaluated ─────────────────────────────────────────
function loadHelpers() {
  const i = SERVER.indexOf(START_MARK);
  const j = SERVER.indexOf(END_MARK);
  assert.ok(i >= 0 && j > i, "the pure variant/language block is missing from api/server.js");
  const code = SERVER.slice(i, j) +
    "\nmodule.exports = { HOME_VARIANTS, variant, pickVariant, LANGS, DEFAULT_LANG, langCode, payloadLang };";
  const mod = { exports: {} };
  new Function("module", code)(mod);
  return mod.exports;
}
const H = loadHelpers();

// ── the one checker: every value these helpers produce must be storable ────
// Called by every behavioural test. A blank, a retired variant or a language the
// site does not ship would make the column fail its NOT NULL / CHECK guarantee.
function assertStorable(lang, v, where) {
  assert.ok(typeof v === "string" && v.length > 0, where + ": blank variant");
  assert.ok(H.HOME_VARIANTS.includes(v), where + ": retired variant " + JSON.stringify(v));
  assert.ok(typeof lang === "string" && lang.length > 0, where + ": blank language");
  assert.ok(H.LANGS.includes(lang), where + ": unknown language " + JSON.stringify(lang));
}

// ── the two live variants ──────────────────────────────────────────────────
check("exactly two homepage variants remain", () => {
  assert.deepStrictEqual(H.HOME_VARIANTS, ["HP1", "HP2"]);
});

check("the retired third homepage is refused, live ones survive", () => {
  assert.strictEqual(H.variant("HP3"), null);
  assert.strictEqual(H.variant("hp3"), null);
  assert.strictEqual(H.variant(""), null);
  assert.strictEqual(H.variant(undefined), null);
  assert.strictEqual(H.variant("HP1"), "HP1");
  assert.strictEqual(H.variant("HP2"), "HP2");
});

check("a start call without a variant is assigned one, never left blank", () => {
  const inputs = [undefined, null, "", "HP3", "HP9", "HP1 ", 42, {}, [], true, "garbage"];
  for (const bad of inputs) {
    for (let i = 0; i < 40; i++) {
      const v = H.pickVariant(bad);
      assertStorable("en", v, "pickVariant(" + JSON.stringify(bad) + ")");
    }
  }
});

check("a valid variant is kept rather than re-randomised", () => {
  for (let i = 0; i < 20; i++) {
    assert.strictEqual(H.pickVariant("HP1"), "HP1");
    assert.strictEqual(H.pickVariant("HP2"), "HP2");
  }
});

check("both variants are actually reachable", () => {
  const seen = new Set();
  for (let i = 0; i < 400; i++) seen.add(H.pickVariant(null));
  assert.deepStrictEqual([...seen].sort(), ["HP1", "HP2"]);
});

// ── the language the picker chose ──────────────────────────────────────────
check("every shipped language code round-trips", () => {
  for (const code of H.LANGS) {
    assert.strictEqual(H.langCode(code), code, "code " + code);
    assertStorable(H.langCode(code), "HP1", "langCode(" + code + ")");
  }
});

check("the picker's messy input is normalised, not rejected", () => {
  assert.strictEqual(H.langCode("AR"), "ar");
  assert.strictEqual(H.langCode(" ar "), "ar");
  assert.strictEqual(H.langCode("pt-BR"), "pt");
  assert.strictEqual(H.langCode("zh_CN"), "zh");
  assert.strictEqual(H.langCode("tl"), "tl");
});

check("an unusable language falls back to English instead of blank", () => {
  for (const bad of [undefined, null, "", "  ", "klingon", "HP3", 42, {}, [], "e n"]) {
    const code = H.langCode(bad);
    assert.strictEqual(code, H.DEFAULT_LANG, "input " + JSON.stringify(bad));
    assertStorable(code, "HP1", "langCode(" + JSON.stringify(bad) + ")");
  }
});

check("the submission payload is read from the body, then the answers", () => {
  assert.strictEqual(H.payloadLang({ language: "ar" }), "ar");
  assert.strictEqual(H.payloadLang({ answers: { language: "fr" } }), "fr");
  assert.strictEqual(H.payloadLang({ language: "ar", answers: { language: "fr" } }), "ar");
  // ...and the legacy question id is still honoured while it is in an old draft
  assert.strictEqual(H.payloadLang({ answers: { language: "hi" } }), "hi");
});

check("a payload with no language is 'not sent', not English", () => {
  // A stale cached client omits `language`. Treating that as English would
  // overwrite the choice the respondent actually made, so it must stay null.
  assert.strictEqual(H.payloadLang({}), null);
  assert.strictEqual(H.payloadLang(undefined), null);
  assert.strictEqual(H.payloadLang({ answers: {} }), null);
  assert.strictEqual(H.payloadLang({ language: "" }), null);
});

// ── the server writes both columns on every path ───────────────────────────
function section(from, to) {
  const i = SERVER.indexOf(from);
  assert.ok(i >= 0, "missing " + from + " in api/server.js");
  const j = to ? SERVER.indexOf(to, i) : -1;
  return SERVER.slice(i, j > i ? j : undefined);
}

const START_SRC = section('app.post("/api/start"', 'app.post("/api/signal"');
const SUBMIT_SRC = section('app.post("/api/submissions"', "// Section A");

check("/api/start assigns a variant instead of storing NULL", () => {
  assert.ok(/const v = pickVariant\(/.test(START_SRC), "start must use pickVariant");
  assert.ok(!/const v = variant\(/.test(START_SRC), "start must not write a nullable variant");
});

check("/api/start records the header language on both channels", () => {
  const langWrites = START_SRC.split("language_preference").length - 1;
  assert.ok(langWrites >= 2, "both the invite and public inserts must write language_preference");
  assert.ok(/langCode\(req\.body && req\.body\.language\)/.test(START_SRC), "start must normalise the language");
});

check("a submission keeps the assigned variant and never blanks it", () => {
  assert.ok(/home_variant=COALESCE\(home_variant, \$10\)/.test(SUBMIT_SRC),
    "the update must fill a missing variant and keep an existing one");
});

check("a submission without a prior start still stores both columns", () => {
  const insert = SUBMIT_SRC.slice(SUBMIT_SRC.indexOf("if (!id)"));
  assert.ok(/INSERT INTO respondents/.test(insert), "the fallback insert must exist");
  for (const col of ["home_variant", "channel", "source", "language_preference"]) {
    assert.ok(insert.includes(col), "fallback insert must write " + col);
  }
  assert.ok(/lang \|\| DEFAULT_LANG/.test(insert), "fallback insert must never write a blank language");
});

check("a re-submission of a stale client keeps the stored language", () => {
  assert.ok(/language_preference=COALESCE\(\$9, language_preference\)/.test(SUBMIT_SRC),
    "an absent language must not overwrite a stored choice");
});

// ── the database enforces it ───────────────────────────────────────────────
const SCHEMA = section("const SCHEMA_SQL = `", "async function initSchema");

check("the boot schema repairs legacy rows before constraining them", () => {
  assert.ok(/UPDATE respondents SET home_variant = 'HP1'[\s\S]*?NOT IN \('HP1', 'HP2'\)/.test(SCHEMA),
    "rows with no variant or the retired one must be repaired first");
  assert.ok(/UPDATE respondents SET language_preference = 'en'/.test(SCHEMA),
    "rows with no language must be repaired first");
  const repair = SCHEMA.indexOf("UPDATE respondents SET home_variant");
  const constraint = SCHEMA.indexOf("respondents_home_variant_check");
  assert.ok(repair >= 0 && repair < constraint, "the repair must run before the CHECK is added");
});

check("both columns are NOT NULL in the boot schema", () => {
  assert.ok(/ALTER TABLE respondents ALTER COLUMN home_variant SET NOT NULL/.test(SCHEMA));
  assert.ok(/ALTER TABLE respondents ALTER COLUMN language_preference SET NOT NULL/.test(SCHEMA));
  assert.ok(/ALTER TABLE respondents ALTER COLUMN home_variant SET DEFAULT 'HP1'/.test(SCHEMA));
  assert.ok(/ALTER TABLE respondents ALTER COLUMN language_preference SET DEFAULT 'en'/.test(SCHEMA));
});

check("the schema allows only the two live variants", () => {
  const m = SCHEMA.match(/CHECK \(home_variant IN \(([^)]*)\)\)/);
  assert.ok(m, "home_variant needs an IN check");
  const allowed = m[1].split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
  assert.deepStrictEqual(allowed, H.HOME_VARIANTS);
});

check("the documented init schema agrees with the boot schema", () => {
  assert.ok(/home_variant TEXT NOT NULL DEFAULT 'HP1'/.test(INIT),
    "db/init must declare home_variant NOT NULL with a default");
  assert.ok(/CHECK \(home_variant IN \('HP1',\s*'HP2'\)\)/.test(INIT),
    "db/init must allow only HP1 and HP2");
  assert.ok(!/HP1\/HP2\/HP3/.test(INIT), "db/init must not advertise the retired variant");
});

// ── the browser sends the picker's choice ──────────────────────────────────
check("the submission carries the language shown in the header", () => {
  const submit = APP.slice(APP.indexOf("function submit()"));
  assert.ok(/language: lang,/.test(submit), "the submission body must carry language: lang");
  assert.ok(/variant: homeVariant,/.test(submit), "the submission body must carry the variant");
});

check("starting the survey records the language chosen so far", () => {
  const start = APP.slice(APP.indexOf("function startSurvey()"));
  const body = start.slice(0, start.indexOf(".catch("));
  assert.ok(/language: lang/.test(body), "the start body must carry language: lang");
});

// ── report ─────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(failures.length + " failure(s):");
  for (const f of failures) console.error("  x " + f);
  process.exit(1);
}
console.log(passed + " checks passed: only HP1 and HP2 are ever stored, and a respondent's language choice reaches the database.");
