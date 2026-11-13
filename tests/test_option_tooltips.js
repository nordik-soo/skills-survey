#!/usr/bin/env node
/**
 * Option tooltips must be visible, wherever the row sits in the answer list.
 *
 * The tip opens upward by default (`bottom: calc(100% + 8px)`), but the answers
 * live in .q-scroll, a clipped scroll box with no padding at the top. For a row
 * at the top of that box — always the first option, and any row scrolled up
 * there — the tip landed above the box and was clipped away entirely: computed
 * opacity 1, `:hover` matched, but zero visible pixels. Options further down had
 * their own rows above them for clearance, which is why every other tooltip
 * looked fine.
 *
 * The app now measures the room on each side before showing a tip (placeTip in
 * app.js) and opens it below the row when there is no room above. These checks
 * read the real layout: they serve the project over http, drive Chrome/Edge
 * headless, hover the real "?" with the mouse, and compare the tip's rectangle
 * with the visible answer region.
 *
 * Run: node tests/test_option_tooltips.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const { findBrowser, serve, launch } = require("./helpers/browser.js");

const ROOT = path.join(__dirname, "..");

let failures = 0;
let checks = 0;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function eq(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

let navSeq = 0;

// ── in-page measurement ────────────────────────────────────────────────────
// For one ".opt-help" (the "?" badge) on the current question: where its tip
// lands, and how much of it is inside the visible answer region.
const TIP_STATE = (idx) => `(() => {
  const helps = [...document.querySelectorAll(".q-scroll .opt-help")];
  const h = helps[${idx}];
  if (!h) return null;
  const tip = h.querySelector(".opt-tip");
  if (!tip) return null;
  const tb = tip.getBoundingClientRect();
  const hb = h.getBoundingClientRect();
  const region = h.closest(".q-scroll");
  const rb = region.getBoundingClientRect();
  const visible = Math.max(0, Math.min(tb.bottom, rb.bottom) - Math.max(tb.top, rb.top));
  const cs = getComputedStyle(tip);
  return {
    opacity: Number(cs.opacity),
    visibility: cs.visibility,
    tipTop: Math.round(tb.top),
    tipBottom: Math.round(tb.bottom),
    tipHeight: Math.round(tb.height),
    rowTop: Math.round(hb.top),
    rowBottom: Math.round(hb.bottom),
    regionTop: Math.round(rb.top),
    regionBottom: Math.round(rb.bottom),
    visiblePx: Math.round(visible),
    opensBelow: Math.round(tb.top) >= Math.round(hb.bottom) - 1,
    text: (tip.textContent || "").trim(),
    count: helps.length,
  };
})()`;

/** The pointer position over a tooltip badge, in viewport pixels. */
const HELP_POINT = (idx) => `(() => {
  const h = [...document.querySelectorAll(".q-scroll .opt-help")][${idx}];
  if (!h) return null;
  h.scrollIntoView({ block: "nearest" });
  const b = h.getBoundingClientRect();
  return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
})()`;

async function hoverHelp(page, idx) {
  const p = await page.evaluate(HELP_POINT(idx));
  assert(p, "no tooltip badge at index " + idx);
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y, pointerType: "mouse" });
  await page.evaluate("new Promise((r) => setTimeout(r, 220))");
  return page.evaluate(TIP_STATE(idx));
}

async function tapHelp(page, idx) {
  const p = await page.evaluate(HELP_POINT(idx));
  assert(p, "no tooltip badge at index " + idx);
  for (const type of ["mousePressed", "mouseReleased"]) {
    await page.send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", clickCount: 1, pointerType: "mouse" });
  }
  await page.evaluate("new Promise((r) => setTimeout(r, 220))");
  const state = await page.evaluate(TIP_STATE(idx));
  const open = await page.evaluate(`(() => {
    const h = [...document.querySelectorAll(".q-scroll .opt-help")][${idx}];
    return h ? h.classList.contains("tip-open") : null;
  })()`);
  return Object.assign(state, { openClass: open });
}

async function moveAway(page) {
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2, pointerType: "mouse" });
  await page.evaluate("new Promise((r) => setTimeout(r, 200))");
}

/** The one checker: a shown tip is on screen, whole, and inside the region. */
function assertTipVisible(m, where) {
  assert(m, where + ": no tooltip badge found");
  assert(m.text.length > 3, where + ": the tooltip has no text");
  eq(m.opacity, 1, where + ": the tooltip is not shown (opacity)");
  eq(m.visibility, "visible", where + ": the tooltip is hidden (visibility)");
  assert(m.tipHeight > 0, where + ": the tooltip has no height");
  assert(
    m.visiblePx >= m.tipHeight - 1,
    where + `: only ${m.visiblePx} of ${m.tipHeight}px of the tooltip is inside the answer area (tip ${m.tipTop}-${m.tipBottom}, area ${m.regionTop}-${m.regionBottom})`
  );
  assert(m.opacity === 1 && m.visiblePx >= m.tipHeight - 1, where + ": the tooltip is not readable");
}

// ── navigation ─────────────────────────────────────────────────────────────
// Answer the current question the way a respondent would, then press Next.
const ANSWER_AND_ADVANCE = `(() => {
  const opt = document.querySelector(".q-scroll .opt");
  if (opt) { opt.click(); return true; }
  const trigger = document.querySelector(".q-scroll .custom-select-trigger");
  if (trigger) {
    trigger.click();
    const o = document.querySelector(".custom-select-option");
    if (o) o.click();
    return true;
  }
  const field = document.querySelector(".q-scroll textarea, .q-scroll input[type=text], .q-scroll input[type=email]");
  if (field) {
    field.focus();
    field.value = "test";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }
  return false;
})()`;

const PRESS_NEXT = `(() => {
  const b = [...document.querySelectorAll(".q-nav .btn-nav-arrow")].pop();
  if (!b || b.disabled) return false;
  b.click();
  return true;
})()`;

const FIRST_OPTION_HAS_TIP = `(() => {
  const first = document.querySelectorAll(".q-scroll .opt")[0];
  return !!(first && first.querySelector(".opt-help"));
})()`;

/** Walk the survey until a question whose first option carries a tooltip. */
async function reachTooltipQuestion(page, origin) {
  navSeq += 1;
  await page.goto(`${origin}/index.html?tips=${navSeq}#/`, 390, 900);
  await page.evaluate("localStorage.clear()");
  await page.reload();
  await page.setHash("#/survey");
  await page.evaluate("new Promise((r) => setTimeout(r, 800))");
  for (let step = 0; step < 30; step++) {
    if (await page.evaluate(FIRST_OPTION_HAS_TIP)) {
      // several tooltipped rows, so "opens upward" can be checked on a later one
      if ((await page.evaluate(`document.querySelectorAll(".q-scroll .opt-help").length`)) >= 3) return step;
      throw new Error("reached a question with too few tooltips to check both placements");
    }
    assert(await page.evaluate(ANSWER_AND_ADVANCE), "could not answer the question at step " + step);
    await page.evaluate("new Promise((r) => setTimeout(r, 140))");
    assert(await page.evaluate(PRESS_NEXT), "could not advance past step " + step);
    await page.evaluate("new Promise((r) => setTimeout(r, 460))");
  }
  throw new Error("no question with a tooltip on its first option was reached");
}

async function resize(page, width, height) {
  await page.send("Emulation.setDeviceMetricsOverride", {
    width, height, deviceScaleFactor: 1, mobile: false,
  });
  await page.evaluate("new Promise((r) => setTimeout(r, 260))");
}

async function run() {
  const exe = findBrowser();
  if (!exe) {
    console.log("  skip  no Chrome or Edge found to measure the layout with (set CHROME_BIN to point at one)");
    return;
  }

  // Both places that build a "?" badge must use the placement helper, otherwise
  // the rating rows (skills) keep the clipped upward tip.
  const JS = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  const wired = (JS.match(/addEventListener\("mouseenter",\s*\(\)\s*=>\s*placeTip\(/g) || []).length;
  checks++;
  if (wired < 2) {
    failures++;
    console.log(`  x   both tooltip builds choose a side before showing: only ${wired} of 2 build sites use placeTip (option rows and rating rows)`);
  } else {
    console.log("  ok  both tooltip builds choose a side before showing");
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

    const step = await reachTooltipQuestion(page, site.origin);
    const question = await page.evaluate(`document.querySelector(".q-text").textContent.trim()`);
    console.log(`  ..  checking "${question.slice(0, 48)}…" (reached in ${step} steps)`);

    await runAsync("the first option's tooltip shows on hover on a tall phone", async () => {
      await resize(page, 390, 900);
      const m = await hoverHelp(page, 0);
      assertTipVisible(m, "first option 390x900");
      // the row is at the top of the list: the tip had to move below it
      assert(m.opensBelow, "first option 390x900: the tip still opens upward, where the region clips it");
    });

    await runAsync("the first option's tooltip shows on a short screen", async () => {
      await resize(page, 390, 430);
      const m = await hoverHelp(page, 0);
      assertTipVisible(m, "first option 390x430");
      assert(m.opensBelow, "first option 390x430: the tip still opens upward, where the region clips it");
    });

    await runAsync("the first option's tooltip shows on a desktop window", async () => {
      await resize(page, 1280, 800);
      const m = await hoverHelp(page, 0);
      assertTipVisible(m, "first option 1280x800");
      assert(m.opensBelow, "first option 1280x800: the tip still opens upward, where the region clips it");
    });

    await runAsync("a lower option keeps opening its tooltip upward and stays whole", async () => {
      await resize(page, 390, 900);
      const m = await hoverHelp(page, 2);
      assertTipVisible(m, "third tooltipped row 390x900");
      assert(m.opensBelow === false, "third tooltipped row 390x900: the tip was flipped below although there is room above");
    });

    await runAsync("a row scrolled to the top of the list still shows its tooltip", async () => {
      await resize(page, 390, 430);
      // the region is shorter than the list here, so it really scrolls
      const info = await page.evaluate(`(() => {
        const region = document.querySelector(".q-scroll");
        const rows = [...region.querySelectorAll(".opt")].filter((o) => o.querySelector(".opt-help"));
        const row = rows[3];
        const rb = region.getBoundingClientRect();
        region.scrollTop += Math.round(row.getBoundingClientRect().top - rb.top);
        return { scrollable: region.scrollHeight > region.clientHeight + 1, scrollTop: Math.round(region.scrollTop) };
      })()`);
      await page.evaluate("new Promise((r) => setTimeout(r, 260))");
      assert(info.scrollable, "the answer region does not scroll, so the scrolled case cannot be checked");
      assert(info.scrollTop > 0, "the answer region did not scroll");
      const m = await hoverHelp(page, 3);
      assertTipVisible(m, "scrolled row 390x430");
      assert(m.opensBelow, "scrolled row 390x430: the tip still opens upward, past the top of the region");
    });

    await runAsync("tapping the ? shows the tooltip, and tapping again closes it", async () => {
      await resize(page, 390, 430);
      await page.evaluate(`(() => { document.querySelector(".q-scroll").scrollTop = 0; })()`);
      await page.evaluate("new Promise((r) => setTimeout(r, 200))");
      const m = await tapHelp(page, 0);
      assertTipVisible(m, "tap first option 390x430");
      eq(m.openClass, true, "tap first option 390x430: the tooltip was not opened");
      const closed = await tapHelp(page, 0);
      eq(closed.openClass, false, "tap again: the tooltip did not close");
      // the pointer is still on the badge, so only a move away can show it is shut
      await moveAway(page);
      const after = await page.evaluate(TIP_STATE(0));
      eq(after.opacity, 0, "tap again: the tooltip is still shown after the pointer left");
    });

    await runAsync("hovering a tooltip does not change the answer or the question", async () => {
      await resize(page, 390, 900);
      // a tip opened by a tap stays open by design; close it so the baseline is clean
      const stuck = await page.evaluate(`(() => {
        const open = [...document.querySelectorAll(".q-scroll .opt-help.tip-open")];
        open.forEach((h) => h.classList.remove("tip-open"));
        return open.length;
      })()`);
      const before = await page.evaluate(`(() => ({
        selected: document.querySelectorAll(".q-scroll .opt.on").length,
        tips: document.querySelectorAll(".q-scroll .opt-tip").length,
        question: document.querySelector(".q-text").textContent.trim(),
        open: document.querySelectorAll(".q-scroll .opt-help.tip-open").length,
      }))()`);
      await moveAway(page);
      await hoverHelp(page, 0);
      await hoverHelp(page, 2);
      await moveAway(page);
      const after = await page.evaluate(`(() => ({
        selected: document.querySelectorAll(".q-scroll .opt.on").length,
        tips: document.querySelectorAll(".q-scroll .opt-tip").length,
        question: document.querySelector(".q-text").textContent.trim(),
        open: document.querySelectorAll(".q-scroll .opt-help.tip-open").length,
        remainingVisible: [...document.querySelectorAll(".q-scroll .opt-tip")]
          .filter((t) => Number(getComputedStyle(t).opacity) === 1).length,
      }))()`);
      eq(after.selected, before.selected, "hovering a tooltip selected an option");
      eq(after.tips, before.tips, "the tooltip count changed on hover");
      eq(after.question, before.question, "the question changed on hover");
      eq(after.open, 0, "a tooltip stayed open after the pointer left");
      eq(after.remainingVisible, 0, "a tooltip is still visible after the pointer left");
    });
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
    console.log(`${checks} checks passed: option tooltips are shown whole wherever the row sits.`);
  })
  .catch((err) => {
    console.error("\n" + (err && err.stack ? err.stack : err) + "\n");
    process.exit(1);
  });
