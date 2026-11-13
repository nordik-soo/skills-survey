#!/usr/bin/env node
/**
 * The answer list scrolls, but draws no scrollbar — and still says it continues.
 *
 * The list used to show the raw OS scrollbar: a grey Windows bar with stepper
 * arrows down the side of a column of white cards, drawn only on Windows and only
 * once a list was long enough to scroll, so the cards also changed width at that
 * moment (a classic bar reserves 15-17px; a hidden one reserves nothing).
 *
 * Hiding it alone would have been worse than the bar: the Next arrow is the last
 * child of this same region, so on a long list it sits below the fold (measured
 * 112px past the edge at 1280x800 with 11 options in view) and a fully visible
 * column would read as complete. So a soft shadow rides the bottom edge while
 * content is still below, and app.js adds/removes it from the real scroll
 * metrics: a list that fits shows nothing, and the arrows are never dimmed once
 * they are in view.
 *
 * A fade was the obvious affordance and is the wrong one here: the survey page
 * stands on a photograph, so fading the cards would have exposed the dark water
 * behind them (measured: white 255 -> [4,6,12]). The shadow is painted inside the
 * region instead, never revealing the page.
 *
 * The fake DOM used by the rest of the suite has no layout, so this file measures
 * the real thing: it serves the project over http, starts the Chrome/Edge already
 * installed on the machine in headless mode, and reads computed style and scroll
 * metrics. When no browser is installed the checks are reported as skipped and
 * the file still exits 0.
 *
 * Run: node tests/test_scroll_affordance.js
 */
"use strict";
const path = require("path");

const { findBrowser, serve, launch } = require("./helpers/browser.js");

const ROOT = path.join(__dirname, "..");
const LONG_QUESTION = "employment_status"; // 13 options: taller than a phone shows
const SHORT_QUESTION = "recommend_survey"; // two options: nothing to scroll
const DRAFT_KEY = "sault_survey_draft_v1";

let failures = 0;
let checks = 0;
let skipped = 0;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function eq(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

let navSeq = 0;

// ── measuring the real layout ──────────────────────────────────────────────
const MEASURE = `(() => {
  const region = document.querySelector(".q-scroll");
  if (!region) return null;
  const head = document.querySelector(".q-head");
  const card = region.querySelector(".opt");
  const nav = region.querySelector(".q-nav");
  const cs = getComputedStyle(region);
  const after = getComputedStyle(region, "::after");
  const r = region.getBoundingClientRect();
  const padLeft = parseFloat(cs.paddingLeft) || 0;
  const padRight = parseFloat(cs.paddingRight) || 0;
  const box = (n) => {
    if (!n) return null;
    const b = n.getBoundingClientRect();
    return { top: Math.round(b.top), bottom: Math.round(b.bottom), width: Math.round(b.width) };
  };
  const options = [...region.querySelectorAll(".opt")];
  // every rule that mentions a webkit scrollbar, so the older-Chrome and Safari
  // path (which ignores scrollbar-width) is checked too
  const webkitRules = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = [...sheet.cssRules]; } catch (e) { continue; }
    for (const rule of rules) {
      if (rule.cssText && rule.cssText.indexOf("::-webkit-scrollbar") !== -1) webkitRules.push(rule.cssText);
    }
  }
  return {
    region: { top: Math.round(r.top), bottom: Math.round(r.bottom), height: region.clientHeight },
    nav: box(nav),
    scrollTop: Math.round(region.scrollTop),
    scrollHeight: region.scrollHeight,
    clientHeight: region.clientHeight,
    room: region.scrollHeight - region.clientHeight,
    offsetWidth: region.offsetWidth,
    clientWidth: region.clientWidth,
    contentWidth: region.clientWidth - padLeft - padRight,
    cardWidth: card ? Math.round(card.getBoundingClientRect().width) : null,
    optionCount: options.length,
    selected: options.map((o, i) => (o.classList.contains("on") ? i : -1)).filter((i) => i >= 0),
    hasMoreBelow: region.classList.contains("has-more-below"),
    hasMoreAbove: region.classList.contains("has-more-above"),
    scrollbarWidth: cs.scrollbarWidth,
    overflowX: cs.overflowX,
    overflowY: cs.overflowY,
    headScrollbarWidth: head ? getComputedStyle(head).scrollbarWidth : null,
    shadow: {
      content: after.content,
      position: after.position,
      bottom: after.bottom,
      height: after.height,
      pointerEvents: after.pointerEvents,
      background: after.backgroundImage,
    },
    webkitRules,
  };
})()`;

/** Land on a question with a fresh draft, in the language asked for. */
async function openQuestion(page, origin, { width = 390, height = 640, id = LONG_QUESTION, lang = "en" } = {}) {
  navSeq += 1;
  // a unique query forces a real document load; a URL that differs only in its
  // hash would not fire a load event
  await page.goto(`${origin}/index.html?edge=${navSeq}#/`, width, height);
  await page.evaluate(
    "localStorage.clear();" +
      `localStorage.setItem(${JSON.stringify(DRAFT_KEY)}, JSON.stringify({` +
      `answers:{consent:"Yes, I confirm",eligible:"Yes"},currentId:${JSON.stringify(id)}}));` +
      (lang === "en" ? "" : `localStorage.setItem("sault_lang_v1", ${JSON.stringify(lang)});`)
  );
  await page.reload();
  await page.setHash("#/survey");
  await page.evaluate("new Promise((r) => setTimeout(r, 850))");
  return page.evaluate(MEASURE);
}

/** Scroll the way a wheel does, and settle. */
async function scrollTo(page, top) {
  await page.evaluate(`(() => { const r = document.querySelector(".q-scroll"); r.scrollTop = ${top}; })()`);
  await page.evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))");
  return page.evaluate(MEASURE);
}

/**
 * The one checker, run at the end of every case: no scrollbar, nothing reserved
 * for one, and the bottom shadow present exactly while answers lie below the
 * fold — never over a list that fits, never over the arrows at the end.
 */
function assertQuietScroll(m, where) {
  assert(m, where + ": no answer region on screen");
  assert(m.optionCount > 0, where + ": no options on screen");
  eq(m.scrollbarWidth, "none", where + ": the answer list still draws a scrollbar");
  assert(
    m.overflowX === "hidden" || m.overflowX === "clip",
    where + ": the region is a two-axis scroll box again (overflow-x: " + m.overflowX + "), so a long label can bring a sideways bar back"
  );
  eq(m.overflowY, "auto", where + ": the answer list can no longer be scrolled with the wheel");
  eq(m.offsetWidth, m.clientWidth, where + ": space is still reserved for a scrollbar");
  eq(m.cardWidth, m.contentWidth, where + ": the options do not fill the answer region");
  eq(m.headScrollbarWidth, "none", where + ": the question heading still draws a scrollbar");
  assert(
    m.webkitRules.some((t) => t.indexOf(".q-scroll::-webkit-scrollbar") !== -1 && /display:\s*none/.test(t)),
    where + ": nothing hides the scrollbar on browsers that ignore scrollbar-width (older Chrome, Safari)"
  );
  assert(
    m.webkitRules.some((t) => t.indexOf(".q-head::-webkit-scrollbar") !== -1 && /display:\s*none/.test(t)),
    where + ": the heading's scrollbar is only hidden on browsers that understand scrollbar-width"
  );

  if (m.room <= 2) {
    assert(!m.hasMoreBelow, where + ": a shadow sits on a list that fits, with nothing below it");
    eq(m.shadow.content, "none", where + ": a shadow is painted although the whole list is already in view");
    return;
  }
  const moreBelow = m.scrollTop < m.room - 2;
  eq(m.hasMoreBelow, moreBelow, where + `: the bottom shadow does not match the scroll position (${m.scrollTop} of ${m.room})`);
  // only the bottom edge is marked: the pinned question sits directly above the
  // region, so the top of the list never needs to advertise itself
  assert(!m.hasMoreAbove, where + ": a shadow was painted on the top edge, over the gap below the question");
  if (moreBelow) {
    assert(m.shadow.content !== "none", where + ": the list continues below the fold but nothing says so");
    eq(m.shadow.position, "sticky", where + ": the shadow scrolls away with the content instead of riding the edge");
    eq(m.shadow.pointerEvents, "none", where + ": the shadow would swallow a tap on the option under it");
    eq(m.shadow.bottom, "-6px", where + ": the shadow stops short of the region's edge, leaving an unshadowed strip");
    assert(/gradient/.test(m.shadow.background), where + ": the shadow is not a soft gradient");
    assert(parseFloat(m.shadow.height) > 0, where + ": the shadow has no height");
  }
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

    await runAsync("a phone shows the long answer list with no scrollbar and a shadow saying more is below", async () => {
      const where = "phone 390x640";
      const m = await openQuestion(page, site.origin);
      assertQuietScroll(m, where);
      assert(m.optionCount >= 13, where + `: expected the 13 employment options, saw ${m.optionCount}`);
      assert(m.room > 100, where + `: the list only overflows by ${m.room}px, so this case does not reach the shadow`);
      assert(m.hasMoreBelow, where + ": nothing marks the fold while 100+px of answers sit below it");
      assert(!m.hasMoreAbove, where + ": the top edge is shadowed although the list is at its start");
      eq(m.scrollTop, 0, where + ": the list did not start at its first option");
    });

    await runAsync("with no scrollbar, the wheel still scrolls the answers", async () => {
      const where = "wheel 390x640";
      const before = await openQuestion(page, site.origin);
      const point = await page.evaluate(
        `(() => { const b = document.querySelector(".q-scroll").getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`
      );
      await page.send("Input.dispatchMouseEvent", {
        type: "mouseWheel", x: point.x, y: point.y, deltaX: 0, deltaY: 300, pointerType: "mouse",
      });
      await page.evaluate("new Promise((r) => setTimeout(() => requestAnimationFrame(() => r(1)), 150))");
      const after = await page.evaluate(MEASURE);
      assert(after.scrollTop > before.scrollTop, where + ": the wheel no longer scrolls the answer list");
      assertQuietScroll(after, where);
    });

    await runAsync("the shadow rides the edge while scrolling and is gone at the end, so the arrows are never dimmed", async () => {
      const where = "scroll through 390x640";
      const start = await openQuestion(page, site.origin);
      const mid = await scrollTo(page, Math.round(start.room / 2));
      assertQuietScroll(mid, where + " (middle)");
      assert(mid.hasMoreBelow, where + ": mid-list the shadow should still mark the answers below");
      const end = await scrollTo(page, start.scrollHeight);
      assertQuietScroll(end, where + " (end)");
      assert(end.hasMoreBelow === false, where + ": the shadow is still over the arrows at the end of the list");
      eq(end.shadow.content, "none", where + ": the arrows are dimmed by a shadow that should have gone");
      assert(end.nav, where + ": no arrow row in the region");
      assert(
        end.nav.top >= end.region.top && end.nav.bottom <= end.region.bottom,
        where + `: the arrows are not fully in view at the end (${end.nav.top}-${end.nav.bottom} in ${end.region.top}-${end.region.bottom})`
      );
    });

    await runAsync("a desktop window gets the same quiet edge, and the shadow costs no layout", async () => {
      const where = "desktop 1280x800";
      const m = await openQuestion(page, site.origin, { width: 1280, height: 800 });
      assertQuietScroll(m, where);
      assert(m.room > 0, where + ": the long list does not overflow on a desktop window");
      // the shadow is paint only: switching it off must not resize the list or
      // move its scroll range, or a wheel would jog when the edge changes
      const withoutShadow = await page.evaluate(`(() => {
        const r = document.querySelector(".q-scroll");
        r.classList.remove("has-more-below");
        const img = getComputedStyle(r, "::after").content;
        const after = { scrollHeight: r.scrollHeight, clientHeight: r.clientHeight, scrollTop: r.scrollTop,
          cardWidth: Math.round(r.querySelector(".opt").getBoundingClientRect().width), content: img };
        r.classList.add("has-more-below");
        return after;
      })()`);
      eq(withoutShadow.content, "none", where + ": the shadow stayed painted after its class was removed");
      eq(withoutShadow.scrollHeight, m.scrollHeight, where + ": the shadow changes the list's scroll height");
      eq(withoutShadow.clientHeight, m.clientHeight, where + ": the shadow changes how much of the list fits");
      eq(withoutShadow.cardWidth, m.cardWidth, where + ": turning the shadow off resizes the options");
      const restored = await page.evaluate(MEASURE);
      assertQuietScroll(restored, where + " (restored)");
    });

    await runAsync("a tap on the option under the shadow still answers the question", async () => {
      const where = "tap through the shadow 390x640";
      const start = await openQuestion(page, site.origin);
      await scrollTo(page, 60);
      const hit = await page.evaluate(`(() => {
        const r = document.querySelector(".q-scroll").getBoundingClientRect();
        const opts = [...document.querySelectorAll(".q-scroll .opt")];
        // a point inside the shadow band at the bottom edge of the region
        const x = Math.round(r.left + r.width / 2);
        const y = Math.round(r.bottom - 10);
        const node = document.elementFromPoint(x, y);
        const card = node && node.closest ? node.closest(".opt") : null;
        return { x, y, found: !!card, index: card ? opts.indexOf(card) : -1,
          shadowed: document.querySelector(".q-scroll").classList.contains("has-more-below") };
      })()`);
      assert(hit.shadowed, where + ": the shadow is not on at this scroll position, so the tap proves nothing");
      assert(hit.found, where + ": nothing clickable under the shadow at (" + hit.x + "," + hit.y + ") — the shadow blocks the option");
      await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: hit.x, y: hit.y, button: "left", clickCount: 1 });
      await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: hit.x, y: hit.y, button: "left", clickCount: 1 });
      await page.evaluate("new Promise((r) => setTimeout(() => requestAnimationFrame(() => r(1)), 150))");
      const after = await page.evaluate(MEASURE);
      assert(
        after.selected.indexOf(hit.index) !== -1,
        where + `: the option under the shadow (index ${hit.index}) was not selected; selected: ${JSON.stringify(after.selected)}`
      );
      assertQuietScroll(after, where);
    });

    await runAsync("a list that fits shows no shadow at all", async () => {
      const where = "two options 390x640";
      const m = await openQuestion(page, site.origin, { id: SHORT_QUESTION });
      assertQuietScroll(m, where);
      assert(m.optionCount <= 3, where + `: expected the short question, saw ${m.optionCount} options`);
      assert(m.room <= 2, where + `: the short list unexpectedly overflows by ${m.room}px`);
      assert(!m.hasMoreBelow, where + ": the fold is marked although everything fits");
      eq(m.shadow.content, "none", where + ": a shadow is painted although everything fits");
    });

    await runAsync("Arabic (right to left) keeps the same quiet edge", async () => {
      const where = "Arabic 390x640";
      const m = await openQuestion(page, site.origin, { lang: "ar" });
      eq(await page.evaluate("document.documentElement.getAttribute('dir')"), "rtl", where + ": the page did not switch to right-to-left");
      assertQuietScroll(m, where);
      assert(m.hasMoreBelow, where + ": the fold is not marked in Arabic");
      const scrolled = await scrollTo(page, 120);
      assertQuietScroll(scrolled, where + " (scrolled)");
      assert(scrolled.scrollTop > 0, where + ": the answers did not scroll in Arabic");
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
      console.log("1 check skipped: the scroll edge was not measured (no browser).");
      return;
    }
    console.log(`${checks} checks passed: the answer list scrolls with no scrollbar and marks the fold instead.`);
  })
  .catch((err) => {
    console.error("\n" + (err && err.stack ? err.stack : err) + "\n");
    process.exit(1);
  });
