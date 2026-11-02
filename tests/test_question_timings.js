// Per-question completion time (v13): question_timings table, the client
// measurement in timing.js, the server sanitiser in api/timings.js, and the
// wiring between them. No database and no browser needed — the two modules are
// pure, and the wiring is asserted against the shipped files.
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const { normalizeTimings } = require(path.join(ROOT, "api", "timings.js"));
const { createTracker, clampMs } = require(path.join(ROOT, "timing.js"));

const SERVER = read(path.join("api", "server.js"));
const APP = read("app.js");
const HTML = read("index.html");
const NOW = Date.parse("2025-06-01T12:00:00Z");
const MAX_MS = 86400000;

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed++; }
  catch (e) { failures.push(name + ": " + e.message); }
}

// ── the invariants every value in this feature must satisfy ─────────────────
function assertValidTimings(map, where) {
  assert.ok(map && typeof map === "object" && !Array.isArray(map), where + ": not an object map");
  for (const [id, ms] of Object.entries(map)) {
    assert.ok(/^[A-Za-z0-9_]{1,64}$/.test(id), where + ": bad question id " + JSON.stringify(id));
    assert.ok(Number.isInteger(ms), where + ": " + id + " is not an integer (" + ms + ")");
    assert.ok(ms >= 0 && ms <= MAX_MS, where + ": " + id + " out of range (" + ms + ")");
  }
}

// ── normalisation of what the browser sends ─────────────────────────────────
check("accepts the object map the client sends", () => {
  const out = normalizeTimings({ gender: 4200, age_group: 0 }, NOW);
  assert.deepStrictEqual(out.map((t) => [t.question_id, t.ms]), [["gender", 4200], ["age_group", 0]]);
});

check("accepts [id, ms] pairs and {id, ms} objects", () => {
  const out = normalizeTimings([["a_q", 1500], { id: "b_q", ms: 2500 }], NOW);
  assert.deepStrictEqual(out.map((t) => [t.question_id, t.ms]), [["a_q", 1500], ["b_q", 2500]]);
});

check("drops ids that cannot be question ids", () => {
  const tooLong = "x".repeat(65);
  const out = normalizeTimings({ "bad id!": 10, "ok_q": 10, "": 5, [tooLong]: 5, "drop;table": 8 }, NOW);
  assert.deepStrictEqual(out.map((t) => t.question_id), ["ok_q"]);
});

check("drops non-numeric and negative durations instead of guessing", () => {
  assert.deepStrictEqual(normalizeTimings({ a: "soon", b: null, c: -5, d: NaN, e: Infinity }, NOW), []);
});

check("clamps absurd durations to 24h rather than storing garbage", () => {
  const out = normalizeTimings({ a: 999999999999, b: 1e19 }, NOW);
  assert.deepStrictEqual(out.map((t) => t.ms), [MAX_MS, MAX_MS]);
});

check("duplicate ids collapse to one row, last value wins", () => {
  const out = normalizeTimings([{ id: "a", ms: 1111 }, { id: "a", ms: 2222 }], NOW);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].ms, 2222);
});

check("caps the number of questions accepted", () => {
  const many = {};
  for (let i = 0; i < 400; i++) many["q" + i] = 10;
  assert.strictEqual(normalizeTimings(many, NOW).length, 200);
});

check("shown_at is exactly answered_at minus the measured time", () => {
  const t = normalizeTimings([{ id: "a", ms: 90000, at: NOW }], NOW)[0];
  assert.strictEqual(t.answered_at.getTime(), NOW);
  assert.strictEqual(t.shown_at.getTime(), NOW - 90000);
});

check("an implausible answer timestamp falls back to the server clock", () => {
  const stale = normalizeTimings([{ id: "a", ms: 1000, at: 1 }], NOW)[0];
  const future = normalizeTimings([{ id: "a", ms: 1000, at: NOW + 7 * 86400000 }], NOW)[0];
  assert.strictEqual(stale.answered_at.getTime(), NOW);
  assert.strictEqual(future.answered_at.getTime(), NOW);
  assertValidTimings({ a: stale.ms }, "fallback");
});

check("junk payloads produce no rows and no throw", () => {
  for (const junk of [null, undefined, "x", 42, [], {}, true]) {
    assert.deepStrictEqual(normalizeTimings(junk, NOW), []);
  }
});

// ── the in-browser measurement ──────────────────────────────────────────────
function tracker(startMs) {
  const clock = { t: startMs };
  return { clock, tr: createTracker({ now: () => clock.t }) };
}

check("records the time a question stays on screen", () => {
  const { clock, tr } = tracker(1000);
  tr.enter("a"); clock.t += 4200;
  tr.enter("b");
  const s = tr.stamp();
  assertValidTimings(s, "stamp");
  assert.strictEqual(s.a, 4200);
});

check("re-rendering the same question does not reset its clock", () => {
  const { clock, tr } = tracker(0);
  tr.enter("rate"); clock.t += 500;
  tr.enter("rate"); clock.t += 500;   // rating sub-page re-render
  tr.enter("other");
  assert.strictEqual(tr.stamp().rate, 1000);
});

check("returning to a question adds a second visit to its total", () => {
  const { clock, tr } = tracker(0);
  tr.enter("a"); clock.t += 300;
  tr.enter("b"); clock.t += 700;      // time on b must not leak into a
  tr.enter("a"); clock.t += 200;
  const s = tr.stamp();
  assert.strictEqual(s.a, 500);
  assert.strictEqual(s.b, 700);
});

check("stamp includes the open question, snapshot does not, and stamping twice does not double count", () => {
  const { clock, tr } = tracker(0);
  tr.enter("a"); clock.t += 250;
  assert.deepStrictEqual(tr.snapshot(), {});
  assert.strictEqual(tr.stamp().a, 250);
  assert.strictEqual(tr.stamp().a, 250);
  tr.enter("b"); clock.t += 50;
  assert.strictEqual(tr.snapshot().a, 250);
  assert.strictEqual(tr.stamp().a, 250);
  assert.strictEqual(tr.stamp().b, 50);
});

check("a clock that jumps backwards yields zero, never a negative time", () => {
  const { clock, tr } = tracker(1000000);
  tr.enter("a"); clock.t -= 500000;
  tr.enter("b");
  const s = tr.stamp();
  assertValidTimings(s, "backwards");
  assert.strictEqual(s.a, 0);
});

check("a forgotten tab cannot produce more than 24h", () => {
  const { clock, tr } = tracker(0);
  tr.enter("a"); clock.t += 7 * 86400000;
  tr.enter("b");
  const s = tr.stamp();
  assertValidTimings(s, "cap");
  assert.strictEqual(s.a, MAX_MS);
});

check("restore keeps valid totals and drops junk from a draft", () => {
  const { tr } = tracker(0);
  tr.restore({ a: 5000, b: -3, c: "junk", d: 9e12, e: null });
  const s = tr.stamp();
  assertValidTimings(s, "restore");
  assert.strictEqual(s.a, 5000);
  assert.strictEqual(s.d, MAX_MS);
  assert.ok(!("b" in s) && !("c" in s) && !("e" in s), "junk restored: " + JSON.stringify(s));
});

check("reset clears totals so a second attempt starts clean", () => {
  const { clock, tr } = tracker(0);
  tr.enter("a"); clock.t += 900;
  tr.reset();
  assert.deepStrictEqual(tr.stamp(), {});
  assert.strictEqual(tr.currentQuestion(), null);
});

check("clampMs is total: any input maps into 0..24h", () => {
  for (const v of [-1, 0, 1.4, "7", NaN, Infinity, -Infinity, null, undefined, 1e12]) {
    const out = clampMs(v);
    assert.ok(Number.isInteger(out) && out >= 0 && out <= MAX_MS, "clampMs(" + v + ") = " + out);
  }
});

// ── schema ─────────────────────────────────────────────────────────────────
const SCHEMA = (SERVER.match(/const SCHEMA_SQL = `([\s\S]*?)`;/) || [])[1] || "";

check("schema creates question_timings with the documented columns", () => {
  assert.ok(SCHEMA, "SCHEMA_SQL not found in api/server.js");
  const table = SCHEMA.match(/CREATE TABLE IF NOT EXISTS question_timings \(([\s\S]*?)\n\);/);
  assert.ok(table, "question_timings DDL missing");
  const cols = table[1];
  for (const col of ["respondent_id", "question_id", "ms", "shown_at", "answered_at"]) {
    assert.ok(new RegExp("\\b" + col + "\\b").test(cols), "column missing: " + col);
  }
});

check("one row per question per respondent, and a deleted respondent takes its rows", () => {
  const table = SCHEMA.match(/CREATE TABLE IF NOT EXISTS question_timings \(([\s\S]*?)\n\);/)[1];
  assert.ok(/PRIMARY KEY \(respondent_id, question_id\)/.test(table), "primary key must key the pair");
  assert.ok(/REFERENCES respondents\(id\) ON DELETE CASCADE/.test(table), "must cascade with the respondent");
});

check("the duration column cannot hold an impossible value", () => {
  const table = SCHEMA.match(/CREATE TABLE IF NOT EXISTS question_timings \(([\s\S]*?)\n\);/)[1];
  assert.ok(/ms INTEGER NOT NULL/.test(table), "ms must be a non-null integer");
  assert.ok(/CHECK \(ms >= 0 AND ms <= 86400000\)/.test(table), "ms needs a range check");
});

check("per-question lookups are indexed", () => {
  assert.ok(/CREATE INDEX IF NOT EXISTS idx_question_timings_question ON question_timings \(question_id\)/.test(SCHEMA));
});

// ── server wiring ──────────────────────────────────────────────────────────
check("submissions store timings inside the same transaction", () => {
  const start = SERVER.indexOf('app.post("/api/submissions"');
  assert.ok(start > 0, "submissions route missing");
  const commit = SERVER.indexOf('await client.query("COMMIT")', start);
  assert.ok(commit > start, "COMMIT not found in the submissions route");
  const route = SERVER.slice(start, commit + 40);
  assert.ok(/INSERT INTO question_timings/.test(route), "submissions never writes question_timings");
  assert.ok(/ON CONFLICT \(respondent_id, question_id\) DO UPDATE/.test(route), "re-submission must update, not duplicate");
  assert.ok(route.indexOf("INSERT INTO question_timings") < route.indexOf('"COMMIT"'), "timing write must happen before COMMIT");
  assert.ok(/normalizeTimings\(req\.body && req\.body\.timings/.test(route), "payload must be sanitised before insert");
});

check("a timing failure cannot roll back a saved response", () => {
  const i = SERVER.indexOf("INSERT INTO question_timings");
  const before = SERVER.slice(Math.max(0, i - 900), i);
  assert.ok(/SAVEPOINT question_timings/.test(before), "insert must be guarded by a savepoint");
  const after = SERVER.slice(i, i + 1200);
  assert.ok(/ROLLBACK TO SAVEPOINT question_timings/.test(after), "failure must roll back to the savepoint");
  assert.ok(/RELEASE SAVEPOINT question_timings/.test(after), "success must release the savepoint");
});

check("every export carries the per-question times", () => {
  assert.ok(/\["question_timings", "SELECT[^"]*FROM question_timings/.test(SERVER), "EXPORT_TABLES missing question_timings");
  assert.ok(/question_timings: "question_timings"/.test(SERVER), "xlsx sheet name missing");
  assert.ok(/qt\.total_ms, qt\.question_timings/.test(SERVER), "wide CSV missing the per-respondent columns");
  assert.ok(/jsonb_object_agg\(question_id, ms\)/.test(SERVER), "wide CSV needs the question -> ms map");
});

// ── client wiring ──────────────────────────────────────────────────────────
check("the tracker loads before the app that uses it", () => {
  const js = [...HTML.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  const t = js.indexOf("timing.js");
  const a = js.indexOf("app.js");
  assert.ok(t >= 0, "index.html does not load timing.js");
  assert.ok(t < a, "timing.js must load before app.js");
});

check("the app tracks the question it renders", () => {
  assert.ok(/window\.NordikTiming\.createTracker\(\)/.test(APP), "app.js does not create a tracker");
  const i = APP.indexOf("const q = list[pos];");
  assert.ok(i > 0, "renderSurvey shape changed");
  const after = APP.slice(i, i + 900);
  assert.ok(/timing\.enter\(q\.id\)/.test(after), "renderSurvey must enter the rendered question");
});

check("the submission payload carries the totals", () => {
  const i = APP.indexOf('fetch("/api/submissions"');
  assert.ok(i > 0, "submission POST not found");
  const body = APP.slice(i, i + 700);
  assert.ok(/timings: timing\.stamp\(\)/.test(body), "payload does not send the per-question times");
  assert.ok(/answers/.test(body) && /captcha_token/.test(body), "payload shape changed unexpectedly");
});

check("the draft persists the totals and restores them on reload", () => {
  const start = APP.indexOf("function saveDraft()");
  assert.ok(start > 0, "saveDraft not found");
  const end = APP.indexOf("\n  }", start);
  const fn = APP.slice(start, end);
  assert.ok(/timings: timing\.stamp\(\)/.test(fn), "saveDraft does not persist timings");
  assert.ok(/d\.timings\) timing\.restore\(d\.timings\)/.test(APP), "draft restore ignores timings");
  assert.ok(/timing\.reset\(\)/.test(APP), "a new attempt must clear the timings");
});

check("no stale tracker calls remain in the app", () => {
  assert.ok(!/timing\.pause\(/.test(APP), "app.js still calls a tracker method that no longer exists");
  assert.ok(!/timing\.snapshot\(/.test(APP), "app.js should use stamp() so the open question is included");
});

// ── report ─────────────────────────────────────────────────────────────────
if (failures.length) {
  console.log("FAIL — " + failures.length + " of " + (passed + failures.length) + " tests failed");
  for (const f of failures) console.log("  ✗ " + f);
  process.exit(1);
}
console.log("PASS — " + passed + " tests");
