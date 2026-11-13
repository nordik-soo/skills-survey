#!/usr/bin/env node
/**
 * Read-aloud speaks the language on screen — question, options and dropdown lists.
 *
 * The translation pass covered the question text, the option labels and the
 * question's own 🔊 button, but the option speakers were built with a hardcoded
 * English language code, and the helper behind the two dropdown lists did the
 * same behind the comment "Every label is English now". The clip lookup is
 * manifest[language][ref], so the labels read correctly while the ear got
 * English: the ref ("o/<English option>") exists in every bucket by design, so
 * asking for the English bucket quietly found the English recording. Nothing
 * errored and nothing fell back — the page simply spoke the wrong language.
 *
 * The clips are keyed by the ENGLISH option string on purpose, so a correct
 * button is one that asks for /audio/<language on screen>/..., and asking for
 * /audio/en/... is exactly the bug. This file drives the real browser the layout
 * tests use, replaces the audio element with a recorder before clicking, and
 * checks every source against the language showing on the page. Where a language
 * has no clip for an option, the device voice must at least read the translated
 * label in that language, never the English one.
 *
 * Run: node tests/test_option_audio_language.js
 */
"use strict";
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const { findBrowser, serve, launch } = require("./helpers/browser.js");

const ROOT = path.join(__dirname, "..");
const DRAFT_KEY = "sault_survey_draft_v1";
const LANG_KEY = "sault_lang_v1";
const CARDS_QUESTION = "employment_status"; // option cards, one speaker per option
const DROPDOWN_QUESTION = "age_group"; // select list, speakers inside the menu
const SAMPLE_REF = "o/Alberta"; // an option every language has a clip for

let failures = 0;
let checks = 0;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function eq(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ── the project's own data ─────────────────────────────────────────────────
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const ctx = { window: {}, console };
ctx.global = ctx;
vm.createContext(ctx);
vm.runInContext(read("translations.js"), ctx, { filename: "translations.js" });
vm.runInContext(read("survey-data.js"), ctx, { filename: "survey-data.js" });
const I18N = ctx.window.I18N;
const SURVEY = ctx.window.SURVEY;
const LANGS = (I18N && I18N.LANGS) || [];
const MANIFEST = JSON.parse(read(path.join("audio", "manifest.json")));

const enLabels = {};
function englishLabels(q) {
  if (!enLabels[q.id]) {
    const opts = typeof q.options === "function" ? q.options({}) : q.options;
    enLabels[q.id] = opts.slice();
  }
  return enLabels[q.id];
}

const question = (id) => SURVEY.QUESTIONS.find((q) => q.id === id) || null;

// Some languages report a voice under a second tag (Tagalog shows up as "fil").
const VOICE_BASE = { tl: ["tl", "fil"] };
const baseOf = (tag) => String(tag || "").toLowerCase().replace("_", "-").split("-")[0];

// ── in-page helpers ────────────────────────────────────────────────────────
// Clicking a speaker builds an Audio element from the chosen clip. Recording the
// source it was built from says which language the page decided to speak, which
// is the whole question here. The device-voice path is recorded too, so a missing
// clip cannot hide an English reading behind a fallback.
const RECORDER = `(() => {
  window.__spoken = [];
  window.__spokenWeb = [];
  window.Audio = function (src) {
    window.__spoken.push(String(src));
    this.src = String(src);
    this.play = () => Promise.resolve();
    this.pause = () => {};
    this.onended = null;
    this.onerror = null;
  };
  if (window.speechSynthesis) {
    window.speechSynthesis.speak = function (u) { window.__spokenWeb.push({ text: u.text, lang: u.lang }); };
    window.speechSynthesis.cancel = function () {};
  }
  return true;
})()`;

const CLICK_QUESTION = `(() => {
  const b = document.querySelector(".q-speak");
  if (!b) return null;
  window.__spoken.length = 0;
  window.__spokenWeb.length = 0;
  b.click();
  return { text: (document.querySelector(".q-title") || {}).textContent || "", src: window.__spoken.slice(), web: window.__spokenWeb.slice() };
})()`;

// One entry per option that carries a speaker, with the label the respondent
// sees, so a device-voice fallback can be checked against the translated text.
const CLICK_CARDS = `(() => {
  const out = [];
  document.querySelectorAll(".q-scroll .opt").forEach((opt) => {
    const btn = opt.querySelector(".opt-speak");
    const label = opt.querySelector(".opt-label");
    const text = label ? label.textContent.trim() : "";
    if (!btn) { out.push({ text, src: [], web: [], noButton: true }); return; }
    window.__spoken.length = 0;
    window.__spokenWeb.length = 0;
    btn.click();
    out.push({ text, src: window.__spoken.slice(), web: window.__spokenWeb.slice() });
  });
  return out;
})()`;

const CLICK_DROPDOWN = `(() => {
  const trigger = document.querySelector(".custom-select-trigger");
  if (trigger) trigger.click();
  const out = [];
  document.querySelectorAll(".custom-select-menu .custom-select-option").forEach((item) => {
    const label = item.querySelector(".cso-label");
    const btn = item.querySelector(".cso-speak");
    const text = label ? label.textContent.trim() : "";
    if (!btn) { out.push({ text, src: [], web: [], noButton: true }); return; }
    window.__spoken.length = 0;
    window.__spokenWeb.length = 0;
    btn.click();
    out.push({ text, src: window.__spoken.slice(), web: window.__spokenWeb.slice() });
  });
  return { entries: out, selected: document.querySelectorAll(".custom-select-option.on").length };
})()`;

const uniq = (list) => list.filter((v, i) => list.indexOf(v) === i);

// ── the one checker ────────────────────────────────────────────────────────
/**
 * Every source a speaker asked for must belong to the language on screen, must
 * exist on disk, and must match the manifest entry for that language. A device
 * voice fallback must read the label the respondent sees, in that language.
 * Nothing may ask the English bucket unless English is what is on screen.
 */
function checkSpoken(entry, lang, where) {
  const srcs = entry.src || [];
  const webs = entry.web || [];
  assert(srcs.length + webs.length > 0, `${where} [${lang}]: clicking the speaker played nothing`);

  for (const src of srcs) {
    const m = String(src).match(/^\/audio\/([^/]+)\//);
    assert(m, `${where} [${lang}]: an unexpected audio source: ${src}`);
    eq(m[1], lang, `${where} [${lang}]: the page shows ${lang} but asked for the ${m[1]} recording (${src})`);
    assert(fs.existsSync(path.join(ROOT, src)), `${where} [${lang}]: the clip it asked for is not in the project: ${src}`);
  }

  for (const w of webs) {
    const allowed = VOICE_BASE[lang] || [lang];
    assert(
      allowed.indexOf(baseOf(w.lang)) !== -1,
      `${where} [${lang}]: no clip, so the device voice read it as "${w.lang}" instead of ${allowed.join("/")} ("${w.text}")`
    );
    if (lang !== "en") {
      assert(
        String(w.text).trim() === String(entry.text).trim(),
        `${where} [${lang}]: the device voice read "${w.text}" while the label on screen says "${entry.text}"`
      );
    }
  }
}

async function waitForManifest(page) {
  const ok = await page.evaluate(`new Promise((resolve) => {
    const t0 = Date.now();
    (function poll() {
      const hit = performance.getEntriesByType("resource").some((e) => e.name.indexOf("/audio/manifest.json") !== -1);
      if (hit) return resolve(true);
      if (Date.now() - t0 > 8000) return resolve(false);
      setTimeout(poll, 50);
    })();
  })`);
  assert(ok, "the page never loaded /audio/manifest.json, so every speaker fell back to the device voice");
}

let navSeq = 0;

/** Land on a question with a fresh draft, then start recording. */
async function openQuestion(page, origin, id) {
  navSeq += 1;
  await page.goto(`${origin}/index.html?audio=${navSeq}#/`, 1280, 900);
  await page.evaluate(
    "localStorage.clear();" +
      `localStorage.setItem(${JSON.stringify(DRAFT_KEY)}, JSON.stringify({` +
      `answers:{consent:"Yes, I confirm",eligible:"Yes"},currentId:${JSON.stringify(id)}}));`
  );
  await page.reload();
  await page.setHash("#/survey");
  await page.evaluate("new Promise((r) => setTimeout(r, 400))");
  await waitForManifest(page);
  await page.evaluate(RECORDER);
}

/** Pick a language in the header, the way a respondent does, without a reload. */
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

function hashOf(file) {
  return crypto.createHash("sha1").update(fs.readFileSync(path.join(ROOT, file))).digest("hex");
}

async function run() {
  const exe = findBrowser();
  if (!exe) {
    console.log("  skip  no Chrome or Edge found to click the speakers with (set CHROME_BIN to point at one)");
    return;
  }

  const site = await serve(ROOT);
  let browser = null;
  try {
    browser = await launch(exe);
    const { page } = browser;

    const runAsync = async (name, fn) => {
      checks += 1;
      try {
        await fn();
        console.log("  ok  " + name);
      } catch (err) {
        failures += 1;
        console.log("  x   " + name + ": " + err.message);
      }
    };

    // The premise: each language has its own recording of the same option, so
    // hearing English is a real, detectable difference and not a coincidence.
    const fixtureCheck = async () => {
      const en = MANIFEST.en && MANIFEST.en[SAMPLE_REF];
      assert(en, "no English clip for " + SAMPLE_REF + " in the manifest");
      const enHash = hashOf(en);
      for (const lang of LANGS.filter((l) => l !== "en")) {
        const rel = MANIFEST[lang] && MANIFEST[lang][SAMPLE_REF];
        assert(rel, `${lang}: no clip for ${SAMPLE_REF}`);
        assert(rel !== en, `${lang}: ${SAMPLE_REF} points at the English file`);
        assert(fs.existsSync(path.join(ROOT, rel)), `${lang}: ${rel} is missing`);
        assert(hashOf(rel) !== enHash, `${lang}: ${rel} is byte-for-byte the English recording`);
      }
    };

    await runAsync("each language has its own recording of the same option", fixtureCheck);

    await runAsync("the question's own speaker reads the language on screen", async () => {
      await openQuestion(page, site.origin, CARDS_QUESTION);
      for (const lang of LANGS) {
        await switchLanguage(page, lang);
        const got = await page.evaluate(CLICK_QUESTION);
        assert(got, `[${lang}]: the question has no speaker button`);
        checkSpoken(got, lang, "question");
        assert(/^\/audio\//.test(String(got.src[0] || "")), `[${lang}]: the question was not read from a pre-generated clip`);
      }
    });

    await runAsync("every option card reads the language on screen", async () => {
      await openQuestion(page, site.origin, CARDS_QUESTION);
      const q = question(CARDS_QUESTION);
      const english = englishLabels(q);
      for (const lang of LANGS) {
        await switchLanguage(page, lang);
        const entries = await page.evaluate(CLICK_CARDS);
        assert(Array.isArray(entries) && entries.length > 1, `[${lang}]: no option cards on screen (${entries && entries.length})`);
        eq(entries.length, english.length, `[${lang}]: the cards on screen do not line up with the question's options`);
        let translated = 0;
        entries.forEach((entry, i) => {
          const where = `option ${i + 1}`;
          const ref = "o/" + english[i];
          const clip = MANIFEST[lang] && MANIFEST[lang][ref];
          // an option with no clip and no voice offers no button: allowed only
          // when the clip really is absent, never as a way to skip an option
          if (entry.noButton) {
            assert(!clip, `[${lang}] ${where}: the clip exists but the speaker is missing`);
            return;
          }
          checkSpoken(entry, lang, where);
          if (clip) eq(entry.src[0], "/" + clip, `[${lang}] ${where}: asked for a different recording than this option's ${lang} clip`);
          if (lang !== "en" && english[i] && entry.text !== english[i]) translated += 1;
        });
        if (lang !== "en") {
          assert(translated >= 5, `[${lang}]: only ${translated} option labels were translated, so this is not the language it claims`);
        }
      }
    });

    await runAsync("the dropdown list's speakers read the language on screen", async () => {
      await openQuestion(page, site.origin, DROPDOWN_QUESTION);
      const opts = (() => {
        const q = question(DROPDOWN_QUESTION);
        return typeof q.options === "function" ? q.options({}) : q.options;
      })();
      for (const lang of LANGS) {
        await switchLanguage(page, lang);
        const got = await page.evaluate(CLICK_DROPDOWN);
        assert(got && got.entries.length > 1, `[${lang}]: no options in the list`);
        eq(got.selected, 0, `[${lang}]: reading an option aloud also selected it`);
        got.entries.forEach((entry, i) => {
          const where = `list option ${i + 1}`;
          const ref = "o/" + opts[i];
          const clip = MANIFEST[lang] && MANIFEST[lang][ref];
          if (entry.noButton) {
            assert(!clip, `[${lang}] ${where}: the list shows no speaker for an option that has a clip`);
            return;
          }
          checkSpoken(entry, lang, where);
          if (clip) eq(entry.src[0], "/" + clip, `[${lang}] ${where}: the list asked for a different recording than this option's ${lang} clip`);
        });
      }
    });

    await runAsync("a language restored from storage reads that language", async () => {
      await page.evaluate(
        "localStorage.clear();" +
          `localStorage.setItem(${JSON.stringify(DRAFT_KEY)}, JSON.stringify({` +
          `answers:{consent:"Yes, I confirm",eligible:"Yes"},currentId:${JSON.stringify(CARDS_QUESTION)}}));` +
          `localStorage.setItem(${JSON.stringify(LANG_KEY)}, "ar");`
      );
      await page.reload();
      await page.setHash("#/survey");
      await page.evaluate("new Promise((r) => setTimeout(r, 400))");
      await waitForManifest(page);
      await page.evaluate(RECORDER);
      eq(await page.evaluate("document.documentElement.getAttribute('lang')"), "ar", "the stored language was not restored");
      eq(await page.evaluate("document.documentElement.getAttribute('dir')"), "rtl", "Arabic did not come back right-to-left");
      const entries = await page.evaluate(CLICK_CARDS);
      entries.filter((e) => !e.noButton).forEach((entry, i) => checkSpoken(entry, "ar", `restored Arabic option ${i + 1}`));
    });

    // Break-it: the bug was one bucket name hardcoded at three call sites, so a
    // partly fixed page would still slip English through one of them. Gather
    // every source the whole run asked for and fail if any is the English one
    // while another language was on screen.
    await runAsync("no speaker anywhere asks for the English bucket while another language is up", async () => {
      const seen = [];
      await openQuestion(page, site.origin, CARDS_QUESTION);
      for (const lang of LANGS) {
        await switchLanguage(page, lang);
        const q = await page.evaluate(CLICK_QUESTION);
        (q.src || []).forEach((s) => seen.push({ lang, src: s }));
        const cards = await page.evaluate(CLICK_CARDS);
        cards.forEach((e) => (e.src || []).forEach((s) => seen.push({ lang, src: s })));
      }
      await openQuestion(page, site.origin, DROPDOWN_QUESTION);
      for (const lang of LANGS) {
        await switchLanguage(page, lang);
        const list = await page.evaluate(CLICK_DROPDOWN);
        (list.entries || []).forEach((e) => (e.src || []).forEach((s) => seen.push({ lang, src: s })));
      }
      const leaks = seen.filter((r) => r.lang !== "en" && /^\/audio\/en\//.test(r.src));
      eq(leaks.length, 0, "English clips were played while another language was on screen: " + JSON.stringify(uniq(leaks.map((r) => r.lang + " -> " + r.src))));
      assert(seen.filter((r) => r.lang === "en").length > 0, "the English page asked for no clip at all, so this proves nothing");
      assert(seen.filter((r) => /^\/audio\/(?!en\/)/.test(r.src)).length > 20, "only a handful of clips were exercised, so this proves little");
    });

    eq(await page.evaluate("1"), 1, "the browser stopped responding");
  } finally {
    if (browser) await browser.close();
    await site.close();
  }
}

// ── report ─────────────────────────────────────────────────────────────────
run()
  .then(() => {
    if (failures) {
      console.error(`\n${failures} of ${checks} checks FAILED.\n`);
      process.exit(1);
    }
    if (!checks) {
      console.log("1 check skipped: read-aloud was not exercised (no browser).");
      return;
    }
    console.log(`${checks} checks passed: every speaker reads the language on screen.`);
  })
  .catch((err) => {
    console.error("\n" + (err && err.stack ? err.stack : err) + "\n");
    process.exit(1);
  });
