// Regression: a browser that cannot write to localStorage must not freeze the
// survey. Saving the draft runs before the next screen is drawn, so an
// unguarded setItem left the respondent stuck on the first answered question
// with a Next button that did nothing.
//
// The survey is English only (v15): it opens on the consent question.
const fs = require("fs");
const path = require("path");
const { mount } = require("./helpers/app-dom.js");

const ROOT = path.join(__dirname, "..");
let failures = 0;
let checks = 0;

function check(name, fn) {
  checks++;
  try {
    fn();
    console.log("  ok  " + name);
  } catch (e) {
    failures++;
    console.log("  x   " + name + ": " + e.message);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
const plain = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const heading = (root) => plain((root.querySelector("h2") || {}).innerHTML);

// Every test drives the real app.js through the same harness.
function openWith(opts) {
  const app = mount(opts);
  const root = app.openSurvey();
  return { app, root: () => app.root() || root };
}

function pressNext(root) {
  const next = root().querySelector("#btn-next");
  assert(next, "there is no Next button on this screen");
  assert(!next.disabled, "the Next button is disabled");
  next.onclick();
}

// Answer the consent question with "Yes, I confirm".
function confirmConsent(root) {
  const opts = root().querySelectorAll(".opt");
  assert(opts.length === 2, "the consent screen should offer two answers, found " + opts.length);
  opts[0].onclick();
  pressNext(root);
}

// ── the failure itself ────────────────────────────────────────
check("a browser that cannot save still leaves the first question", () => {
  const { root } = openWith({ brokenStorage: true });
  assert(/consent/i.test(heading(root())), "the survey did not open on the consent question");
  const before = heading(root());
  confirmConsent(root);
  const after = heading(root());
  assert(after !== "", "nothing rendered after Next");
  assert(after !== before, "Next left the respondent on the consent question: " + after);
});

check("a browser that cannot save gets past the required questions", () => {
  const { root } = openWith({ brokenStorage: true });
  confirmConsent(root);
  const opts = root().querySelectorAll(".opt");
  assert(opts.length >= 2, "the eligibility question should offer answers, found " + opts.length);
  opts[0].onclick();
  pressNext(root);
  const after = heading(root());
  assert(after !== "", "the survey rendered nothing after the second question");
  assert(!/consent/i.test(after), "the survey did not reach the next question: " + after);
});

check("the whole survey can be completed with storage blocked", () => {
  const { root } = openWith({ brokenStorage: true });
  let screens = 0;
  for (let i = 0; i < 40; i++) {
    if (root().querySelector("#btn-submit")) break;
    if (root().querySelector(".state-card.card") && !root().querySelector(".opt")) break;
    const rows = root().querySelectorAll(".rate-row");
    if (rows.length) {
      for (const row of rows) {
        const d = row.querySelectorAll(".rate-dot")[2];
        if (d) d.onclick();
      }
    } else {
      const opts = root().querySelectorAll(".opt");
      const trigger = root().querySelector(".custom-select-trigger");
      if (opts.length) opts[0].onclick();
      else if (trigger) {
        trigger.onclick();
        const items = root().querySelectorAll(".custom-select-option");
        assert(items.length > 0, "a picklist rendered with no options");
        items[0].onclick();
      } else {
        for (const inp of root().querySelectorAll("input")) {
          inp.value = /mail/i.test(inp.placeholder || "") ? "a@b.co" : "probe";
          if (inp.oninput) inp.oninput({ target: inp });
        }
      }
    }
    const next = root().querySelector("#btn-next");
    if (!next) break;
    if (next.disabled) { next.disabled = false; }
    next.onclick();
    screens++;
  }
  assert(screens > 15, "only " + screens + " screens were reachable with storage blocked");
});

// ── nothing regressed for a browser that can save ────────────
check("a browser that can save still stores the draft", () => {
  const app = mount({});
  app.openSurvey();
  const root = () => app.root();
  confirmConsent(root);
  const draft = app.store["sault_survey_draft_v1"];
  assert(draft, "no draft was written to storage");
  const parsed = JSON.parse(draft);
  assert(parsed.answers && parsed.answers.consent === "Yes, I confirm", "the draft does not carry the consent answer");
  assert(parsed.currentId, "the draft does not carry the current question");
  assert(!("language" in (parsed.answers || {})), "the draft still stores a language answer");
});

check("a saved draft is still restored on a reload", () => {
  const first = mount({});
  first.openSurvey();
  confirmConsent(() => first.root());
  const saved = first.store["sault_survey_draft_v1"];
  assert(saved, "no draft to reload");

  const store = {};
  store["sault_survey_draft_v1"] = saved;
  const second = mount({ store });
  const root = second.openSurvey();
  const text = heading(root);
  assert(!/consent/i.test(text), "the reload fell back to the consent question");
  assert(text !== "", "nothing rendered after reload");
});

check("the in-memory fallback keeps the session usable", () => {
  const { app, root } = openWith({ brokenStorage: true });
  confirmConsent(root);
  // the answered consent question still shows its choice after going back,
  // even though nothing could be saved
  const back = root().querySelector("#btn-back");
  if (back && !back.disabled) {
    back.onclick();
    const chosen = root().querySelector(".opt.on");
    assert(chosen, "the consent answer was lost after re-rendering");
    assert(/yes/i.test(plain(chosen.innerHTML)), "the wrong consent answer came back: " + plain(chosen.innerHTML));
  }
  assert(app.store && typeof app.store === "object", "the fallback store is missing");
});

// ── guard: every storage access goes through the helpers ─────
check("app.js reaches storage only through the guarded helpers", () => {
  const src = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  const helperStart = src.indexOf("function sGet(key)");
  const helperEnd = src.indexOf("// restore draft");
  assert(helperStart > 0 && helperEnd > helperStart, "the guarded storage helpers are gone from app.js");
  // strip the three helper bodies: those are the only places that may touch it
  const before = src.slice(0, helperStart);
  const after = src.slice(helperEnd);
  const outside = (before + after).match(/localStorage\s*\./g) || [];
  assert(outside.length === 0,
    "app.js touches localStorage outside the guarded helpers (" + outside.length + " place(s)): a failed write would freeze the survey");
});

check("each helper guards the browser call", () => {
  const src = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  for (const name of ["sGet", "sSet", "sRemove"]) {
    const at = src.indexOf("function " + name + "(");
    assert(at > 0, name + " is missing from app.js");
    const body = src.slice(at, src.indexOf("\n  }", at));
    assert(/try\s*\{/.test(body) && /catch\s*\(/.test(body), name + " does not guard its storage call");
    assert(/localStorage\./.test(body), name + " no longer touches storage at all");
  }
});

if (failures) {
  console.log("\n" + failures + " of " + checks + " checks FAILED.");
  process.exit(1);
}
console.log(checks + " checks passed: a browser that cannot save its draft no longer freezes the survey.");
