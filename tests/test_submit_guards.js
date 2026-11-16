// Submitting is write-once, and Submit cannot hang on a stalled save.
//
// Both defects were found by probing the real stack before deploying the
// partial-save work:
//
//  1. POST /api/submissions updated whatever respondents row matched the id,
//     including one that had already been submitted. Probing it changed a
//     completed response: gender Woman→Man, age 25-34→65+, language en→fr, and
//     completed_at moved forward. Anyone holding a respondent id could rewrite
//     that person's answers — and /api/progress already refused this case.
//
//  2. submit() waited for the queued /api/progress saves with no bound. One save
//     that never settled (a stalled phone) left the page on "Saving your
//     response… One moment." for good and sent no submission at all, so a
//     complete attempt stayed stored as a partial row.
//
// Checked here: the submission statement's guard, the route's refusal path, the
// client's handling of that refusal, the bounded flush and the order it keeps,
// and that the production image ships the modules server.js requires.
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const { mount } = require("./helpers/app-dom.js");

const SERVER = read(path.join("api", "server.js"));
const APP = read("app.js");
const DOCKERFILE = read("Dockerfile");
const API_DOCKERFILE = read(path.join("api", "Dockerfile"));

const UUID = "3f2b8c1e-9d4a-4b7e-8c15-2a6f0d9e4b31";
const DRAFT_KEY = "sault_survey_draft_v1";

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

const routeBody = (marker) => {
  const at = SERVER.indexOf(marker);
  if (at < 0) return "";
  const rest = SERVER.slice(at + marker.length);
  const next = rest.search(/\napp\.(get|post|put|delete)\(/);
  return next < 0 ? rest : rest.slice(0, next);
};
const SUBMIT_ROUTE = routeBody('app.post("/api/submissions"');
// The submission statement, straight out of the shipped route.
const SUBMIT_UPDATE = (SUBMIT_ROUTE.match(/UPDATE respondents[\s\S]*?RETURNING id`/) || [""])[0];

// ── the server: a submitted response is never rewritten ─────────────────────
check("the submission statement only completes a row that is not already submitted", () => {
  assert.ok(SUBMIT_UPDATE, "the submit route has no respondents update");
  // The guard belongs on the UPDATE itself. A read-then-write would leave a
  // window in which two Submits both see an unfinished row and both write it.
  assert.ok(/WHERE id=\$1 AND completed_at IS NULL/.test(SUBMIT_UPDATE),
    "a second Submit may overwrite an already-submitted response");
  assert.ok(/completed_at=now\(\)/.test(SUBMIT_UPDATE), "the submission no longer completes the row");
  assert.ok(/survey_version='v12'/.test(SUBMIT_UPDATE), "the submission no longer claims its version");
});

check("a response that is already submitted is refused, and the refusal is rolled back", () => {
  const at = SUBMIT_ROUTE.indexOf("if (u.rowCount === 0)");
  assert.ok(at > -1, "the submit route ignores a row that did not match");
  const block = SUBMIT_ROUTE.slice(at, SUBMIT_ROUTE.indexOf("id = null", at) + 1);
  assert.ok(/SELECT completed_at FROM respondents WHERE id=\$1/.test(block),
    "the route cannot tell a stale id from an already-submitted one");
  assert.ok(/status\(409\)/.test(block), "an already-submitted response is not reported as a conflict");
  assert.ok(/already_submitted/.test(block), "the conflict has no reason the client can act on");
  assert.ok(/ROLLBACK/.test(block), "the transaction is left open while a 409 is returned");
  // The progress endpoint refuses the same case with the same reason, so one
  // rule covers both paths.
  const progress = routeBody('app.post("/api/progress"');
  assert.ok(/already_submitted/.test(progress), "the two save paths disagree about a finished response");
});

check("a stale id still inserts a fresh row instead of failing the submission", () => {
  assert.ok(/id = null; \/\/ stale/.test(SUBMIT_ROUTE), "the stale-id fall-through is gone");
  assert.ok(/INSERT INTO respondents/.test(SUBMIT_ROUTE), "a submission with no row can no longer be stored");
  // Insert must not have gained the guard: the refusal is about an existing,
  // finished row, not about storing a new one.
  assert.ok(!/INSERT INTO respondents[\s\S]{0,400}completed_at IS NULL/.test(SUBMIT_ROUTE),
    "the insert path refuses new responses");
});

// ── the client: a refusal from the server is a success, not an error ────────
check("a 409 from Submit is treated as already recorded, not as a failure", () => {
  assert.ok(/r\.status === 409/.test(APP), "the client does not recognise the refusal");
  assert.ok(/alreadySubmitted/.test(APP), "the client has no path for a response that is already stored");
});

// ── the client: the flush is bounded and keeps its order ───────────────────
const FLUSH_MS = Number((APP.match(/PROGRESS_FLUSH_TIMEOUT_MS\s*=\s*(\d+)/) || [])[1]);
check("the wait for queued saves is bounded", () => {
  assert.ok(FLUSH_MS > 0, "Submit still waits on queued saves with no upper bound");
  assert.ok(FLUSH_MS >= 1000 && FLUSH_MS <= 15000,
    "a " + FLUSH_MS + "ms bound is either too short to let a save land or too long to be a rescue");
  const fn = APP.slice(APP.indexOf("function flushProgress()"), APP.indexOf("function flushProgress()") + 400);
  assert.ok(/Promise\.race/.test(fn), "nothing races the queued saves against the bound");
  assert.ok(/progressClosed = true/.test(fn), "saves may still be queued after Submit");
});

// ── walking the real app.js to the final page ──────────────────────────────
const ANSWERS = {
  consent: "Yes, I confirm", eligible: "Yes", moved_from: "Other parts of Ontario",
  gender: "Woman", age_group: "25-34", immigration_category: "Permanent resident",
  recent_credential: "College certificate", program_location: "In Canada",
  highest_education: "No", highest_credential: "College certificate",
  highest_completed_location: "In Canada", current_program: "College certificate",
  employed_before: "No, I wasn't employed", home_emp_before: "No",
  employment_status: "Employed full time permanent (30+ hours/week)", intended_job: "No",
  work_barrier_gate: "No", skill_match: "Yes, it matches", work_confidence: "Confident",
  retain_5_years: "Probably yes", recommend_survey: "Yes", gift_card_draw: "No",
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const treeText = (n) => {
  if (!n) return "";
  let t = n._text || "";
  for (const c of n.children || []) t += " " + treeText(c);
  return t.replace(/\s+/g, " ").trim();
};

// Mounts the survey on the last page before Submit, with the CAPTCHA solved the
// way a real widget solves it: its callback fires after the box is on the page.
// response(url, opts) stands in for the network.
function openAtFinalPage(response, currentId) {
  const store = {};
  store[DRAFT_KEY] = JSON.stringify({ answers: Object.assign({}, ANSWERS), currentId, respondentId: UUID });
  const app = mount({ store });
  const calls = [];
  const frames = [];
  // The harness fires animation frames synchronously, which mounts the CAPTCHA
  // before its box is on the page; a real frame runs after. Deferring it makes
  // the widget behave as it does in a browser.
  app.window.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
  // Real timers, at 1ms instead of the shipped bound, so the tests do not sleep.
  app.window.setTimeout = (fn) => setTimeout(fn, 1);
  app.window.turnstile = {
    render: (box, opts) => { opts.callback("test-token"); return "w1"; },
    remove() {}, reset() {},
  };
  app.window.fetch = (url, opts) => {
    calls.push({ url, body: (opts && opts.body) || "" });
    return response(url, opts);
  };
  app.openSurvey();
  const drain = () => frames.splice(0).forEach((fn) => fn());
  drain();
  return { app, calls, store, drain, draft: () => store[DRAFT_KEY] };
}

const ok = (json) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(json || { id: UUID }) });

check("Submit goes ahead when a queued save never settles", () => {
  // recommend_survey is the question before the final page, so one Next queues a
  // save and lands on Submit with that save still in flight.
  const { app, calls, drain } = openAtFinalPage((url) => {
    if (url === "/api/progress") return new Promise(() => {}); // never settles
    return ok();
  }, "recommend_survey");

  const next = app.document.body.querySelector("#btn-next");
  assert.ok(next, "the question before Submit has no Next button");
  next.onclick();
  drain(); // the final page is rendered, so its CAPTCHA can mount

  return wait(20).then(() => {
    const submit = app.document.body.querySelector("#btn-submit");
    assert.ok(submit, "the final page did not render");
    assert.strictEqual(submit.disabled, false, "the CAPTCHA never unlocked Submit");
    submit.onclick();
    return wait(120);
  }).then(() => {
    const posted = calls.filter((c) => c.url === "/api/submissions");
    assert.strictEqual(posted.length, 1, "a stalled save still blocks Submit");
    assert.ok(posted[0].body.includes(UUID), "the submission is not for the respondent");
  });
});

check("Submit still waits for the saves that do land, in order", () => {
  const { app, calls, drain } = openAtFinalPage((url) => {
    if (url === "/api/progress") {
      // lands promptly, but only after a few microtask turns
      return Promise.resolve().then(() => Promise.resolve()).then(() => ({ ok: true, status: 200, json: () => Promise.resolve({ saved: true }) }));
    }
    return ok();
  }, "recommend_survey");

  app.document.body.querySelector("#btn-next").onclick();
  drain();
  return wait(20).then(() => {
    app.document.body.querySelector("#btn-submit").onclick();
    return wait(120);
  }).then(() => {
    const lastSave = calls.map((c) => c.url).lastIndexOf("/api/progress");
    const submit = calls.findIndex((c) => c.url === "/api/submissions");
    assert.ok(submit > -1, "no submission was sent");
    assert.ok(submit > lastSave, "the submission overtook a save that was already landing");
  });
});

check("a 409 from Submit shows the recorded-response card and keeps no draft", () => {
  const { app, draft } = openAtFinalPage((url) => {
    if (url === "/api/profile") return ok();
    if (url === "/api/submissions") {
      return Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({ error: "already_submitted" }) });
    }
    return ok();
  }, "gift_card_draw");

  const submit = app.document.body.querySelector("#btn-submit");
  assert.ok(submit, "the final page did not render");
  submit.onclick();
  return wait(120).then(() => {
    // The error card keeps the draft so the respondent can try again; the
    // already-recorded card means there is nothing left to retry.
    assert.strictEqual(draft(), undefined, "a 409 left the draft behind");
    const trophy = app.document.body.querySelectorAll(".champion-trophy");
    assert.ok(trophy.length, "the refusal left the page without a confirmation card");
    assert.ok(!/couldn't save/i.test(treeText(app.document.body)), "a stored response was reported as a failure");
  });
});

// ── the image must ship what server.js requires ────────────────────────────
check("the production image copies every module server.js requires", () => {
  const required = [...read(path.join("api", "server.js")).matchAll(/require\("\.\/([\w.-]+)"\)/g)]
    .map((m) => m[1]);
  assert.ok(required.length, "no local modules found in server.js");
  for (const mod of required) {
    const file = mod.endsWith(".js") ? mod : mod + ".js";
    // The image is built from the root Dockerfile; api/Dockerfile is what
    // docker-compose uses locally. Both must ship it or the container dies on
    // boot with "Cannot find module './progress'".
    assert.ok(new RegExp("COPY\\s+api/" + file.replace(/\./g, "\\.") + "\\s").test(DOCKERFILE),
      "Dockerfile does not copy api/" + file + ", so the deployed container cannot start");
    assert.ok(new RegExp("COPY\\s+" + file.replace(/\./g, "\\.") + "\\s").test(API_DOCKERFILE),
      "api/Dockerfile does not copy " + file + ", so the local stack cannot start");
  }
});

Promise.all(pending).then(() => {
  for (const f of failures) console.error("FAIL " + f);
  console.log(`test_submit_guards: ${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
});
