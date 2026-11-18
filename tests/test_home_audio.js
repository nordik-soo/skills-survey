#!/usr/bin/env node
/**
 * The homepage can be listened to, in the language on screen, in BOTH arms of the
 * headline experiment.
 *
 * The hero was the only place on the site without read-aloud: the title and the
 * three introduction cards had no 🔊 and no clips, while every question and option
 * did. Adding them is not just markup — the homepage is the one part of the site
 * whose copy is not fixed:
 *
 *   • The cards are re-rendered on every language switch (renderHomeBody rebuilds
 *     #home-body), and the title is rewritten with textContent on the same switch,
 *     so a speaker written into index.html disappears the moment a respondent picks
 *     a language. The buttons are therefore built in JS, and this file checks they
 *     are still there and still wired after a real menu switch.
 *   • The copy is A/B split. Card 1 is worded differently by HP1 and HP2, so it has
 *     one recording per arm; cards 2 and 3 are identical in both arms and share one
 *     recording each. A single card-1 ref would read half the visitors the copy of
 *     the arm they are not looking at, which is exactly the stale-wording bug this
 *     project has already had once with question clips.
 *
 * audio/home_texts.json records the exact string each home clip was generated from.
 * This file re-derives what the page displays — from the same data the app reads —
 * and fails when they disagree, when a clip is missing, or when a speaker asks for
 * a recording in a language other than the one on screen.
 *
 * Run: node tests/test_home_audio.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const { findBrowser, serve, launch } = require("./helpers/browser.js");

const ROOT = path.join(__dirname, "..");
const LANG_KEY = "sault_lang_v1";
const TITLE_EN = "Sault Newcomer Survey 2026";
const ARMS = ["HP1", "HP2"];
// Card 1 is per arm, cards 2 and 3 are shared: the five refs the hero can ask for.
const HOME_REFS = ["h/title", "h/hp1", "h/hp2", "h/card2", "h/card3"];

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
const dict = (code) => (I18N.dicts && I18N.dicts[code]) || null;
const VARIANTS = SURVEY.HOME_VARIANTS || {};
const MANIFEST = JSON.parse(read(path.join("audio", "manifest.json")));
const TEXTS = JSON.parse(read(path.join("audio", "home_texts.json")));

/**
 * The hero exactly as app.js renders it: applyStaticText() for the title and
 * renderHomeBody() for the cards, including the fallback to English when a
 * language has no homepage copy of its own.
 */
function displayedFor(code) {
  const d = dict(code);
  const h = (d && d.home) || {};
  const title = h.h1 || TITLE_EN;
  const out = { "h/title": title };
  for (const arm of ARMS) {
    const paras = h[arm.toLowerCase()] || VARIANTS[arm].body;
    out["h/" + arm.toLowerCase()] = paras[0];
    out["h/card2"] = paras[1];
    out["h/card3"] = paras[2];
  }
  return out;
}

const refOf = (lang, src) => {
  const bucket = (MANIFEST[lang] || {});
  const hit = Object.keys(bucket).find((r) => bucket[r] === src);
  return hit || null;
};

// ── data checks ────────────────────────────────────────────────────────────
const run = (name, fn) => {
  checks += 1;
  try {
    fn();
    console.log("  ok  " + name);
  } catch (err) {
    failures += 1;
    console.log("  x   " + name + ": " + err.message);
  }
};

run("the homepage ships every language it advertises", () => {
  assert(LANGS.length >= 2, `translations.js advertises ${LANGS.length} language(s)`);
});

run("the baseline covers exactly the five refs the hero can ask for", () => {
  eq(Object.keys(TEXTS).sort().join(","), LANGS.slice().sort().join(","), "audio/home_texts.json languages");
  const problems = [];
  for (const code of LANGS) {
    const have = Object.keys(TEXTS[code] || {}).sort().join(",");
    if (have !== HOME_REFS.slice().sort().join(",")) problems.push(`${code}: ${have}`);
  }
  eq(problems.length, 0, "a language records a different set of refs than h/title, h/hp1, h/hp2, h/card2, h/card3: " + problems.join(" | "));
});

run("every home block has a recording in every language", () => {
  const missing = [];
  for (const code of LANGS) {
    for (const ref of HOME_REFS) if (!(MANIFEST[code] || {})[ref]) missing.push(`${code} ${ref}`);
  }
  eq(missing.length, 0, "no clip, so no speaker button on a device without a voice: " + missing.join(", "));
});

run("every home clip is a real file", () => {
  const bad = [];
  for (const code of LANGS) {
    for (const ref of HOME_REFS) {
      const rel = (MANIFEST[code] || {})[ref];
      if (!rel) continue;
      const abs = path.join(ROOT, rel);
      if (!fs.existsSync(abs)) bad.push(rel);
      else if (fs.statSync(abs).size < 200) bad.push(rel + " (tiny)");
    }
  }
  eq(bad.length, 0, "the manifest points at missing or empty home clips: " + bad.slice(0, 6).join(", "));
});

// The stale-audio alarm, for both arms: whatever the hero shows today must be what
// was spoken into the clip, or the speaker reads the previous wording.
run("every home recording says the words its arm shows", () => {
  const drift = [];
  for (const code of LANGS) {
    const shown = displayedFor(code);
    for (const ref of HOME_REFS) {
      const spoken = (TEXTS[code] || {})[ref];
      if (spoken == null) {
        drift.push(`${code} ${ref} (no recorded baseline)`);
        continue;
      }
      if (spoken !== shown[ref]) {
        drift.push(
          `${code} ${ref}: clip says ${JSON.stringify(spoken.slice(0, 40))} but the page shows ${JSON.stringify(String(shown[ref]).slice(0, 40))}`
        );
      }
    }
  }
  eq(drift.length, 0, "regenerate with `node _audio_home_jobs.js _home.json` then `python _audio_gen.py _home.json audio all`: " + drift.slice(0, 4).join(" | "));
});

// The experiment itself: if both arms recorded the same card 1, one arm would be
// listening to copy it never showed.
run("the two arms have their own card-1 recording", () => {
  const same = [];
  for (const code of LANGS) {
    const shown = displayedFor(code);
    if (shown["h/hp1"] === shown["h/hp2"]) same.push(`${code} (both arms word card 1 identically)`);
    const a = (MANIFEST[code] || {})["h/hp1"];
    const b = (MANIFEST[code] || {})["h/hp2"];
    if (a && b && a === b) same.push(`${code} (both arms point at ${a})`);
  }
  eq(same.length, 0, "the arms must not share card 1: " + same.join(", "));
});

run("the shared cards really are shared", () => {
  const split = [];
  for (const code of LANGS) {
    for (const ref of ["h/card2", "h/card3"]) {
      const one = (MANIFEST[code] || {})[ref];
      const two = (MANIFEST[code] || {})[ref];
      if (one !== two) split.push(`${code} ${ref}`);
    }
  }
  eq(split.length, 0, split.join(", "));
});

run("each language has its own homepage recording, not the English one", () => {
  const problems = [];
  for (const code of LANGS.filter((c) => c !== "en")) {
    const d = dict(code);
    const h = (d && d.home) || {};
    if (!h.h1) {
      problems.push(`${code}: no translated title in translations.js, so the title would be read in English`);
      continue;
    }
    // Italian and Tagalog are ASCII too, so the test is that the words differ, not
    // that the script does.
    if (String(h.h1) === TITLE_EN) problems.push(`${code}: the title is the English title`);
    for (const ref of HOME_REFS) {
      const mine = (MANIFEST[code] || {})[ref];
      const english = (MANIFEST.en || {})[ref];
      if (mine && english && mine === english) problems.push(`${code} ${ref}: same file as English (${mine})`);
      if (String((TEXTS[code] || {})[ref]) === String((TEXTS.en || {})[ref])) {
        problems.push(`${code} ${ref}: recorded from the English words`);
      }
    }
  }
  eq(problems.length, 0, problems.slice(0, 5).join(" | "));
});

// ── in-page helpers ────────────────────────────────────────────────────────
// Clicking a speaker builds an Audio element from the clip it chose, so recording
// that source says which recording the page decided to speak. The device voice is
// recorded too, so a missing clip cannot hide an English reading behind a fallback.
const RECORDER = `(() => {
  window.__spoken = [];
  window.__web = [];
  window.Audio = function (src) {
    window.__spoken.push(String(src));
    this.src = String(src);
    this.play = () => Promise.resolve();
    this.pause = () => {};
    this.onended = null;
    this.onerror = null;
  };
  if (window.speechSynthesis) {
    window.speechSynthesis.speak = function (u) { window.__web.push({ text: u.text, lang: u.lang }); };
    window.speechSynthesis.cancel = function () {};
  }
  return true;
})()`;

/** Click one speaker and report what it asked the browser to play. */
const CLICK_ONE = (selector) => `(() => {
  const b = document.querySelector(${JSON.stringify(selector)});
  if (!b) return null;
  window.__spoken.length = 0;
  window.__web.length = 0;
  b.click();
  return { src: window.__spoken.slice(), web: window.__web.slice() };
})()`;

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

/**
 * The one checker. Called after every language switch and for both arms: the hero
 * carries one speaker for the title and one per card; the title's lives beside the
 * heading and not inside it; clicking each plays exactly that language's clip, the
 * clip exists, and the words recorded into it are the words on screen.
 * Returns the refs it clicked so the two arms can be compared.
 */
async function checkHome(page, arm, lang) {
  const shape = await page.evaluate(`(() => {
    const h1 = document.querySelector("#home-h1");
    const cards = Array.prototype.slice.call(document.querySelectorAll("#home-body .home-body-p"));
    const wrap = document.querySelector(".home-title");
    const box = (n) => { const r = n.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
    // Text lines that run underneath a card's speaker. The range covers the card's
    // own words only (the button is a separate node), so a speaker sitting on top of
    // the paragraph is visible as a non-zero count.
    const under = (p) => {
      const btn = p.querySelector(".speak-btn");
      const text = p.firstChild;
      if (!btn || !text || text.nodeType !== 3) return { under: -1, btn: null };
      const r = document.createRange();
      r.setStart(text, 0);
      r.setEnd(text, text.textContent.length);
      const b = btn.getBoundingClientRect();
      const hits = Array.prototype.slice.call(r.getClientRects())
        .filter((x) => x.width > 0 && x.right > b.left + 1 && x.left < b.right - 1).length;
      return { under: hits, btn: box(btn) };
    };
    return {
      title: h1 ? h1.textContent : null,
      titleChildren: h1 ? h1.children.length : -1,
      titleSpeak: !!document.querySelector("#home-h1-speak .speak-btn"),
      titleSpeakInsideH1: !!(h1 && h1.querySelector(".speak-btn")),
      titleSpeakBox: document.querySelector("#home-h1-speak .speak-btn") ? box(document.querySelector("#home-h1-speak .speak-btn")) : null,
      wrapBox: wrap ? box(wrap) : null,
      h1Box: h1 ? box(h1) : null,
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      cards: cards.map((p) => ({ speak: !!p.querySelector(".speak-btn"), text: p.textContent, layout: under(p) })),
      lang: document.documentElement.getAttribute("lang"),
      dir: document.documentElement.getAttribute("dir"),
    };
  })()`);
  eq(shape.lang, lang, `${arm}: the page language`);
  eq(shape.cards.length, 3, `${arm} [${lang}]: the hero should show three introduction cards`);
  assert(shape.titleSpeak, `${arm} [${lang}]: the title has no speaker`);
  eq(shape.titleChildren, 0, `${arm} [${lang}]: something was put inside the heading, which changes its accessible name`);
  assert(!shape.titleSpeakInsideH1, `${arm} [${lang}]: the title's speaker is inside the heading`);
  // The title fills its column, so a wrapping title row would drop the speaker onto
  // a line of its own and push the rest of the hero down. The row must be exactly
  // as tall as the heading beside it.
  assert(
    Math.abs(shape.wrapBox.h - shape.h1Box.h) <= 1,
    `${arm} [${lang}]: the title's speaker sits on a line of its own (title row ${shape.wrapBox.h}px tall, heading ${shape.h1Box.h}px)`
  );
  assert(!shape.overflowX, `${arm} [${lang}]: the page scrolls sideways with the hero's speakers`);
  assert(shape.titleSpeakBox.w >= 24 && shape.titleSpeakBox.h >= 24, `${arm} [${lang}]: the title's speaker shrank to ${shape.titleSpeakBox.w}x${shape.titleSpeakBox.h}`);

  const shown = displayedFor(lang);
  eq(shape.title, shown["h/title"], `${arm} [${lang}]: the title on screen`);

  const targets = [
    { where: "the title", ref: "h/title", text: shape.title, selector: "#home-h1-speak .speak-btn" },
  ];
  shape.cards.forEach((card, i) => {
    const ref = i === 0 ? "h/" + arm.toLowerCase() : "h/card" + (i + 1);
    assert(card.speak, `${arm} [${lang}]: card ${i + 1} has no speaker`);
    eq(card.text, shown[ref], `${arm} [${lang}]: card ${i + 1} on screen`);
    // The card's words must never run under its speaker, in either direction.
    eq(card.layout.under, 0, `${arm} [${lang}]: card ${i + 1}'s text runs underneath its speaker`);
    assert(card.layout.btn && card.layout.btn.w >= 24, `${arm} [${lang}]: card ${i + 1}'s speaker shrank to ${JSON.stringify(card.layout.btn)}`);
    targets.push({
      where: `card ${i + 1}`,
      ref,
      text: card.text,
      selector: `#home-body .home-body-p:nth-child(${i + 1}) .speak-btn`,
    });
  });

  const clicked = [];
  for (const t of targets) {
    const played = await page.evaluate(CLICK_ONE(t.selector));
    assert(played, `${arm} [${lang}]: ${t.where}: no speaker to click at ${t.selector}`);
    assert(played.src.length + played.web.length > 0, `${arm} [${lang}]: ${t.where}: clicking the speaker played nothing`);
    assert(played.src.length === 1, `${arm} [${lang}]: ${t.where}: expected one clip, played ${JSON.stringify(played.src)}`);
    eq(played.web.length, 0, `${arm} [${lang}]: ${t.where}: fell back to the device voice although a clip exists`);

    const src = played.src[0];
    const m = String(src).match(/^\/audio\/([^/]+)\//);
    assert(m, `${arm} [${lang}]: ${t.where}: an unexpected audio source ${src}`);
    eq(m[1], lang, `${arm} [${lang}]: ${t.where}: the page shows ${lang} but asked for the ${m[1]} recording`);
    assert(fs.existsSync(path.join(ROOT, src)), `${arm} [${lang}]: ${t.where}: the clip is not in the project: ${src}`);

    const ref = refOf(lang, src.replace(/^\//, ""));
    eq(ref, t.ref, `${arm} [${lang}]: ${t.where} asked for the wrong recording`);
    eq(TEXTS[lang][ref], t.text, `${arm} [${lang}]: ${t.where}: the clip was recorded from other words`);
    clicked.push({ ref, src });
  }

  // Four different strings, so four different recordings: a shared file would mean
  // one card is silently reading another card's words.
  const srcs = clicked.map((c) => c.src);
  eq(srcs.filter((s, i) => srcs.indexOf(s) === i).length, srcs.length, `${arm} [${lang}]: two hero blocks share one recording`);
  return clicked;
}

// ── browser checks ─────────────────────────────────────────────────────────
async function runBrowser() {
  const exe = findBrowser();
  if (!exe) {
    console.log("  skip  no Chrome or Edge found to click the hero speakers with (set CHROME_BIN to point at one)");
    return;
  }
  const site = await serve(ROOT);
  let browser = null;
  try {
    browser = await launch(exe);
    const { page } = browser;
    const seen = {};

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

    for (const arm of ARMS) {
      // One navigation per arm, each at its own URL: the helper's goto waits for a
      // load event, which a second goto to a byte-identical URL never fires.
      await runAsync(`${arm}: the hero speaks in the language on screen, in every language`, async () => {
        await page.goto(`${site.origin}/index.html?hp=${arm}#/`, 1280, 900);
        await page.evaluate("localStorage.clear();");
        await page.reload();
        await waitForManifest(page);
        await page.evaluate(RECORDER);
        for (const lang of LANGS) {
          if (lang !== "en") {
            await switchLanguage(page, lang);
            // A language switch rebuilds the cards and rewrites the title, so this
            // is also the check that the speakers survive it.
          }
          seen[arm] = seen[arm] || {};
          seen[arm][lang] = await checkHome(page, arm, lang);
        }
      });
    }

    await runAsync("both arms record card 1 separately and share cards 2 and 3", async () => {
      const problems = [];
      for (const lang of LANGS) {
        const one = seen.HP1[lang];
        const two = seen.HP2[lang];
        if (one[1].ref !== "h/hp1") problems.push(`${lang}: HP1 card 1 played ${one[1].ref}`);
        if (two[1].ref !== "h/hp2") problems.push(`${lang}: HP2 card 1 played ${two[1].ref}`);
        if (one[1].src === two[1].src) problems.push(`${lang}: both arms played the same card-1 clip`);
        for (const i of [2, 3]) {
          if (one[i].ref !== two[i].ref) problems.push(`${lang}: card ${i} used ${one[i].ref} in HP1 and ${two[i].ref} in HP2`);
          if (one[i].src !== two[i].src) problems.push(`${lang}: card ${i} played a different clip per arm`);
        }
      }
      eq(problems.length, 0, "the arms are not wired to their own recordings: " + problems.slice(0, 4).join(" | "));
    });

    await runAsync("a language switch keeps the hero's speakers, and none of them falls back to English", async () => {
      // Folded out of the two passes above: every language there was reached by a
      // real menu switch (not a reload), so a speaker lost or mis-wired by the
      // re-render would already have failed.
      const leaks = [];
      for (const arm of ARMS) {
        for (const lang of LANGS) {
          for (const c of seen[arm][lang]) {
            if (lang !== "en" && String(c.src).indexOf("/audio/en/") !== -1) leaks.push(`${arm} ${lang} ${c.ref} -> ${c.src}`);
          }
        }
      }
      eq(leaks.length, 0, "English was read while another language was on screen: " + leaks.join(", "));
      eq(Object.keys(seen.HP1).length, LANGS.length, "HP1 was checked in every language");
      eq(Object.keys(seen.HP2).length, LANGS.length, "HP2 was checked in every language");
    });
  } finally {
    if (browser) browser.close();
    await site.close();
  }
}

(async () => {
  await runBrowser();
  if (failures) {
    console.error(`\n${failures} of ${checks} checks FAILED.\n`);
    process.exit(1);
  }
  console.log(`${checks} checks passed: the hero's title and three cards are read aloud in ${LANGS.length} languages, in both arms.`);
})().catch((err) => {
  console.error("FAILED:", err && err.message ? err.message : err);
  process.exit(1);
});
