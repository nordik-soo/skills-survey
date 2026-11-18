#!/usr/bin/env node
/**
 * The prize-draw note on the last page must be readable.
 *
 * The note ("Note: This information will be used only for the prize draw and
 * will not be linked to your survey responses.") is the one paragraph a
 * respondent has to take in before typing an email address, and it sits on the
 * survey's near-white --nordik-bg backdrop. It used to be --fg-3 (#89918d),
 * which is 3.4:1 there — below the 4.5:1 body copy needs. White text alone
 * would be worse (1.05:1 on that backdrop), so the note now carries its own
 * solid dark face and the ink on it is white.
 *
 * The rules this file holds it to:
 *   - the ink is white and the note's own face is fully opaque, so the
 *     contrast does not depend on how bright the gradient behind it happens to
 *     be at that scroll position;
 *   - white on that face is at least WCAG AA 4.5:1 for body text;
 *   - the note stays inside the survey column and the viewport, and its text is
 *     not clipped, in every one of the nine languages — including the long
 *     translations (Hindi, Tagalog) and right-to-left Arabic;
 *   - the note is only on screen when the answer that reveals it ("Yes") is
 *     chosen, and it is the translated line, not English leaking through.
 *
 * The fake DOM the rest of the suite uses has no cascade or layout, so this
 * measures the real page in the Chrome/Edge already on the machine. With no
 * browser installed the checks are reported as skipped and the file exits 0.
 *
 * Run: node tests/test_gift_note_visibility.js
 */
"use strict";
const path = require("path");

const { findBrowser, serve, launch } = require("./helpers/browser.js");

const ROOT = path.join(__dirname, "..");
const DRAFT_KEY = "sault_survey_draft_v1";
const LANG_KEY = "sault_lang_v1";
const LAST_QUESTION = "gift_card_draw";
const NOTE = "Note: This information will be used only for the prize draw and will not be linked to your survey responses.";

// WCAG AA for body text
const MIN_CONTRAST = 4.5;

const LANGS = ["en", "es", "fr", "hi", "it", "pt", "ar", "zh", "tl"];

let failures = 0;
let checks = 0;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function eq(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ── colour maths ───────────────────────────────────────────────────────────
function rgb(text) {
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?/.exec(String(text).trim());
  if (!m) return null;
  return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
}

function luminance(c) {
  const channel = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

function contrast(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

// ── measurement inside the page ────────────────────────────────────────────
const MEASURE = `(() => {
  const note = document.querySelector(".field-note");
  if (!note) return { found: false };
  const box = (n) => {
    const b = n.getBoundingClientRect();
    return {
      top: Math.round(b.top), bottom: Math.round(b.bottom),
      left: Math.round(b.left), right: Math.round(b.right),
      width: Math.round(b.width), height: Math.round(b.height),
    };
  };
  const cs = getComputedStyle(note);
  const col = document.querySelector(".survey-wrap");
  const input = document.querySelector(".gift-card-email .input");
  const lang = (function () {
    try { return localStorage.getItem(${JSON.stringify(LANG_KEY)}) || "en"; } catch (e) { return "en"; }
  })();
  const dict = (window.I18N && window.I18N.dicts && window.I18N.dicts[lang]) || null;
  return {
    found: true,
    color: cs.color,
    background: cs.backgroundColor,
    radius: cs.borderTopLeftRadius,
    paddingTop: cs.paddingTop,
    paddingLeft: cs.paddingLeft,
    display: cs.display,
    visibility: cs.visibility,
    direction: cs.direction,
    text: note.textContent.replace(/\\s+/g, " ").trim(),
    expected: dict && dict.ui ? (dict.ui[${JSON.stringify(NOTE)}] || null) : null,
    lang: lang,
    docDir: document.documentElement.getAttribute("dir") || "ltr",
    box: box(note),
    column: col ? box(col) : null,
    // does the note's own text fit its box, or is it clipped?
    scrollHeight: note.scrollHeight,
    clientHeight: note.clientHeight,
    scrollWidth: note.scrollWidth,
    clientWidth: note.clientWidth,
    fieldHidden: (function () {
      const f = note.closest(".gift-card-email");
      return f ? (f.hidden || getComputedStyle(f).display === "none") : null;
    })(),
    inputBackground: input ? getComputedStyle(input).backgroundColor : null,
    // the last page closes with a Submit row (.submit-area), not the .q-nav
    // arrows the earlier questions use
    submitArea: (function () {
      const s = document.querySelector(".submit-area");
      return s ? box(s) : null;
    })(),
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    pageScrollY: Math.round(window.scrollY),
  };
})()`;

let navSeq = 0;

/**
 * Open the last question. `answer` decides whether the email field (and so the
 * note) is revealed at all.
 */
async function open(page, origin, { lang = "en", width = 390, height = 640, answer = "Yes" } = {}) {
  navSeq += 1;
  await page.goto(`${origin}/index.html?note=${navSeq}#/`, width, height);
  await page.evaluate(
    "localStorage.clear();" +
    "localStorage.setItem(" + JSON.stringify(DRAFT_KEY) + ", JSON.stringify({" +
    "answers:{consent:\"Yes, I confirm\",eligible:\"Yes\"," + JSON.stringify(LAST_QUESTION) + ":" + JSON.stringify(answer) + "}," +
    "currentId:" + JSON.stringify(LAST_QUESTION) + "}));" +
    (lang === "en" ? "" : "localStorage.setItem(" + JSON.stringify(LANG_KEY) + ", " + JSON.stringify(lang) + ");")
  );
  await page.reload();
  await page.setHash("#/survey");
  // the question block rises in over 500ms; measure once it has settled
  await page.evaluate("new Promise((r) => setTimeout(r, 900))");
  return page.evaluate(MEASURE);
}

/**
 * The one checker: every rule the note must always satisfy. Called at the end
 * of every test, so a case cannot pass while breaking an invariant another
 * case would have caught.
 */
function assertNoteInvariants(m, where) {
  assert(m.found, where + ": the note is not on the last page at all");

  // white ink
  const ink = rgb(m.color);
  assert(ink, where + `: unreadable colour ${JSON.stringify(m.color)}`);
  eq([ink.r, ink.g, ink.b].join(","), "255,255,255", where + ": the note's text is not white");
  eq(ink.a, 1, where + ": the note's white is translucent");

  // its own solid face, so contrast does not depend on the backdrop
  const face = rgb(m.background);
  assert(face, where + `: the note paints no readable face (${JSON.stringify(m.background)})`);
  eq(face.a, 1, where + `: the note's face is translucent (${m.background}), so the bright backdrop shows through`);

  // and white on that face is body-text contrast
  const ratio = contrast(ink, face);
  assert(
    ratio >= MIN_CONTRAST,
    where + `: white on the note's face is only ${ratio.toFixed(2)}:1, under the ${MIN_CONTRAST}:1 needed to read body copy`
  );

  // readable means fully on screen and not clipped
  assert(m.display !== "none" && m.visibility !== "hidden", where + ": the note is hidden although the email field is showing");
  eq(m.fieldHidden, false, where + ": the email field is hidden while the note is being measured");
  assert(
    m.scrollHeight <= m.clientHeight + 1,
    where + `: the note's text is clipped vertically (${m.scrollHeight}px of text in ${m.clientHeight}px)`
  );
  assert(
    m.scrollWidth <= m.clientWidth + 1,
    where + `: the note's text overflows sideways (${m.scrollWidth}px in ${m.clientWidth}px)`
  );

  // inside the column it belongs to, and inside the viewport
  assert(m.column, where + ": no survey column to compare against");
  assert(
    m.box.left >= m.column.left - 1 && m.box.right <= m.column.right + 1,
    where + `: the note spills out of the survey column (note ${m.box.left}..${m.box.right}, column ${m.column.left}..${m.column.right})`
  );
  assert(
    m.box.left >= 0 && m.box.right <= m.viewportWidth,
    where + `: the note runs off the screen horizontally (${m.box.left}..${m.box.right} of ${m.viewportWidth})`
  );
  assert(m.box.width > 0 && m.box.height > 0, where + ": the note has no size");
  eq(m.pageScrollY, 0, where + ": the page itself scrolled");

  // the padding is what keeps long translations off the edge
  assert(
    parseFloat(m.paddingLeft) >= 8,
    where + `: the note has only ${m.paddingLeft} of side padding, so long translations touch the edge`
  );
  eq(m.radius, "7px", where + ": the note's radius left the survey's row metric");
}

async function run() {
  const exe = findBrowser();
  if (!exe) {
    console.log("  skip  no Chrome or Edge found to measure the note with (set CHROME_BIN to point at one)");
    return;
  }

  const site = await serve(ROOT);
  let browser = null;
  try {
    browser = await launch(exe);
    const { page } = browser;

    const runAsync = async (name, fn) => {
      checks++;
      try {
        await fn();
        console.log("  ok  " + name);
      } catch (err) {
        failures++;
        console.log("  x   " + name + ": " + err.message);
      }
    };

    await runAsync("the last page's note is white on its own dark face", async () => {
      const where = "en 390x640";
      const m = await open(page, site.origin);
      assertNoteInvariants(m, where);
      // white on a near-black face, not on the page's pale gradient
      const face = rgb(m.background);
      assert(
        luminance(face) <= 0.15,
        where + `: the note's face is too light to carry white text (luminance ${luminance(face).toFixed(3)})`
      );
    });

    await runAsync("it stays readable on a small phone", async () => {
      const where = "en 360x560";
      const m = await open(page, site.origin, { width: 360, height: 560 });
      assertNoteInvariants(m, where);
    });

    await runAsync("it stays readable on a desktop window", async () => {
      const where = "en 1280x800";
      const m = await open(page, site.origin, { width: 1280, height: 800 });
      assertNoteInvariants(m, where);
      assert(m.box.height > 0 && m.box.width <= 460 + 1, where + `: the note grew past its column (${m.box.width}px wide)`);
    });

    await runAsync("all nine languages keep it readable, with translated copy", async () => {
      for (const lang of LANGS) {
        const where = `${lang} 390x640`;
        const m = await open(page, site.origin, { lang });
        assertNoteInvariants(m, where);

        // the note is the translated line, not English leaking through
        if (lang === "en") {
          eq(m.text, NOTE, where + ": the English note changed wording");
        } else {
          assert(m.expected, where + ": the language has no entry for this note");
          eq(m.text, m.expected.replace(/\s+/g, " ").trim(), where + ": the note is not the translated copy");
          assert(m.text !== NOTE, where + ": the note still renders in English");
        }
      }
    });

    await runAsync("the long translations wrap inside the column instead of being clipped", async () => {
      // Hindi and Tagalog are the longest renderings of this note at 360px
      for (const lang of ["hi", "tl"]) {
        const where = `${lang} 360x560`;
        const m = await open(page, site.origin, { lang, width: 360, height: 560 });
        assertNoteInvariants(m, where);
        assert(
          m.scrollHeight <= m.clientHeight + 1,
          where + `: the wrapped note is cut off (${m.scrollHeight}px of text in ${m.clientHeight}px)`
        );
      }
    });

    await runAsync("Arabic reads right to left and still fits", async () => {
      const where = "ar 390x640";
      const m = await open(page, site.origin, { lang: "ar" });
      assertNoteInvariants(m, where);
      eq(m.docDir, "rtl", where + ": the page did not switch to right-to-left");
      eq(m.direction, "rtl", where + ": the note did not follow the page direction");
    });

    await runAsync("the note is not on screen unless the draw answer reveals it", async () => {
      const where = "en, answered No";
      const m = await open(page, site.origin, { answer: "No" });
      assert(m.found, where + ": the note element is gone entirely, so the Yes case proves nothing");
      // hidden with its field: not claimable as "visible", but still white on its face
      eq(m.fieldHidden, true, where + ": the email field shows even though the answer was No");
      const ink = rgb(m.color);
      const face = rgb(m.background);
      assert(ink && face, where + ": the hidden note lost its colours, so hiding it is not what removed it");
      eq([ink.r, ink.g, ink.b].join(","), "255,255,255", where + ": the hidden note is not white");

      // and the Yes case still shows it, so the rule above is about the answer
      const shown = await open(page, site.origin, { answer: "Yes" });
      assertNoteInvariants(shown, "en, answered Yes");
    });

    await runAsync("switching language from the header re-renders the note white on dark, not stale", async () => {
      const first = await open(page, site.origin, { lang: "en" });
      assertNoteInvariants(first, "en before the switch");
      eq(first.lang, "en", "en before the switch: wrong language stored");

      // the app reads the language through its own picker (setLanguage), not
      // from localStorage on each render, so drive the real control
      await page.evaluate(`(() => {
        const btn = document.querySelector("#lang-btn");
        if (!btn) throw new Error("no language button");
        btn.click();
        const items = [...document.querySelectorAll(".lang-menu .lang-item")];
        const fr = items.find((b) => b.getAttribute("lang") === "fr");
        if (!fr) throw new Error("no French item in the language menu");
        fr.click();
      })()`);
      await page.evaluate("new Promise((r) => setTimeout(r, 500))");
      const after = await page.evaluate(MEASURE);

      assertNoteInvariants(after, "fr after the switch");
      assert(after.text !== first.text, "fr after the switch: the note did not re-render in the new language");
      assert(after.expected, "fr after the switch: French has no entry for this note");
      eq(after.text, after.expected.replace(/\s+/g, " ").trim(), "fr after the switch: the note is stale English");
    });

    await runAsync("giving the note a face left the rest of the last page alone", async () => {
      const where = "en 390x640";
      const m = await open(page, site.origin);
      assertNoteInvariants(m, where);
      // the email input keeps its own white field
      const inputBg = rgb(m.inputBackground);
      assert(inputBg, where + `: the email input lost its background (${JSON.stringify(m.inputBackground)})`);
      eq(inputBg.a, 1, where + ": the email input's field became translucent");
      assert(
        luminance(inputBg) >= 0.8,
        where + `: the email input is no longer a light field (luminance ${luminance(inputBg).toFixed(3)})`
      );
      // the note is on screen, and the Submit row below it is not painted over it
      assert(
        m.box.top >= 0 && m.box.bottom <= m.viewportHeight,
        where + `: the note is not fully on screen (${m.box.top}..${m.box.bottom} of ${m.viewportHeight})`
      );
      assert(m.submitArea, where + ": the last page lost its Submit row");
      assert(
        m.box.bottom <= m.submitArea.top + 1,
        where + `: the Submit row covers the note (note ends at ${m.box.bottom}, row starts at ${m.submitArea.top})`
      );
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
      console.log("1 check skipped: the prize-draw note was not measured (no browser).");
      return;
    }
    console.log(`${checks} checks passed: the last page's note is white, on its own dark face, in every language.`);
  })
  .catch((err) => {
    console.error("\n" + (err && err.stack ? err.stack : err) + "\n");
    process.exit(1);
  });
