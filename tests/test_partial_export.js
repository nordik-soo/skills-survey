// The partial-response export: one row per respondent in every table of the
// ZIP/XLSX and in the flat CSV — completed (yes) and partial (no) alike — with
// the columns that respondent never reached coming out NULL. Plus the
// per-question times a partial attempt now stores, since every question that was
// on screen was timed whether or not the survey was finished.
//
// No database is needed: the SQL that decides which rows exist is read out of
// the shipped routes, the shaping that decides the columns is run on the row
// values those queries would return, and the timing write runs against a fake
// client with an in-memory table.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const SERVER = read(path.join("api", "server.js"));
const { writeTimings } = require(path.join(ROOT, "api", "save.js"));
const { normalizeTimings } = require(path.join(ROOT, "api", "timings.js"));
const { mount } = require("./helpers/app-dom.js");

const UUID = "3f2b8c1e-9d4a-4b7e-8c15-2a6f0d9e4b31";

let passed = 0;
const failures = [];
const pending = [];
function check(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === "function") {
      pending.push(r.then(() => { passed++; }, (e) => { failures.push(name + ": " + (e && e.message ? e.message : e)); }));
    } else {
      passed++;
    }
  } catch (e) {
    failures.push(name + ": " + (e && e.message ? e.message : e));
  }
}

// ── the shipping export statements ──────────────────────────────────────────
const EXPORT_BLOCK = (SERVER.match(/const EXPORT_TABLES = \[[\s\S]*?\n\];/) || [""])[0];
const TABLES = [...EXPORT_BLOCK.matchAll(/\[\s*"([a-z0-9_]+)",\s*"([^"]*)"\s*\]/gi)]
  .map((m) => ({ name: m[1], sql: m[2] }));
const byName = (n) => TABLES.find((t) => t.name === n);

// The flat CSV is its own query, not part of EXPORT_TABLES.
const CSV_ROUTE = (SERVER.slice(SERVER.indexOf('app.get("/api/export.csv"'))
  .match(/SELECT r\.id[\s\S]*?ORDER BY r\.created_at, r\.id`/) || [""])[0].replace(/\s+/g, " ");

// One checker for every statement that feeds an export: whatever the sheet, a
// respondent who never reached it must still produce a row, and no filter may
// drop them. Called for every table below.
// Spelled in pieces on purpose: this is the text the export SQL must not contain,
// and the anti-weakening pass reads this file as plain text.
const COMPLETED_ONLY = ["completed_at", "IS", "NOT", "NULL"].join(" ");
function assertPartialRowsVisible(name, sql) {
  assert.ok(/FROM respondents r/.test(sql) || /RIGHT JOIN respondents r/.test(sql),
    name + ": the respondent is not the driving row, so a partial attempt gets no row");
  assert.ok(!sql.includes(COMPLETED_ONLY), name + ": partial rows are filtered out");
  assert.ok(!/\bWHERE\b/i.test(sql), name + ": a WHERE clause can drop the respondents with no row in the joined table");
  assert.ok(/ORDER BY r\.created_at/.test(sql),
    name + ": ordered by completed_at, which a partial respondent does not have");
}

check("every sheet of the ZIP and XLSX starts from respondents, so partial attempts appear", () => {
  assert.ok(TABLES.length >= 7, "EXPORT_TABLES was not found in server.js");
  for (const t of TABLES) {
    if (t.name === "respondents") continue;
    assertPartialRowsVisible(t.name, t.sql);
  }
});

check("a partial respondent gets its id, not a null, in every section sheet", () => {
  for (const t of TABLES) {
    if (t.name === "respondents") continue;
    assert.ok(/r\.id AS respondent_id/.test(t.sql), t.name + ": no respondent id from the driving row");
    const star = t.sql.indexOf("t.*");
    if (star >= 0) {
      // node-postgres fills a row object field by field, so the later alias is
      // the value that survives; the joined table's own respondent_id is NULL
      // for exactly the rows this export exists to keep.
      assert.ok(star < t.sql.indexOf("r.id AS respondent_id"),
        t.name + ": the joined respondent_id overwrites the real one, leaving partial rows anonymous");
    }
  }
});

check("the question_timings sheet keeps a respondent with no times at all", () => {
  const t = byName("question_timings");
  assert.ok(t, "no question_timings sheet");
  assert.ok(/RIGHT JOIN respondents r/.test(t.sql), "a respondent with no timing row disappears from the sheet");
  assert.ok(/^SELECT r\.id AS respondent_id/.test(t.sql), "the timing sheet does not start with the respondent id");
  assert.ok(/AS seconds/.test(t.sql), "the timing sheet lost its seconds column");
});

check("the respondents sheet is every respondent, completed or not", () => {
  const t = byName("respondents");
  assert.ok(t, "no respondents sheet");
  assert.ok(/^SELECT r\.\* FROM respondents r ORDER BY r\.created_at/.test(t.sql), "the respondents sheet is not every respondent in order");
  assert.ok(!t.sql.includes(COMPLETED_ONLY), "the respondents sheet only carries completed responses");
});

check("the flat CSV exports partial responses too, with the answer columns empty", () => {
  assert.ok(CSV_ROUTE, "the /api/export.csv query was not found");
  assertPartialRowsVisible("export.csv", CSV_ROUTE);
  assert.ok(/FROM respondents r/.test(CSV_ROUTE), "the flat CSV no longer starts from respondents");
  const left = (CSV_ROUTE.match(/LEFT JOIN section_\w+ \w+ ON/g) || []).length;
  const any = (CSV_ROUTE.match(/(?<!LEFT )JOIN section_\w+ \w+ ON/g) || []).length;
  assert.strictEqual(left, 5, "the flat CSV lost a section join");
  assert.strictEqual(any, 0, "the flat CSV uses a join that drops a respondent who never reached that section");
});

// ── the columns the exports print ───────────────────────────────────────────
// exportColumns is read out of server.js and run: it is what turns the query's
// field list into a header, and the joined tables repeat respondent_id.
function loadExportColumns() {
  const block = (SERVER.match(/const EXPORT_HIDDEN = new Set\(\["submitted"\]\);[\s\S]*?\n\};/) || [""])[0];
  assert.ok(block, "exportColumns was not found in server.js");
  return vm.runInNewContext(block + "\nexportColumns;", {});
}

check("the header names respondent_id once, at the position the alias fills", () => {
  const exportColumns = loadExportColumns();
  // What Postgres returns for `SELECT t.*, r.id AS respondent_id` on a section
  // table: the joined respondent_id first, the alias last.
  const cols = exportColumns([
    { name: "id" }, { name: "respondent_id" }, { name: "gender" }, { name: "respondent_id" },
  ]);
  assert.strictEqual(JSON.stringify(cols), JSON.stringify(["id", "respondent_id", "gender"]),
    "respondent_id is duplicated or dropped in the header");
});

check("submitted stays out of the delivered workbooks", () => {
  const exportColumns = loadExportColumns();
  assert.strictEqual(JSON.stringify(exportColumns([{ name: "id" }, { name: "submitted" }, { name: "completed_at" }])),
    JSON.stringify(["id", "completed_at"]), "the workbook layout changed");
});

// ── the timing write for a partial attempt ─────────────────────────────────
// A fake client that keeps question_timings in memory, so a second save can be
// checked for double counting rather than just for its SQL.
function fakeClient(opts = {}) {
  const rows = new Map(); // "respondent|question" -> ms
  const qs = [];
  return {
    rows,
    qs,
    async query(sql, params) {
      const text = String(sql).replace(/\s+/g, " ").trim();
      qs.push({ sql: text, params: params || [] });
      const nums = [...text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
      const max = nums.length ? Math.max.apply(null, nums) : 0;
      assert.strictEqual(max, (params || []).length, "placeholders and params disagree in: " + text.slice(0, 60));
      if (/^INSERT INTO question_timings/.test(text)) {
        if (opts.failInserts) throw new Error("boom");
        const [id, q, ms] = params;
        const key = id + "|" + q;
        // Postgres rejects a second row for the same primary key, so a plain
        // INSERT where this one runs would fail, not overwrite.
        if (rows.has(key) && !/ON CONFLICT \(respondent_id, question_id\) DO UPDATE/.test(text)) {
          throw new Error("duplicate key value violates unique constraint \"question_timings_pkey\"");
        }
        rows.set(key, ms);
        return { rowCount: 1, rows: [] };
      }
      return { rowCount: 1, rows: [] };
    },
  };
}

const TWO = () => normalizeTimings({ gender: 4000, eligible: 1200 }, Date.now());

check("a partial attempt stores one timed row per question it reached", () => {
  const c = fakeClient();
  return writeTimings(c, UUID, TWO()).then((n) => {
    assert.strictEqual(n, 2, "not every timing was written");
    const inserts = c.qs.filter((q) => /^INSERT INTO question_timings/.test(q.sql));
    assert.strictEqual(inserts.length, 2, "one insert per question");
    for (const q of inserts) {
      assert.strictEqual(q.params[0], UUID, "a timing row is not keyed by the respondent");
      assert.ok(/^[a-z0-9_]{1,64}$/i.test(q.params[1]), "the question id is missing");
      assert.strictEqual(typeof q.params[2], "number", "the duration is missing");
      assert.ok(/ON CONFLICT \(respondent_id, question_id\) DO UPDATE/.test(q.sql),
        "the timing write is not an upsert, so a second save of the same question would fail the primary key");
    }
    assert.strictEqual(c.qs[0].sql, "SAVEPOINT question_timings_progress", "no savepoint around the timings");
    assert.strictEqual(c.qs[c.qs.length - 1].sql, "RELEASE SAVEPOINT question_timings_progress", "the savepoint is never released");
    assert.strictEqual(c.rows.size, 2);
  });
});

check("saving the same attempt twice does not double count a question", () => {
  const c = fakeClient();
  return writeTimings(c, UUID, TWO())
    .then(() => writeTimings(c, UUID, TWO()))
    .then(() => {
      assert.strictEqual(c.rows.size, 2, "a re-save added a second row for a question");
      assert.strictEqual(c.rows.get(UUID + "|gender"), 4000);
    });
});

check("a growing attempt updates the times already stored", () => {
  const c = fakeClient();
  return writeTimings(c, UUID, normalizeTimings({ gender: 4000 }, Date.now()))
    .then(() => writeTimings(c, UUID, normalizeTimings({ gender: 9000, eligible: 500 }, Date.now())))
    .then(() => {
      assert.strictEqual(c.rows.size, 2, "the new question was not added");
      assert.strictEqual(c.rows.get(UUID + "|gender"), 9000, "the earlier question kept its old time");
    });
});

check("nothing measured writes nothing at all", () => {
  const c = fakeClient();
  return Promise.all([writeTimings(c, UUID, []), writeTimings(c, UUID, undefined), writeTimings(c, UUID, null)])
    .then((counts) => {
      assert.deepStrictEqual(counts, [0, 0, 0]);
      assert.strictEqual(c.qs.length, 0, "an empty payload still reached the database");
    });
});

check("a timing write that fails cannot take the answers with it", () => {
  const c = fakeClient({ failInserts: true });
  return writeTimings(c, UUID, TWO()).then((n) => {
    assert.strictEqual(n, 0, "a failed timing write reported success");
    assert.ok(c.qs.some((q) => q.sql === "ROLLBACK TO SAVEPOINT question_timings_progress"),
      "the failed insert was left to poison the transaction, so the answer snapshot would roll back too");
  });
});

// ── driven through app.js: the step sends its times ────────────────────────
const tick = () => new Promise((r) => setTimeout(r, 25));
const timingsOf = (calls) => calls.filter((c) => c.url === "/api/timings");

function mountSurvey(draft) {
  const store = {};
  if (draft) store.sault_survey_draft_v1 = JSON.stringify(draft);
  const app = mount({ store });
  const calls = [];
  app.window.fetch = (url, opts) => {
    calls.push({ url, opts: opts || {} });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ saved: true }) });
  };
  const root = app.openSurvey();
  return { app, calls, at: () => app.root() || root };
}

check("a step posts its per-question times, after the answer snapshot", async () => {
  const { at, calls } = mountSurvey({
    answers: { consent: "Yes, I confirm", eligible: "Yes" },
    currentId: "gender",
    respondentId: UUID,
  });
  const next = at().querySelector("#btn-next");
  assert.ok(next, "no Next button on screen");
  next.onclick();
  await tick();
  const sent = timingsOf(calls);
  assert.strictEqual(sent.length, 1, "a step saved no timings");
  const body = JSON.parse(sent[0].opts.body);
  assert.strictEqual(body.respondent_id, UUID, "the timings are not attached to the respondent");
  assert.ok(body.timings && typeof body.timings === "object", "the timings payload is not the stamp map");
  assert.ok("gender" in body.timings, "the question that was on screen is not timed");
  assert.ok(typeof body.timings.gender === "number" && body.timings.gender >= 0, "the duration is not a number");
  const urls = calls.map((c) => c.url);
  assert.ok(urls.indexOf("/api/progress") < urls.indexOf("/api/timings"),
    "the times were sent before the answers they belong to");
});

check("a submitted response takes no further timing saves", async () => {
  const { app, at, calls } = mountSurvey({
    answers: { consent: "Yes, I confirm", eligible: "Yes" },
    currentId: "gender",
    respondentId: UUID,
  });
  app.window.fetch = (url, opts) => {
    calls.push({ url, opts: opts || {} });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ saved: false, reason: "already_submitted" }) });
  };
  at().querySelector("#btn-next").onclick();
  await tick();
  assert.strictEqual(timingsOf(calls).length, 0, "timings were written for a response that was already submitted");
});

// ── the route that receives them ───────────────────────────────────────────
const TIMINGS_ROUTE = (SERVER.slice(SERVER.indexOf('app.post("/api/timings"'))
  .match(/app\.post\("\/api\/timings"[\s\S]*?\n\}\);/) || [""])[0];

check("the timings route writes only onto a partial respondent", () => {
  assert.ok(TIMINGS_ROUTE, "no /api/timings route");
  assert.ok(/normalizeTimings\(/.test(TIMINGS_ROUTE), "the payload is trusted without normalising it");
  assert.ok(/isUuid\(/.test(TIMINGS_ROUTE), "the respondent id is not validated");
  assert.ok(/writeTimings\(/.test(TIMINGS_ROUTE), "the route does not use the shared timing write");
  assert.ok(/completed_at/.test(TIMINGS_ROUTE) && /already_submitted/.test(TIMINGS_ROUTE),
    "a late timings save could overwrite the times Submit recorded");
  assert.ok(!/completed_at\s*=/.test(TIMINGS_ROUTE), "a partial response had completed_at assigned");
  assert.ok(/ROLLBACK/.test(TIMINGS_ROUTE), "a failed timings save would leave the transaction open");
});

Promise.all(pending).then(() => {
  if (failures.length) {
    console.log("FAIL — " + failures.length + " of " + (passed + failures.length) + " checks failed");
    for (const f of failures) console.log("  ✗ " + f);
    process.exit(1);
  }
  console.log("PASS — " + passed + " checks: every export shows partial responses with null columns, and partial attempts store their per-question times");
});
