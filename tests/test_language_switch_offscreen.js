"use strict";
// A language switch must never touch the survey while the survey is not the screen
// on display.
//
// `setLanguage()` used to end with `if (answers && answers.consent !== undefined ||
// currentId) renderSurvey();`. That condition is always true (`currentId` always
// holds a string, and a returning visitor's draft overwrites it at boot), so
// choosing a language on the HOMEPAGE also re-rendered the hidden survey. Rendering
// a screen nobody could see was harmless by itself, but renderSurvey() carries side
// effects that act on the visible page and on the data:
//
//   1. it calls syncLangPicker(q), which hides the header's language card from
//      "Where have you moved from?" onward — so the card vanished from the homepage
//      for any visitor whose saved draft sat on that question or later;
//   2. it calls startMotivation(q) for the drafted question on the HP2 arm, and
//      nothing cancels that timer (cancelling happens on navigating, and no
//      navigation happened), so the motivation card floated over the homepage once
//      that question's pre-test median elapsed;
//   3. it calls timing.enter(q.id), starting that question's clock, so time spent on
//      the homepage was charged to the question.
//
// The first four checks cover the homepage side of the rule, in both arms. The last
// three are there to keep the guard from going too far: a switch on the survey
// screen must still translate the question, the language card must still hide on
// the one question it hides on, and a respondent who genuinely lingers on a
// question must still get the motivation card. That last check is also the positive
// control for the first: same seed, same question, card appears — so "no card on the
// homepage" means something.

const path = require("node:path");
const { findBrowser, serve, launch } = require("./helpers/browser.js");

const ROOT = path.resolve(__dirname, "..");
const LANGS = ["en", "es", "fr", "hi", "it", "pt", "ar", "zh", "tl"];
const ARMS = ["HP1", "HP2"];
const HIDDEN_ON = "moved_from";   // the question the header's language card hides from
const TIMED = "gender";           // early, unconditional; MOTIV_THRESHOLDS.gender = 7100ms
const MOTIV_MEDIAN = 7100;        // as measured in app.js (ms)
const PAST_MEDIAN = MOTIV_MEDIAN + 800; // long enough for the card to have appeared
const BACK = { consent: "Yes, I confirm", eligible: "Yes" }; // a draft past the gates

let checks = 0;
function assert(ok, msg) {
  if (!ok) throw new Error(msg);
  checks++;
}
function eq(actual, expected, msg) {
  assert(actual === expected, `${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// Seed a returning visitor — a sticky homepage arm plus a draft parked on `draftId`
// — and reload so the app boots with that state. localStorage is read at startup,
// before the language is restored, which is what a real return visit looks like.
const SEED = (arm, draftId) => `(() => {
  localStorage.clear();
  localStorage.setItem("sault_home_variant_v1", ${JSON.stringify(arm)});
  localStorage.setItem("sault_survey_draft_v1", JSON.stringify({
    answers: ${JSON.stringify(BACK)},
    currentId: ${JSON.stringify(draftId)},
    respondentId: null,
    timings: {},
  }));
  return 1;
})()`;

async function bootHome(page, origin, arm, draftId, tag) {
  await page.goto(origin + "/index.html?case=" + encodeURIComponent(tag) + "#/", 1280, 900);
  await page.evaluate(SEED(arm, draftId));
  await page.reload();
  await page.evaluate("document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 250)))");
}

// Choose a language the way a visitor does: open the header pill, click the entry.
const PICK = (code) => `(() => {
  const btn = document.querySelector("#lang-btn");
  if (!btn) return "no language button in the header";
  btn.click();
  const item = Array.prototype.slice.call(document.querySelectorAll(".lang-menu .lang-item"))
    .filter((n) => n.getAttribute("lang") === ${JSON.stringify(code)})[0];
  if (!item) return "no " + ${JSON.stringify(code)} + " in the language list";
  item.click();
  return "";
})()`;

const STATE = `(() => {
  const picker = document.querySelector("#lang-picker");
  const card = document.getElementById("motiv-card");
  const active = document.querySelector(".view.active");
  const r = card ? card.getBoundingClientRect() : null;
  let timings = {};
  try { timings = (JSON.parse(localStorage.getItem("sault_survey_draft_v1") || "{}").timings) || {}; } catch (e) {}
  return {
    screen: active ? active.id : null,
    hash: location.hash,
    lang: document.documentElement.lang,
    dir: document.documentElement.dir,
    pickerHidden: picker.hidden,
    pickerVisible: getComputedStyle(picker).display !== "none" && picker.getBoundingClientRect().height > 0,
    pickerCount: document.querySelectorAll("#lang-picker").length,
    cardPresent: !!card,
    cardBox: r ? Math.round(r.width) + "x" + Math.round(r.height) : null,
    hiddenSurveyNodes: document.querySelector("#survey-root").children.length,
    surveyActive: !!document.querySelector("#view-survey.active"),
    hero: (document.querySelector("#home-h1") || {}).textContent || "",
    question: (document.querySelector("#survey-root h2") || {}).textContent || "",
    timings,
  };
})()`;

const sleep = (ms) => `new Promise((r) => setTimeout(r, ${ms}))`;

/** Answer the single-choice question on screen and press Next. */
const ANSWER_AND_ADVANCE = `(() => {
  const opt = document.querySelector("#survey-root .option, #survey-root .opt, #survey-root .choice");
  if (opt) opt.click();
  const next = document.querySelector("#btn-next");
  if (!next) return "no Next button on the question";
  if (next.disabled) return "Next is disabled, so the question could not be answered";
  next.click();
  return "";
})()`;

async function main() {
  const exe = findBrowser();
  if (!exe) {
    console.log("1 check skipped: no browser on this machine (install Chrome or Edge to run this test).");
    return;
  }
  const site = await serve(ROOT);
  let browser = null;
  try {
    browser = await launch(exe);
    const { page } = browser;

    const runAsync = async (name, fn) => {
      try { await fn(); } catch (err) {
        throw new Error(name + " → " + (err && err.message ? err.message : String(err)));
      }
    };

    // ── 1. the language card stays on the homepage, in every language, both arms ──
    for (const arm of ARMS) {
      await runAsync(`the language card survives a homepage switch [${arm}]`, async () => {
        // draft parked on the very question the card hides from
        await bootHome(page, site.origin, arm, HIDDEN_ON, `lang-${arm}`);
        for (const lang of LANGS) {
          const before = await page.evaluate(STATE);
          eq(before.screen, "view-home", `${arm}/${lang}: the homepage is the screen before switching`);
          assert(
            before.pickerVisible && !before.pickerHidden,
            `${arm}/${lang}: the language card is not visible on the homepage before switching`
          );
          eq(await page.evaluate(PICK(lang)), "", `${arm}/${lang}: picking a language`);
          await page.evaluate(sleep(150));
          const after = await page.evaluate(STATE);
          eq(after.screen, "view-home", `${arm}/${lang}: still on the homepage after switching`);
          eq(after.lang, lang, `${arm}/${lang}: the switch took effect (document language)`);
          assert(
            after.pickerVisible && !after.pickerHidden,
            `${arm}/${lang}: the language card went invisible on the homepage after switching language`
          );
          eq(after.pickerCount, 1, `${arm}/${lang}: exactly one language card exists`);
          assert(after.hero.trim().length > 0, `${arm}/${lang}: the homepage title is no longer rendered`);
        }
      });
    }

    // ── 2. no motivation card on the homepage after a switch ─────────────────────
    await runAsync("no motivation card appears on the homepage after a switch [HP2]", async () => {
      await bootHome(page, site.origin, "HP2", TIMED, "card-home");
      eq(await page.evaluate(PICK("es")), "", "picking Spanish on the homepage");
      await page.evaluate(sleep(PAST_MEDIAN));
      const s = await page.evaluate(STATE);
      eq(s.screen, "view-home", "still on the homepage after that question's median elapsed");
      eq(s.cardPresent, false, "the motivation card appeared over the homepage after a language switch");
      assert(s.pickerVisible, "the language card is still visible after the wait");
    });

    // ── 3. switching twice renders nothing behind the homepage ───────────────────
    await runAsync("switching twice on the homepage renders no survey and starts no card [HP2]", async () => {
      await bootHome(page, site.origin, "HP2", TIMED, "card-home-twice");
      const start = await page.evaluate(STATE);
      eq(start.hiddenSurveyNodes, 0, "the survey was already rendered behind the homepage at boot");
      eq(await page.evaluate(PICK("es")), "", "picking Spanish");
      await page.evaluate(sleep(150));
      eq(await page.evaluate(PICK("fr")), "", "picking French");
      await page.evaluate(sleep(600));
      const s = await page.evaluate(STATE);
      eq(s.screen, "view-home", "still on the homepage");
      eq(
        s.hiddenSurveyNodes,
        0,
        "a homepage language switch rendered the survey behind the homepage — its side effects act on the visible page"
      );
      eq(s.cardPresent, false, "a motivation card appeared after switching language twice on the homepage");
      assert(s.pickerVisible, "the language card is still visible after switching twice");
    });

    // ── 4. homepage time is not charged to a question ────────────────────────────
    await runAsync("time spent on the homepage is not added to a question [HP1]", async () => {
      const IDLE = 3000;
      // control: idle on the homepage without touching the language
      await bootHome(page, site.origin, "HP1", TIMED, "clock-plain");
      await page.evaluate(sleep(IDLE));
      await page.setHash("#/survey");
      await page.evaluate(sleep(350));
      eq(await page.evaluate(ANSWER_AND_ADVANCE), "", "answering and advancing (control)");
      await page.evaluate(sleep(350));
      const plain = await page.evaluate(STATE);

      // treated: the same idle, with one language switch on the homepage first
      await bootHome(page, site.origin, "HP1", TIMED, "clock-switch");
      eq(await page.evaluate(PICK("es")), "", "picking Spanish on the homepage");
      await page.evaluate(sleep(IDLE));
      await page.setHash("#/survey");
      await page.evaluate(sleep(350));
      eq(await page.evaluate(ANSWER_AND_ADVANCE), "", "answering and advancing (after a switch)");
      await page.evaluate(sleep(350));
      const switched = await page.evaluate(STATE);

      const plainMs = plain.timings[TIMED];
      const switchedMs = switched.timings[TIMED];
      assert(typeof plainMs === "number", `the control recorded no time for ${TIMED}`);
      assert(typeof switchedMs === "number", `no time was recorded for ${TIMED} after a homepage switch`);
      assert(
        switchedMs < IDLE,
        `a homepage language switch charged ${switchedMs}ms to ${TIMED} after a ${IDLE}ms homepage idle ` +
          `(control: ${plainMs}ms) — the idle was counted as question time`
      );
      assert(
        switchedMs - plainMs < IDLE,
        `the switch inflated ${TIMED} by ${switchedMs - plainMs}ms over the control (${plainMs}ms)`
      );
    });

    // ── 5. the survey still translates when the switch happens on it ─────────────
    await runAsync("the survey still re-renders when the switch happens on it", async () => {
      await bootHome(page, site.origin, "HP1", HIDDEN_ON, "on-survey");
      await page.setHash("#/survey");
      await page.evaluate(sleep(350));
      const en = await page.evaluate(STATE);
      eq(en.surveyActive, true, "the survey screen is on display");
      assert(en.question.trim().length > 0, "the question is rendered before the switch");

      eq(await page.evaluate(PICK("es")), "", "picking Spanish on the question");
      await page.evaluate(sleep(350));
      const es = await page.evaluate(STATE);
      eq(es.lang, "es", "the language changed");
      assert(es.question.trim().length > 0, "the question is no longer rendered after the switch");
      assert(es.question !== en.question, `the question was not translated (still "${es.question}")`);
      eq(es.surveyActive, true, "the survey is still the screen on display");
    });

    // ── 6. the card is still hidden on the question it hides on ──────────────────
    await runAsync("the language card still hides on its own question, and returns after it", async () => {
      for (const arm of ARMS) {
        await bootHome(page, site.origin, arm, HIDDEN_ON, `hide-${arm}`);
        await page.setHash("#/survey");
        await page.evaluate(sleep(350));
        const onQ = await page.evaluate(STATE);
        eq(onQ.surveyActive, true, `${arm}: the survey is on display`);
        assert(onQ.pickerHidden && !onQ.pickerVisible, `${arm}: the language card is still shown on "${HIDDEN_ON}"`);
        await page.setHash("#/");
        await page.evaluate(sleep(300));
        const home = await page.evaluate(STATE);
        eq(home.screen, "view-home", `${arm}: back on the homepage`);
        assert(home.pickerVisible, `${arm}: the language card did not come back on the homepage`);
      }
    });

    // ── 7. a respondent who really lingers still gets the card (positive control) ─
    await runAsync("lingering on a question still shows the motivation card [HP2]", async () => {
      await bootHome(page, site.origin, "HP2", TIMED, "card-on-survey");
      await page.setHash("#/survey");
      await page.evaluate(sleep(300));
      const onQ = await page.evaluate(STATE);
      eq(onQ.surveyActive, true, "the survey is on display");
      assert(onQ.question.trim().length > 0, `${TIMED} did not render — "no card on the homepage" would prove nothing`);
      await page.evaluate(sleep(PAST_MEDIAN));
      const s = await page.evaluate(STATE);
      assert(s.cardPresent, `the motivation card did not appear after ${PAST_MEDIAN}ms on ${TIMED}`);
      assert(/^\d+x\d+$/.test(s.cardBox || ""), `the card has no box on screen (${s.cardBox})`);
      eq(s.surveyActive, true, "the survey is still the screen on display");
    });
  } finally {
    if (browser) await browser.close();
    await site.close();
  }

  console.log(`${checks} checks passed: a language switch leaves the survey alone unless the survey is on screen.`);
}

main().catch((err) => {
  console.error("\n" + (err && err.stack ? err.stack : err) + "\n");
  process.exitCode = 1;
});
