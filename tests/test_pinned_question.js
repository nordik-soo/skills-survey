#!/usr/bin/env node
/**
 * The arrows follow the last option; the question and the progress bar stay put.
 *
 * The arrows used to be a sibling of the question block, and the block was
 * `flex: 1 1 auto` inside a full-height screen: the block stretched to the
 * bottom of the viewport and pushed the arrows there, so the space between the
 * last option and the arrows was whatever was left over — 197px under a
 * two-option list on a 390x640 phone, 368px on a desktop window. The buttons
 * looked attached to the screen, not to the answers.
 *
 * Now .q-nav is the last child of the scrolling answer region (.q-scroll), so it
 * sits one row under the last option at any list length, and the respondent
 * reaches it by scrolling the answers. The question heading and the progress bar
 * still do not move, and the page itself still never scrolls.
 *
 * The fake DOM used by the rest of the suite has no layout, so this file
 * measures the real thing: it serves the project over http, starts the
 * Chrome/Edge already installed on the machine in headless mode, and reads
 * getBoundingClientRect before and after scrolling — exactly what a respondent
 * sees. When no browser is installed the layout checks are reported as skipped
 * and the file still exits 0.
 *
 * Run: node tests/test_pinned_question.js
 */
"use strict";
const path = require("path");

const { findBrowser, serve, launch } = require("./helpers/browser.js");

const ROOT = path.join(__dirname, "..");
const QUESTION = "employment_status"; // 13 plain options, always visible
const SHORT_QUESTION = "recommend_survey"; // two options: the case that showed the gap
const DRAFT_KEY = "sault_survey_draft_v1";
const LANG_KEY = "sault_lang_v1";

// The largest gap allowed between the last option and the arrow row: the
// survey's 14px spacing between blocks, with room for a metric change but not
// for a stretched block. The layout this replaced left 197px there.
const MAX_ROW_GAP = 24;

let failures = 0;
let checks = 0;
let skipped = 0;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function eq(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// Layout positions are reported in whole pixels, so compare within one pixel:
// a fractional offset must not read as "the question moved".
function near(actual, expected, msg) {
  if (Math.abs(actual - expected) > 1) {
    throw new Error(`${msg}: expected ${expected} (±1px), got ${actual}`);
  }
}

let navSeq = 0;

// ── helpers that run inside the page ───────────────────────────────────────
// Everything is measured from the real layout, rounded to whole pixels so a
// sub-pixel wobble cannot make the checks flaky.
const MEASURE = `(() => {
  const box = (sel) => {
    const n = typeof sel === "string" ? document.querySelector(sel) : sel;
    if (!n) return null;
    const b = n.getBoundingClientRect();
    return { top: Math.round(b.top), bottom: Math.round(b.bottom), height: Math.round(b.height) };
  };
  const region = document.querySelector(".q-scroll");
  const nav = document.querySelector(".q-nav, .submit-area");
  const opts = [...document.querySelectorAll(".q-scroll .opt")];
  const last = opts.length ? opts[opts.length - 1] : null;
  return {
    question: box(".q-text"),
    progress: box(".progress-card"),
    nav: box(nav),
    region: region ? {
      top: Math.round(region.getBoundingClientRect().top),
      bottom: Math.round(region.getBoundingClientRect().bottom),
      height: region.clientHeight,
      contentHeight: region.scrollHeight,
      scrollTop: Math.round(region.scrollTop),
    } : null,
    // the arrows belong to the answers: same scrolling region, one row under
    // the last option
    navInRegion: !!(region && nav && region.contains(nav)),
    navIsRegionChild: !!(region && nav && nav.parentElement === region),
    navIsScreenChild: !!(nav && nav.parentElement && nav.parentElement.matches(".survey-wrap")),
    lastOption: box(last),
    gapToLastOption: (nav && last) ? Math.round(nav.getBoundingClientRect().top - last.getBoundingClientRect().bottom) : null,
    firstOption: box(".q-scroll .opt"),
    optionCount: opts.length,
    questionText: (document.querySelector(".q-text") || {}).textContent || "",
    direction: document.documentElement.getAttribute("dir") || "ltr",
    pageScrollY: Math.round(window.scrollY),
    pageHeight: Math.round(document.documentElement.scrollHeight),
    viewportHeight: window.innerHeight,
  };
})()`;

/** Land on the long question with a fresh draft, in the language asked for. */
async function openQuestion(page, origin, { lang = "en", width = 390, height = 640, id = QUESTION } = {}) {
  // a unique query forces a real document load, since a URL that differs only
  // in its hash would not fire a load event
  navSeq += 1;
  await page.goto(`${origin}/index.html?nav=${navSeq}#/`, width, height);
  await page.evaluate(
    "localStorage.clear();" +
    `localStorage.setItem(${JSON.stringify(DRAFT_KEY)}, JSON.stringify({` +
    `answers:{consent:"Yes, I confirm",eligible:"Yes"},currentId:${JSON.stringify(id)}}));` +
    (lang === "en" ? "" : `localStorage.setItem(${JSON.stringify(LANG_KEY)}, ${JSON.stringify(lang)});`)
  );
  await page.reload();
  await page.setHash("#/survey");
  // the question block rises in over 500ms; measure once it has settled
  await page.evaluate("new Promise((r) => setTimeout(r, 850))");
  return page.evaluate(MEASURE);
}

/** Scroll the answer region the way a wheel or a swipe does. */
async function scrollOptions(page, delta) {
  await page.evaluate(
    `(() => { const r = document.querySelector(".q-scroll"); r.scrollTop = Math.min(${delta}, r.scrollHeight); return r.scrollTop; })()`
  );
  await page.evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))");
  return page.evaluate(MEASURE);
}

/** Scroll the answer region all the way to its end, where the arrows are. */
async function scrollOptionsToEnd(page) {
  await page.evaluate(`(() => { const r = document.querySelector(".q-scroll"); r.scrollTop = r.scrollHeight; return r.scrollTop; })()`);
  await page.evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))");
  return page.evaluate(MEASURE);
}

/**
 * The rules that must hold on every long question, in every language: the
 * heading and the progress bar stay put, the options scroll, and the arrows sit
 * one row under the last option at the end of that same region.
 */
function assertPinned(before, after, where) {
  assert(before.region, where + ": the answer region is missing");
  assert(
    before.region.contentHeight > before.region.height,
    where + `: the answer list does not overflow (content ${before.region.contentHeight}px in ${before.region.height}px), so there is nothing to scroll`
  );
  assert(before.optionCount >= 13, where + ": expected the 13 employment options, saw " + before.optionCount);

  // the page itself must not scroll: the question cannot be dragged away
  eq(after.pageScrollY, 0, where + ": the page scrolled");
  assert(
    before.pageHeight <= before.viewportHeight + 1,
    where + `: the page is taller than the screen (${before.pageHeight}px > ${before.viewportHeight}px)`
  );

  // the pieces that must stay still
  near(after.question.top, before.question.top, where + ": the question moved while the options scrolled");
  near(after.progress.top, before.progress.top, where + ": the progress bar moved while the options scrolled");
  assert(after.progress.bottom <= after.question.top, where + ": the question overlaps the progress bar");
  assert(after.question.bottom <= after.region.top, where + ": the question overlaps the answer region");

  // the arrows belong to the answers, not to the bottom of the screen
  assert(before.navInRegion, where + ": the arrow row is not inside the answer region, so it is pinned to the screen again");
  assert(before.navIsRegionChild, where + ": the arrow row is not the answer region's last child, so the options cannot push it down");
  assert(!before.navIsScreenChild, where + ": the arrow row is a sibling of the question block again, so a stretched block can push it to the bottom");
  assert(before.lastOption, where + ": no last option for the arrows to follow");
  assert(
    before.nav.top >= before.lastOption.bottom - 1,
    where + `: the arrows overlap the last option (arrows start at ${before.nav.top}, option ends at ${before.lastOption.bottom})`
  );
  assert(
    before.gapToLastOption <= MAX_ROW_GAP,
    where + `: a ${before.gapToLastOption}px band of empty space sits between the last option and the arrows (a row gap is ${MAX_ROW_GAP}px at most)`
  );

  // and the one thing that must move
  assert(after.region.scrollTop > before.region.scrollTop, where + ": the answer region did not scroll");
  assert(after.firstOption.top < before.firstOption.top, where + ": the options did not move up inside the region");

  // every option is reachable: scrolled to the end, the last one is on screen
  assert(
    after.lastOption.top >= after.region.top && after.lastOption.bottom <= after.viewportHeight,
    where + `: the last option is not visible after scrolling (${after.lastOption.top}–${after.lastOption.bottom} vs region top ${after.region.top}, screen ${after.viewportHeight})`
  );
  // and the arrows are right below it, fully on screen, still one row away
  assert(
    after.nav.top >= after.lastOption.bottom - 1,
    where + `: the arrows overlap the last option after scrolling (${after.nav.top} vs ${after.lastOption.bottom})`
  );
  assert(
    after.gapToLastOption <= MAX_ROW_GAP,
    where + `: a ${after.gapToLastOption}px band opened between the last option and the arrows after scrolling`
  );
  assert(
    after.nav.bottom <= after.viewportHeight,
    where + `: the arrows are below the screen after scrolling to the end (${after.nav.bottom} > ${after.viewportHeight})`
  );
}

/** The one checker called at the end of every layout case. */
function assertPageIntact(m, where) {
  assert(m.question, where + ": no question on screen");
  assert(m.question.height > 0, where + ": the question has no height");
  assert(m.progress, where + ": no progress card on screen");
  assert(m.region, where + ": no answer region");
  assert(m.nav, where + ": no nav on screen");
  assert(m.questionText.trim().length > 10, where + ": the question is empty");
}

// A dropdown's own geometry: the open menu and its scrolling list, against the
// visible answer area that clips them.
const DROPDOWN = `(() => {
  const box = (n) => { const b = n.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), height: Math.round(b.height) }; };
  const menu = document.querySelector(".custom-select-menu");
  const region = document.querySelector(".q-scroll");
  const list = document.querySelector(".custom-select-list");
  const trigger = document.querySelector(".custom-select-trigger");
  return {
    open: !!menu && menu.offsetParent !== null && getComputedStyle(menu).display !== "none",
    menu: menu ? box(menu) : null,
    list: list ? Object.assign(box(list), { clientHeight: list.clientHeight, scrollHeight: Math.round(list.scrollHeight) }) : null,
    region: region ? box(region) : null,
    trigger: trigger ? box(trigger) : null,
    triggerLabel: trigger ? (trigger.querySelector("span") || trigger).textContent.trim() : "",
    options: document.querySelectorAll(".custom-select-option").length,
    question: box(document.querySelector(".q-text")),
    progress: box(document.querySelector(".progress-card")),
    viewportHeight: window.innerHeight,
    pageScrollY: Math.round(window.scrollY),
  };
})()`;

/** Land on a question answered by a dropdown and open that dropdown. */
async function openDropdown(page, origin, { id, answers, width = 390, height = 640, lang = "en" } = {}) {
  navSeq += 1;
  await page.goto(`${origin}/index.html?nav=${navSeq}#/`, width, height);
  await page.evaluate(
    "localStorage.clear();" +
    `localStorage.setItem(${JSON.stringify(DRAFT_KEY)}, JSON.stringify({` +
    `answers:${JSON.stringify(answers)},currentId:${JSON.stringify(id)}}));` +
    (lang === "en" ? "" : `localStorage.setItem(${JSON.stringify(LANG_KEY)}, ${JSON.stringify(lang)});`)
  );
  await page.reload();
  await page.setHash("#/survey");
  await page.evaluate("new Promise((r) => setTimeout(r, 850))");
  await page.evaluate(`(() => { const t = document.querySelector(".custom-select-trigger"); if (t) t.click(); })()`);
  await page.evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))");
  return page.evaluate(DROPDOWN);
}

/** The rules an open dropdown must obey inside the scrolling answer area. */
function assertDropdownVisible(m, where) {
  assert(m.region, where + ": no answer area");
  assert(m.trigger, where + ": no dropdown on the question");
  assert(m.open, where + ": the dropdown did not open");
  assert(m.menu, where + ": the open dropdown has no panel");
  assert(m.menu.height > 0, where + ": the open dropdown has no height");

  // nothing may be clipped by the scrolling answer area
  assert(
    m.menu.bottom <= m.region.bottom + 1,
    where + `: the dropdown is cut off by the answer area (panel ends at ${m.menu.bottom}, area ends at ${m.region.bottom})`
  );
  assert(
    m.menu.top >= m.region.top - 1,
    where + `: the dropdown starts above the answer area (${m.menu.top} < ${m.region.top})`
  );
  if (m.list) {
    assert(
      m.list.bottom <= m.region.bottom + 1,
      where + `: the option list is cut off (list ends at ${m.list.bottom}, area ends at ${m.region.bottom})`
    );
    assert(m.list.clientHeight >= 30, where + `: the option list was squeezed to ${m.list.clientHeight}px`);
    // a long list scrolls inside the panel rather than pushing it past the area
    if (m.list.scrollHeight > m.list.clientHeight) {
      assert(m.list.clientHeight >= 30, where + ": the long list has no scrollable room");
    }
  }
  // and the question above it is untouched
  assert(m.question.bottom <= m.region.top + 1, where + ": the question overlaps the answer area");
  eq(m.pageScrollY, 0, where + ": the page scrolled when the dropdown opened");
}

/** Choose the last rendered option and report what the trigger now says. */
async function pickLastOption(page) {
  return page.evaluate(`(async () => {
    const opts = [...document.querySelectorAll(".custom-select-option")];
    if (!opts.length) return null;
    const last = opts[opts.length - 1];
    last.scrollIntoView({ block: "nearest" });
    const label = (last.querySelector(".cso-label") || last).textContent.trim();
    last.click();
    await new Promise((r) => requestAnimationFrame(r));
    const trigger = document.querySelector(".custom-select-trigger");
    return { chosen: label, shown: (trigger.querySelector("span") || trigger).textContent.trim(), stillOpen: !!document.querySelector(".custom-select.open") };
  })()`);
}

async function run() {
  const exe = findBrowser();
  if (!exe) {
    console.log("  skip  no Chrome or Edge found to measure the layout with (set CHROME_BIN to point at one)");
    skipped += 1;
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

    await runAsync("on a phone, a long option list scrolls without moving the question or the progress bar", async () => {
      const where = "phone 390x640";
      const before = await openQuestion(page, site.origin, { width: 390, height: 640 });
      assertPageIntact(before, where);
      const after = await scrollOptions(page, 400);
      assertPageIntact(after, where);
      assertPinned(before, after, where);
    });

    await runAsync("the arrows follow the last option on a short list instead of sitting at the bottom of the screen", async () => {
      const where = "two options 390x640";
      const m = await openQuestion(page, site.origin, { width: 390, height: 640, id: SHORT_QUESTION });
      assertPageIntact(m, where);
      assert(m.navInRegion && m.navIsRegionChild, where + ": the arrows are not the answer region's last child");
      assert(m.lastOption, where + ": no options on screen");
      // the gap the old layout left: 197px under these two options
      assert(
        m.gapToLastOption <= MAX_ROW_GAP,
        where + `: a ${m.gapToLastOption}px band sits between the last option and the arrows`
      );
      assert(
        m.nav.bottom <= m.viewportHeight,
        where + `: the arrows are below the screen (${m.nav.bottom} > ${m.viewportHeight})`
      );
      // and they are attached to the answers, not parked at the viewport floor
      assert(
        m.viewportHeight - m.nav.bottom > 60,
        where + `: the arrows are pinned to the bottom of the screen again (ends at ${m.nav.bottom} of ${m.viewportHeight})`
      );
    });

    await runAsync("the same holds on a desktop window", async () => {
      const where = "desktop 1280x800";
      const m = await openQuestion(page, site.origin, { width: 1280, height: 800, id: SHORT_QUESTION });
      assertPageIntact(m, where);
      assert(
        m.gapToLastOption <= MAX_ROW_GAP,
        where + `: a ${m.gapToLastOption}px band sits between the last option and the arrows (the old layout left 368px here)`
      );
      assert(
        m.viewportHeight - m.nav.bottom > 60,
        where + `: the arrows are pinned to the bottom of the screen again (ends at ${m.nav.bottom} of ${m.viewportHeight})`
      );
    });

    await runAsync("on a long list the arrows come into view at the end of the answers", async () => {
      const where = "13 options 390x640";
      const before = await openQuestion(page, site.origin, { width: 390, height: 640 });
      assertPageIntact(before, where);
      assert(
        before.region.contentHeight > before.region.height,
        where + ": the long list does not overflow, so there is nothing to scroll"
      );
      // they start below the fold, at the end of the list — not on the screen
      assert(
        before.nav.bottom > before.viewportHeight,
        where + `: the arrows should sit at the end of the answers, below the fold (${before.nav.bottom} <= ${before.viewportHeight})`
      );
      const after = await scrollOptionsToEnd(page);
      assert(after.region.scrollTop > 0, where + ": the answer region did not scroll");
      assert(
        after.nav.bottom <= after.viewportHeight,
        where + `: the arrows never come into view (${after.nav.bottom} > ${after.viewportHeight})`
      );
      assert(
        after.gapToLastOption <= MAX_ROW_GAP,
        where + `: a ${after.gapToLastOption}px band opened between the last option and the arrows`
      );
      near(after.question.top, before.question.top, where + ": the question moved while the options scrolled");
    });

    await runAsync("the page itself cannot scroll the question away", async () => {
      const where = "page scroll";
      const before = await openQuestion(page, site.origin, { width: 390, height: 640 });
      await page.evaluate("window.scrollTo(0, 600); document.documentElement.scrollTop = 600; document.body.scrollTop = 600;");
      await page.evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))");
      const moved = await page.evaluate(MEASURE);
      eq(moved.pageScrollY, 0, where + ": the page scrolled");
      near(moved.question.top, before.question.top, where + ": the question moved when the page was scrolled");
    });

    await runAsync("a wheel over the option list scrolls the list, not the page", async () => {
      const where = "mouse wheel";
      const before = await openQuestion(page, site.origin, { width: 390, height: 640 });
      const point = await page.evaluate(
        `(() => { const b = document.querySelector(".q-scroll").getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`
      );
      await page.send("Input.dispatchMouseEvent", {
        type: "mouseWheel", x: point.x, y: point.y, deltaX: 0, deltaY: 300, pointerType: "mouse",
      });
      await page.evaluate("new Promise((r) => setTimeout(() => requestAnimationFrame(() => r(1)), 120))");
      const after = await page.evaluate(MEASURE);
      eq(after.pageScrollY, 0, where + ": the page scrolled on a wheel over the options");
      near(after.question.top, before.question.top, where + ": the question moved on a wheel over the options");
      near(after.progress.top, before.progress.top, where + ": the progress bar moved on a wheel over the options");
      assert(after.region.scrollTop > 0, where + ": the wheel did not scroll the option list");
    });

    await runAsync("Arabic (right to left) pins the question too, and keeps the text right-aligned", async () => {
      const where = "Arabic 390x640";
      const before = await openQuestion(page, site.origin, { width: 390, height: 640, lang: "ar" });
      assertPageIntact(before, where);
      eq(before.direction, "rtl", where + ": the page did not switch to right-to-left");
      const after = await scrollOptions(page, 400);
      assertPageIntact(after, where);
      assertPinned(before, after, where);
    });

    await runAsync("a wide translated heading (Hindi) still leaves the options scrollable", async () => {
      const where = "Hindi 360x600";
      const before = await openQuestion(page, site.origin, { width: 360, height: 600, lang: "hi" });
      assertPageIntact(before, where);
      const after = await scrollOptions(page, 400);
      assertPageIntact(after, where);
      assertPinned(before, after, where);
      assert(
        before.region.height >= 100,
        where + `: the answer region was squeezed to ${before.region.height}px by the heading`
      );
    });

    await runAsync("a very short screen still keeps a usable option area instead of collapsing it", async () => {
      const where = "short 390x430";
      const before = await openQuestion(page, site.origin, { width: 390, height: 430 });
      assertPageIntact(before, where);
      assert(
        before.region.height >= 100,
        where + `: the option area collapsed to ${before.region.height}px`
      );
      const after = await scrollOptionsToEnd(page);
      near(after.question.top, before.question.top, where + ": the question moved while the options scrolled");
      near(after.progress.top, before.progress.top, where + ": the progress bar moved while the options scrolled");
      assert(after.region.scrollTop > 0, where + ": the option list did not scroll");
      assert(
        after.nav.bottom <= after.viewportHeight,
        where + `: the arrows never come into view on a short screen (${after.nav.bottom} > ${after.viewportHeight})`
      );
    });

    await runAsync("the long country picklist opens fully inside the answer area, even on a short screen", async () => {
      const where = "country picklist 390x430";
      const before = await openDropdown(page, site.origin, {
        id: "country_moved_from",
        answers: { consent: "Yes, I confirm", eligible: "Yes", moved_from: "Outside of Canada" },
        width: 390,
        height: 430,
      });
      assertDropdownVisible(before, where);
      assert(before.options >= 40, where + `: expected a long country list, saw ${before.options} options`);
      assert(before.list, where + ": the searchable list is missing");
      assert(
        before.list.scrollHeight > before.list.clientHeight,
        where + ": the long list is not scrollable, so the rest of the countries are unreachable"
      );

      // the option at the very end of the list can still be chosen
      const picked = await pickLastOption(page);
      assert(picked, where + ": no option to pick");
      eq(picked.shown, picked.chosen, where + `: picking ${JSON.stringify(picked.chosen)} did not stick`);
      assert(!picked.stillOpen, where + ": the dropdown stayed open after a pick");
    });

    await runAsync("a plain select dropdown is not clipped by the answer area either", async () => {
      const where = "province select 390x430";
      const before = await openDropdown(page, site.origin, {
        id: "province",
        answers: { consent: "Yes, I confirm", eligible: "Yes", moved_from: "Outside of Ontario but within Canada" },
        width: 390,
        height: 430,
      });
      assertDropdownVisible(before, where);
      assert(before.options >= 10, where + `: expected the province list, saw ${before.options} options`);
      const picked = await pickLastOption(page);
      assert(picked, where + ": no option to pick");
      eq(picked.shown, picked.chosen, where + `: picking ${JSON.stringify(picked.chosen)} did not stick`);
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
      console.log("1 check skipped: the question layout was not measured (no browser).");
      return;
    }
    console.log(`${checks} checks passed: the arrows follow the last option; the question and the progress bar stay put.`);
  })
  .catch((err) => {
    console.error("\n" + (err && err.stack ? err.stack : err) + "\n");
    process.exit(1);
  });
