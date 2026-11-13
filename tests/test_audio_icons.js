#!/usr/bin/env node
/**
 * Every question, option and skill row keeps its 🔊 button on a device that has
 * no voice for the language on screen.
 *
 * A speaker is only rendered when a pre-generated clip exists, or the device
 * carries a voice for that language (app.js ttsAvailable). Arabic clips were
 * missing for "Canadian citizen", "Permanent resident" and "Prefer not to answer"
 * (plus two other employment options), and the skill rows passed no clip ref at
 * all, so on an Arabic phone without an Arabic voice those speakers simply were
 * not there: 9 of 13 option cards had one, 4 did not.
 *
 * This drives the real browser with the voice list replaced by a single English
 * voice — the failing device — and counts the speakers on screen against the
 * question's own options. Every entry must have one.
 *
 * Run: node tests/test_audio_icons.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const { findBrowser, serve, launch } = require("./helpers/browser.js");

const ROOT = path.join(__dirname, "..");
const DRAFT_KEY = "sault_survey_draft_v1";
const LANG_KEY = "sault_lang_v1";

let failures = 0;
let checks = 0;
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const eq = (actual, expected, msg) => {
  if (actual !== expected) throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const ctx = { window: {}, console };
ctx.global = ctx;
require("vm").createContext(ctx);
require("vm").runInContext(read("translations.js"), ctx, { filename: "translations.js" });
require("vm").runInContext(read("survey-data.js"), ctx, { filename: "survey-data.js" });
const SURVEY = ctx.window.SURVEY;
const MANIFEST = JSON.parse(read(path.join("audio", "manifest.json")));
const question = (id) => SURVEY.QUESTIONS.find((q) => q.id === id) || null;
const optionsOf = (id) => {
  const q = question(id);
  const o = q && (typeof q.options === "function" ? q.options({}) : q.options);
  return o || [];
};

// A device with one English voice and nothing for Arabic: the failing phone.
const ENGLISH_ONLY_VOICES = `(() => {
  const fake = [{ name: "Test English", lang: "en-US", default: true, localService: true, voiceURI: "test-en" }];
  window.speechSynthesis.getVoices = () => fake;
  window.speechSynthesis.speak = () => {};
  window.speechSynthesis.cancel = () => {};
  window.speechSynthesis.addEventListener = window.speechSynthesis.addEventListener || function () {};
  try { window.speechSynthesis.dispatchEvent(new Event("voiceschanged")); } catch (e) {}
  return window.speechSynthesis.getVoices().map((v) => v.lang);
})()`;

// Count the speakers that sit beside an entry, and the entries without one.
const CARDS = `(() => {
  const rows = Array.prototype.slice.call(document.querySelectorAll(".q-scroll .opt"));
  return {
    total: rows.length,
    withBtn: rows.filter((r) => r.querySelector(".opt-speak")).length,
    missing: rows.filter((r) => !r.querySelector(".opt-speak")).map((r) => ((r.querySelector(".opt-label") || {}).textContent || "").trim()),
  };
})()`;

const SKILLS = `(() => {
  const rows = Array.prototype.slice.call(document.querySelectorAll(".grid-rate .rate-row"));
  return {
    total: rows.length,
    withBtn: rows.filter((r) => r.querySelector(".opt-speak")).length,
    missing: rows.filter((r) => !r.querySelector(".opt-speak")).map((r) => ((r.querySelector(".rate-name") || {}).textContent || "").slice(0, 30)),
  };
})()`;

const LIST = `(() => {
  const trigger = document.querySelector(".custom-select-trigger");
  if (trigger) trigger.click();
  const rows = Array.prototype.slice.call(document.querySelectorAll(".custom-select-menu .custom-select-option"));
  return {
    total: rows.length,
    withBtn: rows.filter((r) => r.querySelector(".cso-speak")).length,
    missing: rows.filter((r) => !r.querySelector(".cso-speak")).map((r) => ((r.querySelector(".cso-label") || {}).textContent || "").slice(0, 30)),
  };
})()`;

/** Land on a question with a fresh draft, then make the device English-only. */
async function open(page, origin, answers, id, seq) {
  await page.goto(`${origin}/index.html?voices=${seq}#/`, 1280, 900);
  await page.evaluate(
    "localStorage.clear();" +
      `localStorage.setItem(${JSON.stringify(DRAFT_KEY)}, JSON.stringify({answers:${JSON.stringify(answers)},currentId:${JSON.stringify(id)}}));`
  );
  await page.reload();
  await page.setHash("#/survey");
  await page.evaluate("new Promise((r) => setTimeout(r, 400))");
  await page.evaluate(ENGLISH_ONLY_VOICES);
}

async function switchLanguage(page, code) {
  const res = await page.evaluate(`(() => {
    const btn = document.querySelector("#lang-btn");
    if (!btn) return "no language button in the header";
    btn.click();
    const item = Array.prototype.slice.call(document.querySelectorAll(".lang-menu .lang-item"))
      .filter((n) => n.getAttribute("lang") === ${JSON.stringify(code)})[0];
    if (!item) return "no " + ${JSON.stringify(code)} + " in the language list";
    item.click();
    const shown = document.documentElement.getAttribute("lang");
    return shown === ${JSON.stringify(code)} ? "" : "the page still says lang=" + shown;
  })()`);
  eq(res, "", "switching the page to " + code);
  await page.evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))");
}

const checkRows = (got, expected, where) => {
  assert(got.total > 0, `${where}: nothing rendered, so this proves nothing`);
  eq(got.total, expected, `${where}: the rows on screen do not match the question's options`);
  eq(
    got.withBtn,
    expected,
    `${where}: ${expected - got.withBtn} of ${expected} entries have no speaker on a device without that voice: ` + got.missing.join(" | ")
  );
};

async function run() {
  const exe = findBrowser();
  if (!exe) {
    console.log("  skip  no Chrome or Edge found (set CHROME_BIN to point at one)");
    return;
  }
  const site = await serve(ROOT);
  let browser = null;
  let seq = 0;
  try {
    browser = await launch(exe);
    const { page } = browser;
    const runCheck = async (name, fn) => {
      checks += 1;
      try {
        await fn();
        console.log("  ok  " + name);
      } catch (err) {
        failures += 1;
        console.log("  x   " + name + ": " + err.message);
      }
    };

    const base = { consent: "Yes, I confirm", eligible: "Yes" };

    // The premise: the page really is running on a device with no Arabic voice,
    // and the clip it needs is present in the manifest but not on the device.
    await runCheck("the browser is set up as a device without an Arabic voice", async () => {
      seq += 1;
      await open(page, site.origin, base, "employment_status", seq);
      const voices = await page.evaluate("window.speechSynthesis.getVoices().map((v) => v.lang)");
      eq(JSON.stringify(voices), JSON.stringify(["en-US"]), "the fake voice list did not take effect");
      const ar = MANIFEST.ar || {};
      assert(Object.keys(ar).length > 300, `Arabic has only ${Object.keys(ar).length} clips`);
    });

    // The reported bug: four of these thirteen cards had no speaker in Arabic.
    await runCheck("every Arabic option card has a speaker", async () => {
      seq += 1;
      await open(page, site.origin, base, "employment_status", seq);
      await switchLanguage(page, "ar");
      checkRows(await page.evaluate(CARDS), optionsOf("employment_status").length, "Arabic option cards");
    });

    await runCheck("every Arabic option card has a speaker on the status-in-Canada question", async () => {
      seq += 1;
      await open(page, site.origin, { ...base, identity_groups: ["Immigrant (permanent resident)"] }, "immigration_category", seq);
      await switchLanguage(page, "ar");
      checkRows(await page.evaluate(CARDS), optionsOf("immigration_category").length, "Arabic status options");
    });

    await runCheck("every Arabic skill row has a speaker", async () => {
      seq += 1;
      await open(
        page,
        site.origin,
        {
          ...base,
          employment_status: "Employed full time permanent (30+ hours/week)",
          intended_job: "No",
          intended_job_title: "9421101 - Test Job",
        },
        "skills",
        seq
      );
      await switchLanguage(page, "ar");
      const got = await page.evaluate(SKILLS);
      assert(got.total > 0, "no skill rows rendered, so this proves nothing");
      eq(got.withBtn, got.total, `${got.total - got.withBtn} skill rows have no speaker: ` + got.missing.join(" | "));
    });

    await runCheck("every row of the Arabic country list has a speaker", async () => {
      seq += 1;
      await open(page, site.origin, { ...base, moved_from: "Outside of Canada" }, "country_moved_from", seq);
      await switchLanguage(page, "ar");
      const got = await page.evaluate(LIST);
      assert(got.total > 10, `the country list rendered only ${got.total} rows`);
      eq(got.withBtn, got.total, `${got.total - got.withBtn} country rows have no speaker: ` + got.missing.join(" | "));
    });

    // Same device, English on screen: the count must not regress the other way.
    await runCheck("every English option card still has a speaker", async () => {
      seq += 1;
      await open(page, site.origin, base, "employment_status", seq);
      checkRows(await page.evaluate(CARDS), optionsOf("employment_status").length, "English option cards");
    });

    eq(await page.evaluate("1"), 1, "the browser stopped responding");
  } finally {
    if (browser) await browser.close();
    await site.close();
  }
}

run()
  .then(() => {
    if (failures) {
      console.error(`\n${failures} of ${checks} checks FAILED.\n`);
      process.exit(1);
    }
    if (!checks) return;
    console.log(`${checks} checks passed: no entry loses its speaker on a device without that voice.`);
  })
  .catch((err) => {
    console.error("\n" + (err && err.stack ? err.stack : err) + "\n");
    process.exit(1);
  });
