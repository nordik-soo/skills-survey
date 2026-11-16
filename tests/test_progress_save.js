// Partial-response saves: an attempt that never reaches Submit still lands in
// the database.
//
// The survey used to write answers only inside POST /api/submissions, so anyone
// who closed the tab mid-survey left a respondents row with nothing in it. Now
// the client posts its whole answer snapshot to POST /api/progress after every
// Next (and after every page of the skills question); that write leaves
// completed_at NULL, which is what the generated respondents.submitted column
// reads as "No". Submit is unchanged and still sets completed_at, which makes
// the same column read "Yes".
//
// Checked here: the progress decision rules, the SQL the partial save runs
// (against a fake client, so no database is needed), its parity with the submit
// statement, the schema/migration, the export column list, and the wiring
// driven through the real app.js.
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const { progressDecision, hasAnswer, isUuid } = require(path.join(ROOT, "api", "progress.js"));
const { writeProgressAnswers, writeSections, saveProgressSnapshot } = require(path.join(ROOT, "api", "save.js"));
const { mount } = require("./helpers/app-dom.js");

const SERVER = read(path.join("api", "server.js"));
const APP = read("app.js");
const SCHEMA = read(path.join("db", "init", "01_schema.sql"));
const MIGRATION = read(path.join("db", "init", "02_submitted_column.sql"));

// The submission statement, straight out of the shipped route.
const SUBMIT_UPDATE = (SERVER.slice(SERVER.indexOf('app.post("/api/submissions"'))
  .match(/UPDATE respondents[\s\S]*?RETURNING id`/) || [""])[0];

const UUID = "3f2b8c1e-9d4a-4b7e-8c15-2a6f0d9e4b31";
const CONSENT_NO = "No, I do not confirm";

let passed = 0;
const failures = [];
const pending = [];
function check(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === "function") {
      pending.push(r.then(
        () => { passed++; },
        (e) => { failures.push(name + ": " + (e && e.message ? e.message : e)); }
      ));
    } else {
      passed++;
    }
  } catch (e) {
    failures.push(name + ": " + (e && e.message ? e.message : e));
  }
}

// ── one checker: what every write to a respondent must satisfy ──────────────
// Called at the end of each fake-client test. A statement whose placeholders
// and params disagree throws in Postgres at runtime, which would lose the
// respondent's answers, so it is checked before anything else.
function assertWriteInvariants(client, opts = {}) {
  let sectionWrites = 0;
  for (const q of client.qs) {
    const nums = [...q.sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
    const max = nums.length ? Math.max(...nums) : 0;
    assert.strictEqual(max, q.params.length, "placeholder/param count mismatch in: " + q.sql.slice(0, 60));
    assert.ok(!/;\s*(drop|delete|truncate)\b/i.test(q.sql), "destructive SQL reached the database");
    if (/^\s*UPDATE respondents/.test(q.sql)) {
      assert.ok(/completed_at IS NULL/.test(q.sql), "a partial save may overwrite a submitted response");
    }
    if (/^\s*INSERT INTO section_/.test(q.sql)) {
      sectionWrites++;
      assert.ok(/ON CONFLICT \(respondent_id\) DO UPDATE/.test(q.sql), "section write is not an upsert");
      assert.strictEqual(q.params[0], opts.id || null, "section write is not keyed by the respondent id");
    }
    // Nothing on the partial path may complete the row or claim a version.
    // completed_at may only appear as the `IS NULL` guard that protects an
    // already-submitted response, never as an assignment.
    assert.ok(!/completed_at\s*=/.test(q.sql), "a partial save assigned completed_at: " + q.sql.slice(0, 60));
    assert.ok(!/survey_version/.test(q.sql), "a partial save stamped a survey version: " + q.sql.slice(0, 60));
  }
  return sectionWrites;
}

function fakeClient(rowCount = 1) {
  return {
    qs: [],
    async query(sql, params) {
      this.qs.push({ sql: String(sql), params: params || [] });
      if (/^\s*UPDATE respondents/.test(String(sql))) {
        return { rowCount, rows: rowCount ? [{ id: (params || [])[0] }] : [] };
      }
      return { rowCount: 1, rows: [] };
    },
  };
}

// ── the decision: what may be stored as progress ────────────────────────────
check("a real snapshot with a respondent id is stored", () => {
  const d = progressDecision({ respondent_id: UUID, answers: { consent: "Yes, I confirm", gender: "Woman" } });
  assert.strictEqual(d.save, true);
  assert.strictEqual(d.id, UUID);
});

check("an uppercase uuid is accepted and normalised", () => {
  const d = progressDecision({ respondent_id: UUID.toUpperCase(), answers: { gender: "Man" } });
  assert.strictEqual(d.save, true, "uppercase id refused");
  assert.strictEqual(d.id, UUID);
});

check("a malformed or missing respondent id is refused, never invented", () => {
  for (const id of [undefined, null, "", "abc", "1 OR 1=1", 42, UUID + "x"]) {
    const d = progressDecision({ respondent_id: id, answers: { gender: "Man" } });
    assert.strictEqual(d.save, false, "saved with id " + JSON.stringify(id));
    assert.strictEqual(d.status, 400, "status for id " + JSON.stringify(id));
  }
});

check("nothing is stored after a declined consent", () => {
  const d = progressDecision({ respondent_id: UUID, answers: { consent: CONSENT_NO } });
  assert.strictEqual(d.save, false);
  assert.strictEqual(d.reason, "consent_declined");
});

check("nothing is stored after an ineligible answer", () => {
  const d = progressDecision({ respondent_id: UUID, answers: { consent: "Yes, I confirm", eligible: "No" } });
  assert.strictEqual(d.save, false);
  assert.strictEqual(d.reason, "ineligible");
});

check("nothing is stored before the first answer", () => {
  for (const answers of [undefined, null, {}, [], "x"]) {
    const d = progressDecision({ respondent_id: UUID, answers });
    assert.strictEqual(d.save, false, "saved answers " + JSON.stringify(answers));
  }
  assert.strictEqual(hasAnswer({ a: "", b: [], c: {} }), false, "empty values counted as an answer");
  assert.strictEqual(hasAnswer({ a: "x" }), true);
  assert.strictEqual(hasAnswer({ skills: { "Skill A": 3 } }), true, "a skills map is not recognised as an answer");
});

check("a body that is not an object is refused instead of throwing", () => {
  for (const body of [undefined, null, "x", 7, []]) {
    const d = progressDecision(body);
    assert.strictEqual(d.save, false);
    assert.strictEqual(d.status, 400);
  }
});

// ── the partial write ───────────────────────────────────────────────────────
function setClause(sql) {
  const m = String(sql).match(/UPDATE respondents\s+SET([\s\S]*?)WHERE id=\$1/);
  assert.ok(m, "not a respondents update: " + sql);
  return m[1].replace(/\s+/g, "");
}

check("a partial save writes the answer columns and never completed_at", () => {
  const c = fakeClient();
  return writeProgressAnswers(c, UUID, { consent: "Yes, I confirm", moved_from: "India", province: "Ontario" }, { lang: "en", variant: "A" }).then((n) => {
    assert.strictEqual(n, 1);
    assert.strictEqual(c.qs.length, 1);
    assert.strictEqual(assertWriteInvariants(c, { id: UUID }), 0);
    const set = setClause(c.qs[0].sql);
    assert.ok(!/completed_at/.test(set), "a partial save touches completed_at");
    assert.ok(!/survey_version/.test(set), "a partial save claims a submitted response");
    assert.deepStrictEqual(
      c.qs[0].params.slice(1, 7),
      [true, null, "India", "Ontario", null, null],
      "answer columns are not in the documented order"
    );
  });
});

check("a partial save writes exactly the columns a submission writes, minus completed_at", () => {
  // The submit route keeps its own statement (tests/test_variant_language.js pins
  // it); this keeps the two from drifting apart.
  const c = fakeClient();
  return writeProgressAnswers(c, UUID, { consent: "Yes, I confirm" }, { lang: "en", variant: "A" }).then(() => {
    const submit = setClause(SUBMIT_UPDATE);
    const expected = submit.replace("survey_version='v12',", "").replace("completed_at=now(),", "");
    assert.strictEqual(setClause(c.qs[0].sql), expected, "the partial update has drifted from the submitted one");
    assert.strictEqual(submit.length - expected.length, "survey_version='v12',completed_at=now(),".length,
      "the submission must add exactly survey_version and completed_at");
  });
});

check("a stale or malformed id updates nothing instead of writing a row", () => {
  const c = fakeClient(0);
  return writeProgressAnswers(c, UUID, { gender: "Man" }).then((n) => {
    assert.strictEqual(n, 0);
    const c2 = fakeClient();
    return writeProgressAnswers(c2, "not-a-uuid", { gender: "Man" }).then((n2) => {
      assert.strictEqual(n2, 0);
      assert.strictEqual(c2.qs.length, 0, "a malformed id still reached the database");
    });
  });
});

check("all five sections are written, once each, as upserts", () => {
  const c = fakeClient();
  return writeSections(c, UUID, { gender: "Woman", skills: { "Skill A": 3 } }).then(() => {
    const sections = assertWriteInvariants(c, { id: UUID });
    assert.strictEqual(sections, 5, "section rows written");
    const tables = c.qs.map((q) => (q.sql.match(/INSERT INTO (section_\w+)/) || [])[1]);
    assert.deepStrictEqual(tables, [
      "section_a_demographics",
      "section_b_education",
      "section_c_employment",
      "section_d_skills",
      "section_e_retention",
    ]);
  });
});

check("the skills map is replaced from the snapshot, not merged", () => {
  const c = fakeClient();
  return writeSections(c, UUID, { skills: { "Skill A": 3, "Skill B": 5 } }).then(() => {
    const q = c.qs.find((x) => /section_d_skills/.test(x.sql));
    assert.ok(q, "no skills write");
    // Replacing is what keeps the map honest: the snapshot already holds every
    // page rated so far, and merging would keep skills of an occupation group
    // the respondent has since changed away from.
    assert.ok(/skill_ratings=EXCLUDED\.skill_ratings/.test(q.sql), "skills are merged instead of replaced");
    assert.strictEqual(q.params[1], JSON.stringify({ "Skill A": 3, "Skill B": 5 }));
  });
});

check("no skills rated leaves the skills row empty rather than storing junk", () => {
  const c = fakeClient();
  return writeSections(c, UUID, {}).then(() => {
    const q = c.qs.find((x) => /section_d_skills/.test(x.sql));
    assert.strictEqual(q.params[1], null);
  });
});

check("a snapshot with an unknown respondent writes no section rows", () => {
  const c = fakeClient(0);
  return saveProgressSnapshot(c, UUID, { gender: "Man" }).then((n) => {
    assert.strictEqual(n, 0);
    assert.strictEqual(c.qs.length, 1, "sections were written for an unknown respondent");
  });
});

check("the same snapshot saved twice leaves one row per table", () => {
  const c = fakeClient();
  const snap = { gender: "Woman", skills: { "Skill A": 2 } };
  return saveProgressSnapshot(c, UUID, snap)
    .then(() => saveProgressSnapshot(c, UUID, snap))
    .then(() => {
      // Every write is an upsert on respondent_id, so repeats overwrite the same
      // row instead of adding one (asserted in assertWriteInvariants).
      assert.strictEqual(assertWriteInvariants(c, { id: UUID }), 10);
    });
});

// ── schema: the submitted column ────────────────────────────────────────────
const SUBMITTED_GENERATED = /submitted\s+TEXT\s+GENERATED ALWAYS AS\s*\(\s*CASE WHEN completed_at IS NULL THEN 'No' ELSE 'Yes' END\s*\)\s*STORED/i;

check("respondents.submitted is a generated Yes/No column derived from completed_at", () => {
  assert.ok(SUBMITTED_GENERATED.test(SCHEMA), "the schema has no generated submitted column");
});

check("the migration for the live database is idempotent", () => {
  assert.ok(SUBMITTED_GENERATED.test(MIGRATION), "the migration does not add the generated column");
  assert.ok(/ADD COLUMN IF NOT EXISTS/i.test(MIGRATION), "the migration would fail on a database that already has it");
  assert.ok(!/ALTER TABLE respondents\s+ADD COLUMN (?!IF NOT EXISTS)/i.test(MIGRATION), "a non-idempotent ALTER");
});

check("nothing else in the schema was changed or dropped", () => {
  assert.ok(/CREATE TABLE respondents/.test(SCHEMA));
  for (const t of ["invites", "home_impressions", "section_a_demographics", "section_b_education", "section_c_employment", "section_d_skills", "section_e_barriers_challenges"]) {
    assert.ok(new RegExp("CREATE TABLE " + t + "\\b").test(SCHEMA), "table " + t + " is gone");
  }
  // completed_at still decides what a submitted response is.
  assert.ok(/completed_at TIMESTAMPTZ/.test(SCHEMA));
});

// ── the endpoints ───────────────────────────────────────────────────────────
function routeBody(marker) {
  const at = SERVER.indexOf(marker);
  if (at < 0) return "";
  const rest = SERVER.slice(at + marker.length);
  const next = rest.search(/\napp\.(get|post|put|delete)\(/);
  return next < 0 ? rest : rest.slice(0, next);
}

check("POST /api/progress exists and needs no CAPTCHA", () => {
  const body = routeBody('app.post("/api/progress"');
  assert.ok(body, "no /api/progress route");
  assert.ok(/progressDecision\(/.test(body), "the route does not use the shared decision rules");
  assert.ok(!/verifyTurnstile|turnstile|captcha/i.test(body), "the progress route is CAPTCHA-gated");
  assert.ok(/saveProgressSnapshot\(/.test(body), "the route does not write the snapshot");
  assert.ok(!/completed_at\s*=/.test(body), "the progress route assigns completed_at");
  assert.ok(/already_submitted/.test(body), "a save landing after Submit is not reported as such");
  assert.ok(/ROLLBACK/.test(body), "a failed progress write is not rolled back");
  assert.ok(/unknown_respondent/.test(body), "an unknown respondent is not reported back");
});

check("submit still completes the response through the CAPTCHA check", () => {
  const body = routeBody('app.post("/api/submissions"');
  assert.ok(/captcha/.test(body), "submit lost its CAPTCHA check");
  assert.ok(/completed_at=now\(\)/.test(body), "submit no longer completes the row");
  assert.ok(/survey_version='v12'/.test(body), "submit no longer stamps the version");
});

check("the written statistics still count completed rows only", () => {
  const stats = routeBody('app.get("/api/stats"');
  assert.ok(/completed_at IS NOT NULL/.test(stats), "the completed count changed meaning");
  assert.ok(/count\(\*\)::int c FROM respondents"/.test(stats), "the started count changed");
});

check("the delivered workbooks keep their column layout", () => {
  assert.ok(/const EXPORT_HIDDEN = new Set\(\["submitted"\]\)/.test(SERVER), "submitted is not excluded from the exports");
  assert.ok(/exportColumns\(q\.fields\)/.test(SERVER), "the export does not use the filtered column list");
  assert.ok(!/toV5\(q\.fields\.map/.test(SERVER), "an export still maps every column, including submitted");
});

// ── the client wiring ───────────────────────────────────────────────────────
check("every Next, Back and skills page saves progress", () => {
  assert.ok(/function syncProgress\(\)/.test(APP), "no syncProgress in app.js");
  assert.ok(/currentId = list\[pos \+ 1\]\.id; saveDraft\(\); syncProgress\(\)/.test(APP), "Next does not save progress");
  assert.ok(/ratingStep\+\+; saveDraft\(\); syncProgress\(\)/.test(APP), "a skills page does not save progress");
  const backs = APP.match(/saveDraft\(\); syncProgress\(\); renderSurvey\(\)/g) || [];
  assert.ok(backs.length >= 3, "Back does not save progress on every screen (" + backs.length + ")");
});

check("submit waits for the partial saves already queued", () => {
  assert.ok(/flushProgress\(\)\.then\(\(\) => fetch\("\/api\/submissions"/.test(APP), "submit does not flush queued saves first");
  assert.ok(/progressClosed = true/.test(APP), "a partial save may follow a submit");
});

check("the client refuses to save a declined consent or an ineligible answer", () => {
  assert.ok(
    /if \(answers\.consent === "No, I do not confirm" \|\| answers\.eligible === "No"\) return progressChain;/.test(APP),
    "the client can post answers from someone who declined"
  );
});

// ── driven through the real app.js ──────────────────────────────────────────
const tick = () => new Promise((r) => setTimeout(r, 20));
const progressOf = (calls) => calls.filter((c) => c.url === "/api/progress");

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

// One checker for every progress request the client makes in these tests.
function assertCalls(calls, where) {
  for (const c of progressOf(calls)) {
    const body = JSON.parse(c.opts.body);
    assert.deepStrictEqual(Object.keys(body).sort(), ["answers", "language", "respondent_id", "variant"], where + ": payload keys");
    assert.ok(isUuid(body.respondent_id), where + ": respondent id is not a uuid");
    assert.ok(body.answers && typeof body.answers === "object" && !Array.isArray(body.answers), where + ": answers payload");
    assert.ok(!("captcha_token" in body), where + ": a CAPTCHA token on a progress save");
    assert.ok(!("timings" in body), where + ": timings on a progress save");
    assert.ok(!("completed_at" in body), where + ": completed_at on a progress save");
  }
}

const FLOW_DRAFT = {
  answers: { consent: "Yes, I confirm", eligible: "Yes" },
  currentId: "gender",
  respondentId: UUID,
};

check("clicking Next posts the answered snapshot while the row stays partial", async () => {
  const { at, calls } = mountSurvey(FLOW_DRAFT);
  const next = at().querySelector("#btn-next");
  assert.ok(next, "no Next button on screen");
  next.onclick();
  await tick();
  const posted = progressOf(calls);
  assert.strictEqual(posted.length, 1, "progress saves after one Next");
  assertCalls(calls, "Next");
  const body = JSON.parse(posted[0].opts.body);
  assert.strictEqual(body.respondent_id, UUID);
  assert.deepStrictEqual(body.answers, { consent: "Yes, I confirm", eligible: "Yes" });
});

check("a shot without a respondent row posts nothing", async () => {
  const { at, calls } = mountSurvey({ answers: { consent: "Yes, I confirm", eligible: "Yes" }, currentId: "gender" });
  const next = at().querySelector("#btn-next");
  assert.ok(next, "no Next button on screen");
  next.onclick();
  await tick();
  assert.strictEqual(progressOf(calls).length, 0, "progress posted without a respondent id");
});

check("going Back saves what is answered", async () => {
  const { at, calls } = mountSurvey({ ...FLOW_DRAFT, answers: { consent: "Yes, I confirm", eligible: "Yes", gender: "Woman" } });
  const back = at().querySelector(".btn-nav-arrow");
  if (!back) throw new Error("no Back button on screen");
  back.onclick();
  await tick();
  assert.strictEqual(progressOf(calls).length, 1, "Back did not save");
  assertCalls(calls, "Back");
});

check("each skills page is saved, and each save carries every page rated so far", async () => {
  const { at, calls } = mountSurvey({
    answers: {
      employment_status: "Employed full time permanent (30+ hours/week)",
      intended_job: "No",
      intended_job_title: "9421101 - Test Job",
    },
    currentId: "skills",
    respondentId: UUID,
  });
  const ratePage = () => {
    for (const row of at().querySelectorAll(".rate-row")) {
      const dot = row.querySelectorAll(".rate-dot")[2]; // the "3" dot
      assert.ok(dot, "a rating row has no dots");
      dot.onclick();
    }
  };
  ratePage(); // finishes page 1 → auto-advance saves
  await tick();
  assert.strictEqual(progressOf(calls).length, 1, "saves after the first skills page");
  const first = JSON.parse(progressOf(calls)[0].opts.body);
  assert.strictEqual(Object.keys(first.answers.skills).length, 5, "page 1 skills saved");

  ratePage(); // finishes the last page; the respondent then presses Next
  await tick();
  const next = at().querySelector("#btn-next");
  assert.ok(next, "no Next button after the last skills page");
  next.onclick();
  await tick();
  assert.strictEqual(progressOf(calls).length, 2, "saves after the last skills page");
  const second = JSON.parse(progressOf(calls)[1].opts.body);
  assert.strictEqual(Object.keys(second.answers.skills).length, 10, "page 2 did not carry page 1 as well");
  // The snapshot only ever grows, which is what makes replace-on-write safe.
  for (const k of Object.keys(first.answers.skills)) {
    assert.ok(k in second.answers.skills, "skill " + k + " was dropped by the later save");
  }
  assertCalls(calls, "skills");
});

check("a declined consent screen posts no progress", async () => {
  const { at, calls } = mountSurvey({ answers: { consent: CONSENT_NO }, currentId: "consent", respondentId: UUID });
  // The declined state offers no way forward, so nothing can be saved from it.
  assert.strictEqual(at().querySelector("#btn-next"), null, "a Next button on the declined screen");
  await tick();
  assert.strictEqual(progressOf(calls).length, 0, "a declined consent was posted");
});

// Late / duplicate saves: the server answers already_submitted for a response that
// has been submitted and unknown_respondent for an id it does not know, and the
// client must stop saving in both cases instead of retrying forever.
check("a save landing after Submit stops the tab from saving again", async () => {
  const { app, at, calls } = mountSurvey({ ...FLOW_DRAFT, answers: { consent: "Yes, I confirm", eligible: "Yes", gender: "Woman" } });
  app.window.fetch = (url, opts) => {
    calls.push({ url, opts });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ saved: false, reason: "already_submitted" }) });
  };
  at().querySelector("#btn-next").onclick();
  await tick();
  assert.strictEqual(progressOf(calls).length, 1, "the first step did not save");
  const again = at().querySelector("#btn-next");
  if (again) again.onclick();
  await tick();
  assert.strictEqual(progressOf(calls).length, 1, "a submitted response kept receiving partial saves");
  assertCalls(calls, "already_submitted");
});

check("an unknown respondent id stops the tab from saving again", async () => {
  const { app, at, calls } = mountSurvey({ ...FLOW_DRAFT, answers: { consent: "Yes, I confirm", eligible: "Yes", gender: "Woman" } });
  app.window.fetch = (url, opts) => {
    calls.push({ url, opts });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ saved: false, reason: "unknown_respondent" }) });
  };
  at().querySelector("#btn-next").onclick();
  await tick();
  assert.strictEqual(progressOf(calls).length, 1, "the first step did not save");
  const again = at().querySelector("#btn-next");
  if (again) again.onclick();
  await tick();
  assert.strictEqual(progressOf(calls).length, 1, "a stale respondent id kept being saved");
  assertCalls(calls, "unknown_respondent");
});

check("a failed save never blocks the survey", async () => {
  const { app, at, calls } = mountSurvey({ ...FLOW_DRAFT, answers: { consent: "Yes, I confirm", eligible: "Yes", gender: "Woman" } });
  app.window.fetch = (url, opts) => {
    calls.push({ url, opts });
    return Promise.reject(new Error("offline"));
  };
  at().querySelector("#btn-next").onclick();
  await tick();
  assert.ok(at().querySelector(".question-body, #btn-next, .rate-row"), "the survey did not render after a failed save");
  const draft = JSON.parse(app.window.localStorage.getItem("sault_survey_draft_v1"));
  assert.strictEqual(draft.answers.consent, "Yes, I confirm", "the local draft was lost after a failed save");
});

// ── report ──────────────────────────────────────────────────────────────────
Promise.all(pending).then(() => {
  if (failures.length) {
    console.log("FAIL — " + failures.length + " of " + (passed + failures.length) + " checks failed");
    for (const f of failures) console.log("  ✗ " + f);
    process.exit(1);
  }
  console.log("PASS — " + passed + " checks: partial answers are saved on every step, submitted stays Yes, partial stays No");
});
