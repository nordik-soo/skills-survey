#!/usr/bin/env node
/**
 * The left and right arrows sit on small green cards.
 *
 * The arrows are white block glyphs. Before this, their backing could be the
 * photo, the paper or a panel, so the glyph had to be defended with a dark halo
 * and still read poorly on bright patches. Each arrow now has its own solid
 * green card, which gives the white a known, darker backing (white on the
 * signal green is ~5.3:1).
 *
 * Two rules have to hold, and both are easy to break by accident:
 *   - the card is the survey's own row metric — 40px tall and a 7px radius,
 *     exactly what the option and rating cards use — so the pair at the bottom
 *     belongs to the same family of surfaces as the answers above it, and does
 *     not tower over them;
 *   - both cards are the same small rectangle, in every language and both
 *     directions, and an unavailable arrow keeps its card (the pair still looks
 *     like a pair) while its glyph steps back;
 *   - the pair travels with the answers: it is the last thing in the scrolling
 *     answer region, one row under the last option, so a short list does not
 *     leave a band of empty space above it (see test_pinned_question.js).
 *
 * The fake DOM used by the rest of the suite has no layout or cascade, so this
 * file measures the real thing in the Chrome/Edge already on the machine. When
 * no browser is installed the checks are reported as skipped and the file still
 * exits 0.
 *
 * Run: node tests/test_nav_arrow_cards.js
 */
"use strict";
const path = require("path");

const { findBrowser, serve, launch } = require("./helpers/browser.js");

const ROOT = path.join(__dirname, "..");
const DRAFT_KEY = "sault_survey_draft_v1";
const LANG_KEY = "sault_lang_v1";
const QUESTION = "employment_status";

// the row metric the survey's cards share (.opt and .rate-row both use it)
const CARD_HEIGHT = 40;
const CARD_RADIUS = "7px";
// The arrows are the last thing in the answer region, so the space above them
// is the survey's own row spacing (14px). Anything wider means the block is
// stretching again and pushing them away from the answers.
const MAX_ROW_GAP = 24;

let failures = 0;
let checks = 0;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function eq(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function near(actual, expected, msg) {
  if (Math.abs(actual - expected) > 1) {
    throw new Error(`${msg}: expected ${expected} (±1px), got ${actual}`);
  }
}

let navSeq = 0;

// ── measurement inside the page ────────────────────────────────────────────
// Colours are compared against the stylesheet's own value for --green-deep, so
// the check follows the palette instead of pinning a hex code here.
const MEASURE = `(() => {
  const box = (n) => {
    if (!n) return null;
    const b = n.getBoundingClientRect();
    return {
      top: Math.round(b.top), bottom: Math.round(b.bottom),
      left: Math.round(b.left), right: Math.round(b.right),
      width: Math.round(b.width), height: Math.round(b.height),
    };
  };
  const rootStyle = getComputedStyle(document.documentElement);
  const arrows = [...document.querySelectorAll(".q-nav .btn-nav-arrow")];
  const opt = document.querySelector(".q-scroll .opt");
  const rateRow = document.querySelector(".rate-row");
  const nav = document.querySelector(".q-nav");
  const region = document.querySelector(".q-scroll");
  const opts = [...document.querySelectorAll(".q-scroll .opt")];
  const lastOpt = opts.length ? opts[opts.length - 1] : null;
  return {
    greenDeep: rootStyle.getPropertyValue("--green-deep").trim(),
    arrows: arrows.map((a) => {
      const cs = getComputedStyle(a);
      const svg = a.querySelector("svg");
      return {
        card: box(a),
        svg: box(svg),
        background: cs.backgroundColor,
        color: cs.color,
        radius: cs.borderTopLeftRadius,
        disabled: a.disabled,
        label: a.getAttribute("aria-label") || "",
        svgTransform: svg ? getComputedStyle(svg).transform : "",
        // SVG elements report their tag name in the source case, so normalise
        ink: svg ? String((svg.querySelector("path") || {}).tagName || "").toLowerCase() : "",
      };
    }),
    nav: box(nav),
    navBackground: nav ? getComputedStyle(nav).backgroundColor : "",
    option: opt ? Object.assign(box(opt), { radius: getComputedStyle(opt).borderTopLeftRadius, minHeight: getComputedStyle(opt).minHeight }) : null,
    rateRow: rateRow ? Object.assign(box(rateRow), { radius: getComputedStyle(rateRow).borderTopLeftRadius }) : null,
    region: box(region),
    // the arrows travel with the answers: inside the region, under the last option
    navInRegion: !!(region && nav && region.contains(nav)),
    navIsScreenChild: !!(nav && nav.parentElement && nav.parentElement.matches(".survey-wrap")),
    lastOption: box(lastOpt),
    gapToLastOption: (nav && lastOpt) ? Math.round(nav.getBoundingClientRect().top - lastOpt.getBoundingClientRect().bottom) : null,
    regionScrollable: region ? region.scrollHeight > region.clientHeight + 1 : false,
    viewportHeight: window.innerHeight,
    pageScrollY: Math.round(window.scrollY),
    direction: document.documentElement.getAttribute("dir") || "ltr",
  };
})()`;

/** Land on the long question, optionally with the back arrow unavailable. */
async function open(page, origin, { lang = "en", width = 390, height = 640, first = false, id = QUESTION } = {}) {
  navSeq += 1;
  await page.goto(`${origin}/index.html?nav=${navSeq}#/`, width, height);
  // the first question has no previous page, so its back arrow is disabled
  const answers = first ? { consent: "Yes, I confirm", eligible: "Yes" } : { consent: "Yes, I confirm", eligible: "Yes" };
  await page.evaluate(
    "localStorage.clear();" +
    `localStorage.setItem(${JSON.stringify(DRAFT_KEY)}, JSON.stringify({` +
    `answers:${JSON.stringify(answers)},currentId:${JSON.stringify(first ? "consent" : id)}}));` +
    (lang === "en" ? "" : `localStorage.setItem(${JSON.stringify(LANG_KEY)}, ${JSON.stringify(lang)});`)
  );
  await page.reload();
  await page.setHash("#/survey");
  // the question block rises in over 500ms; measure once it has settled
  await page.evaluate("new Promise((r) => setTimeout(r, 850))");
  return page.evaluate(MEASURE);
}

/** rgb() of a paint, for comparing two computed colours. */
function rgba(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

/**
 * The rules that must hold for the arrow cards on every screen, in every
 * language: two identical small green rectangles, the survey's own row height,
 * with a white glyph centred in each.
 */
function assertCards(m, where) {
  eq(m.arrows.length, 2, where + ": expected a left and a right arrow");
  const green = rgba(m.greenDeep);
  assert(green, where + `: no --green-deep to compare against (got ${JSON.stringify(m.greenDeep)})`);

  for (const [i, a] of m.arrows.entries()) {
    const side = i === 0 ? "left" : "right";
    assert(a.card, where + `: the ${side} arrow has no card`);
    assert(a.svg, where + `: the ${side} arrow has no glyph`);
    eq(a.card.height, CARD_HEIGHT, where + `: the ${side} card is not the survey's row height`);

    // a small rectangle, not a slab: shorter than it is wide, and no taller
    // than a row
    assert(
      a.card.width > a.card.height && a.card.height <= CARD_HEIGHT,
      where + `: the ${side} card is not a small rectangle (${a.card.width}x${a.card.height})`
    );
    assert(
      a.card.width <= 56,
      where + `: the ${side} card is too wide (${a.card.width}px)`
    );

    // green face, white glyph
    eq(a.background, green, where + `: the ${side} card is not the signal green`);
    eq(a.color, "rgb(255, 255, 255)", where + `: the ${side} arrow is not white`);
    eq(a.radius, CARD_RADIUS, where + `: the ${side} card radius does not match the option cards`);
    eq(a.ink, "path", where + `: the ${side} arrow is not the filled block glyph`);

    // the glyph sits in the middle of its card
    near((a.svg.top + a.svg.bottom) / 2, (a.card.top + a.card.bottom) / 2, where + `: the ${side} arrow is not centred vertically`);
    near((a.svg.left + a.svg.right) / 2, (a.card.left + a.card.right) / 2, where + `: the ${side} arrow is not centred horizontally`);

    // and it stays inside the card
    assert(
      a.svg.left >= a.card.left && a.svg.right <= a.card.right && a.svg.top >= a.card.top && a.svg.bottom <= a.card.bottom,
      where + `: the ${side} arrow spills out of its card`
    );
  }

  // the pair is one pair: same size, same face, opposite ends of the row
  eq(m.arrows[0].card.width, m.arrows[1].card.width, where + ": the two cards are not the same width");
  eq(m.arrows[0].card.height, m.arrows[1].card.height, where + ": the two cards are not the same height");
  // the row mirrors in RTL (documentElement[dir=rtl]), so the back arrow is on
  // the right there and on the left in every LTR language — either way the two
  // cards sit at opposite ends and never overlap
  const [back, next] = [m.arrows[0].card, m.arrows[1].card];
  if (m.direction === "rtl") {
    assert(back.left > next.left, where + ": the back card is not mirrored to the right in RTL");
  } else {
    assert(back.left < next.left, where + ": the back card is not on the left");
  }
  assert(
    next.right <= back.left || back.right <= next.left,
    where + `: the two cards overlap (${JSON.stringify([back, next])})`
  );

  // the row itself carries no card of its own: the green belongs to the arrows
  assert(
    m.navBackground === "rgba(0, 0, 0, 0)",
    where + `: the whole arrow row is painted (${m.navBackground}), so the pair is one long strip again`
  );
  assert(
    m.nav.height <= CARD_HEIGHT + 4,
    where + `: the arrow row is ${m.nav.height}px tall around ${CARD_HEIGHT}px cards`
  );

  // the cards are the survey's own metrics, side by side with the answers
  if (m.option) {
    eq(m.option.radius, CARD_RADIUS, where + ": the option cards changed radius, so the arrow card can no longer match them");
    eq(m.option.minHeight, CARD_HEIGHT + "px", where + ": the option cards changed row height, so the arrow card can no longer match them");
  }
  if (m.rateRow) {
    eq(m.rateRow.radius, CARD_RADIUS, where + ": the rating rows changed radius, so the arrow card can no longer match them");
  }

  eq(m.pageScrollY, 0, where + ": the page scrolled");

  // The cards belong to the answer list, not to the bottom of the screen: they
  // are the last thing in the scrolling answer region, one row under the last
  // option. While they lived outside it, the question block stretched and
  // pushed them to the viewport floor — 197px below a two-option list.
  assert(
    m.navInRegion,
    where + ": the arrow row left the answer region, so it is pinned to the screen again"
  );
  assert(
    !m.navIsScreenChild,
    where + ": the arrow row is a sibling of the question block again, so a stretched block can push it away from the answers"
  );
  assert(m.lastOption, where + ": no last option for the cards to sit under");
  assert(
    m.nav.top >= m.lastOption.bottom - 1,
    where + `: the cards overlap the last option (cards start at ${m.nav.top}, option ends at ${m.lastOption.bottom})`
  );
  assert(
    m.gapToLastOption <= MAX_ROW_GAP,
    where + `: a ${m.gapToLastOption}px band of empty space sits between the last option and the cards (a row gap is ${MAX_ROW_GAP}px at most)`
  );
}

/** Nothing else on the screen was disturbed by the cards. */
function assertPageIntact(m, where) {
  assert(m.region, where + ": no answer region");
  assert(m.region.height > 0, where + ": the answer region has no height");
  assert(m.nav, where + ": no arrow row");
}

const CASES = [
  { name: "on a phone", width: 390, height: 640 },
  { name: "on a small phone", width: 360, height: 560 },
  { name: "on a desktop window", width: 1280, height: 800 },
];

async function run() {
  const exe = findBrowser();
  if (!exe) {
    console.log("  skip  no Chrome or Edge found to measure the arrow cards with (set CHROME_BIN to point at one)");
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

    for (const c of CASES) {
      await runAsync(`each arrow sits on a small green card ${c.name}`, async () => {
        const where = `${c.name} ${c.width}x${c.height}`;
        const m = await open(page, site.origin, { width: c.width, height: c.height });
        assertPageIntact(m, where);
        assertCards(m, where);
      });
    }

    await runAsync("the cards sit directly under the last option, not at the bottom of the screen", async () => {
      const where = "two options 390x640";
      const m = await open(page, site.origin, { width: 390, height: 640, id: "recommend_survey" });
      assertCards(m, where);
      // a short list leaves the cards right below it; the empty space under
      // them belongs to the page, not to a band between answers and cards
      assert(
        m.nav.bottom <= m.viewportHeight,
        where + `: the cards are below the screen (${m.nav.bottom} > ${m.viewportHeight})`
      );
      assert(
        m.viewportHeight - m.nav.bottom > 60,
        where + `: the cards are pinned to the bottom of the screen again (ending at ${m.nav.bottom} of ${m.viewportHeight})`
      );
    });

    await runAsync("on a long list the cards wait at the end of the answers and come into view", async () => {
      const where = "13 options 390x640";
      const m = await open(page, site.origin, { width: 390, height: 640 });
      assertCards(m, where);
      assert(m.regionScrollable, where + ": the long list does not scroll, so the cards at its end cannot be reached");
      assert(
        m.nav.bottom > m.viewportHeight,
        where + `: the cards should sit at the end of the answers, below the fold (${m.nav.bottom} <= ${m.viewportHeight})`
      );
      await page.evaluate(`(() => { const r = document.querySelector(".q-scroll"); r.scrollTop = r.scrollHeight; })()`);
      await page.evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))");
      const after = await page.evaluate(MEASURE);
      assert(
        after.nav.bottom <= after.viewportHeight,
        where + `: the cards never come into view (${after.nav.bottom} > ${after.viewportHeight})`
      );
      assert(
        after.gapToLastOption <= MAX_ROW_GAP,
        where + `: a ${after.gapToLastOption}px band opened between the last option and the cards`
      );
    });

    await runAsync("an unavailable arrow keeps its card and only dims its glyph", async () => {
      const where = "first question, back arrow disabled";
      const m = await open(page, site.origin, { width: 390, height: 640, first: true });
      assertPageIntact(m, where);
      assert(m.arrows.length === 2, where + ": expected both arrows on the consent step");
      const back = m.arrows[0];
      assert(back.disabled, where + ": the first question should start with the back arrow unavailable");
      // the card is still the card: same green, same size, so the pair still matches
      eq(back.background, rgba(m.greenDeep), where + ": the disabled arrow lost its green card");
      eq(back.card.height, CARD_HEIGHT, where + ": the disabled card is a different height");
      eq(back.card.width, m.arrows[1].card.width, where + ": the disabled card is a different width");
      // only the glyph steps back
      assert(back.color !== "rgb(255, 255, 255)", where + ": the disabled glyph is as bright as the available one");
      eq(m.arrows[1].color, "rgb(255, 255, 255)", where + ": the available arrow is not white");
    });

    await runAsync("Arabic mirrors the cards and still gives each one a glyph", async () => {
      const where = "Arabic 390x640";
      const m = await open(page, site.origin, { width: 390, height: 640, lang: "ar" });
      assertPageIntact(m, where);
      eq(m.direction, "rtl", where + ": the page did not switch to right-to-left");
      assertCards(m, where);
      // the mirrored glyph is the same shape flipped, which still fills the card
      for (const [i, a] of m.arrows.entries()) {
        eq(a.ink, "path", where + `: arrow ${i} has no block glyph in RTL`);
      }
    });

    await runAsync("every other language renders the same cards", async () => {
      for (const lang of ["fr", "hi", "zh"]) {
        const where = `${lang} 390x640`;
        const m = await open(page, site.origin, { width: 390, height: 640, lang });
        assertPageIntact(m, where);
        assertCards(m, where);
      }
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
      console.log("1 check skipped: the arrow cards were not measured (no browser).");
      return;
    }
    console.log(`${checks} checks passed: each arrow sits on its own small green card.`);
  })
  .catch((err) => {
    console.error("\n" + (err && err.stack ? err.stack : err) + "\n");
    process.exit(1);
  });
