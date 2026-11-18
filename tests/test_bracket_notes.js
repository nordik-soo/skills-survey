#!/usr/bin/env node
/**
 * Respondent-facing prompts must not carry editorial notes.
 *
 * The reviewed documents annotate some questions with a routing note in square
 * brackets ahead of the prompt, meant for whoever files the question. Those
 * notes are not text for the respondent: nothing bracketed may reach the screen.
 *
 * A markdown link is NOT a note. The consent screen shows two of them,
 * "[survey information letter](https://...)", and their labels must survive.
 * Only a bracketed run with no "(" after it counts as a note.
 *
 * The survey is English only (v15), so this checks the shipped English data, the
 * rendered screens and the two consent links.
 *
 * Run: node tests/test_bracket_notes.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");

let failures = 0;
let checks = 0;

function check(name, fn) {
  checks++;
  try {
    fn();
    console.log("  ok  " + name);
  } catch (err) {
    failures++;
    console.log("  x   " + name + ": " + err.message);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// ── fixtures ───────────────────────────────────────────────────────────────
const ctx = { window: {}, console };
ctx.global = ctx;
vm.createContext(ctx);
for (const f of ["survey-data.js"]) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx, { filename: f });
}
const QUESTIONS = ctx.window.SURVEY.QUESTIONS;
const { mount } = require("./helpers/app-dom.js");

const englishOf = (q) => (typeof q.text === "function" ? q.text({}) : q.text);

const BARE_NOTE = /\[[^\[\]]*\](?!\()/; // a bracket run that is not a link label
const LINK = /\[[^\[\]]*\]\([^)]*\)/g;

// ── the invariant every test below ends with ───────────────────────────────
// Whatever a test just exercised, the survey as a whole must still be free of
// notes and still show its consent links.
function assertSurveySane() {
  for (const q of QUESTIONS) {
    const out = englishOf(q);
    assert(typeof out === "string", `${q.id} did not render a string`);
    assert(!BARE_NOTE.test(out.replace(LINK, "")), `${q.id} shows a note: ${out.slice(0, 60)}`);
  }
  const consent = englishOf(QUESTIONS.find((x) => x.id === "consent"));
  assert((consent.match(LINK) || []).length === 2, "consent lost a document link");
}

// ── the shipped text ───────────────────────────────────────────────────────
check("no question in the shipped survey carries a bracketed note", () => {
  let prompts = 0;
  for (const q of QUESTIONS) {
    const out = englishOf(q).replace(LINK, "");
    assert(!BARE_NOTE.test(out), `${q.id}: ${out.slice(0, 70)}`);
    prompts++;
  }
  assert(prompts > 70, "only " + prompts + " prompts were checked");
  assertSurveySane();
});

check("the consent screen keeps both document links", () => {
  const out = englishOf(QUESTIONS.find((q) => q.id === "consent"));
  const links = out.match(LINK) || [];
  assert(links.length === 2, "consent has " + links.length + " links");
  assert(/\]\(/.test(out), "consent link label missing");
  assertSurveySane();
});

check("no option label carries a bracketed note", () => {
  let labels = 0;
  for (const q of QUESTIONS) {
    for (const opt of q.options || []) {
      const label = typeof opt === "string" ? opt : opt.label || opt.value || "";
      assert(!BARE_NOTE.test(label.replace(LINK, "")), `${q.id} option "${label}" shows a note`);
      labels++;
    }
  }
  assert(labels > 100, "only " + labels + " option labels were checked");
  assertSurveySane();
});

check("every prompt renders non-blank, and the brackets reach no screen", () => {
  const app = mount({});
  app.openSurvey();
  const allText = (n, out = []) => {
    if (n.tagName === "#TEXT" && n._text) out.push(n._text);
    for (const c of n.children) allText(c, out);
    return out;
  };
  let screens = 0;
  for (let i = 0; i < 40; i++) {
    const root = app.root();
    const shown = allText(root).join(" ").replace(/\s+/g, " ");
    assert(shown.replace(LINK, "").trim() !== "", "screen " + i + " rendered no text");
    // the consent screen legitimately shows two bracketed link labels
    if (i > 0) assert(!BARE_NOTE.test(shown), "screen " + i + " shows a note: " + shown.slice(0, 80));
    const rows = root.querySelectorAll(".rate-row");
    if (rows.length) {
      for (const row of rows) {
        const d = row.querySelectorAll(".rate-dot")[2];
        if (d) d.onclick();
      }
    } else {
      const opts = root.querySelectorAll(".opt");
      const trigger = root.querySelector(".custom-select-trigger");
      if (opts.length) opts[0].onclick();
      else if (trigger) {
        trigger.onclick();
        const items = root.querySelectorAll(".custom-select-option");
        if (items.length) items[0].onclick();
      } else {
        for (const inp of root.querySelectorAll("input")) {
          inp.value = /mail/i.test(inp.placeholder || "") ? "a@b.co" : "probe";
          if (inp.oninput) inp.oninput({ target: inp });
        }
      }
    }
    const next = root.querySelector("#btn-next");
    if (!next) break;
    if (next.disabled) next.disabled = false;
    next.onclick();
    screens++;
  }
  assert(screens > 15, "only " + screens + " screens were reached");
  assertSurveySane();
});

// ── report ─────────────────────────────────────────────────────────────────
if (failures) {
  console.error(`\n${failures} of ${checks} checks FAILED.\n`);
  process.exit(1);
}
console.log(`${checks} checks passed: no screen shows a bracketed editorial note, and the consent links survive.`);
