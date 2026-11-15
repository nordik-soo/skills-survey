// The header's language card must be invisible on "Where have you moved from?"
// and nowhere else. It floats above every question in the sticky header, so the
// only correct behaviour is: hidden on that one question id, shown on the
// questions around it, shown again on the homepage, and recoverable by leaving
// the question — including when the visitor had the language list open.
//
// The question is identified by id, never by its English text: "Where have you
// moved from?" is translated, so a text match would hide the card in one
// language and not in the other eight.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const { findBrowser, serve, launch } = require("./helpers/browser.js");

let checks = 0;
let failures = 0;

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
const QUESTIONS = (SURVEY && SURVEY.QUESTIONS) || [];

const DRAFT_KEY = "sault_survey_draft_v1";
const HIDDEN_ON = "moved_from";

// The wording of the question in each language. The translation dictionary is
// keyed by question id (dicts[lang].q.<id>), so the test can prove the page is
// really showing that question without depending on any English wording.
const EN_TEXT = (QUESTIONS.find((q) => q.id === HIDDEN_ON) || {}).text || "";
function textIn(lang) {
  const d = I18N && I18N.dicts && I18N.dicts[lang];
  const t = d && d.q && d.q[HIDDEN_ON];
  return (lang === "en" ? null : t) || EN_TEXT;
}

// ── in-page helpers ────────────────────────────────────────────────────────
// The visitor's view of the card: does it take up space on screen, and is it
// knowingly hidden? A card that is merely transparent or off-screen would be
// a bug, so both the layout box and the attribute are read.
const PICKER_STATE = `(() => {
  const p = document.querySelector("#lang-picker");
  if (!p) return { error: "there is no language card in the header" };
  const r = p.getBoundingClientRect();
  const cs = getComputedStyle(p);
  return {
    hidden: p.hasAttribute("hidden"),
    display: cs.display,
    visible: !!(r.width && r.height) && cs.visibility !== "hidden" && cs.display !== "none",
    ariaHidden: p.getAttribute("aria-hidden"),
    focusInside: p.contains(document.activeElement),
    title: (document.querySelector(".q-text") || {}).textContent || "",
    bodyRoute: document.body.dataset.route,
  };
})()`;

const OPEN_MENU = `(() => {
  const btn = document.querySelector("#lang-btn");
  if (!btn) return "no language button";
  btn.click();
  const menu = document.querySelector(".lang-menu");
  return menu ? "" : "the language list did not open";
})()`;

const MENU_PRESENT = `(() => {
  const menu = document.querySelector(".lang-menu");
  if (!menu) return false;
  const r = menu.getBoundingClientRect();
  return !!(r.width && r.height) && getComputedStyle(menu).display !== "none";
})()`;

let navSeq = 0;

async function openQuestion(page, origin, id, answers) {
  // A unique URL per visit: navigating to the identical address fires no load
  // event, so the helper would wait forever for a page that never reloads.
  navSeq += 1;
  await page.goto(`${origin}/index.html?visit=${navSeq}#/`, 1280, 900);
  await page.evaluate(
    "localStorage.clear();" +
      `localStorage.setItem(${JSON.stringify(DRAFT_KEY)}, JSON.stringify({` +
      `answers:${JSON.stringify(answers)},currentId:${JSON.stringify(id)}}));`
  );
  await page.reload();
  await page.setHash("#/survey");
  await page.evaluate("new Promise((r) => setTimeout(r, 400))");
  return page.evaluate(PICKER_STATE);
}

async function pickLanguage(page, code) {
  const res = await page.evaluate(`(() => {
    const btn = document.querySelector("#lang-btn");
    if (!btn) return "no language button in the header";
    btn.click();
    const item = Array.prototype.slice.call(document.querySelectorAll(".lang-menu .lang-item"))
      .filter((n) => n.getAttribute("lang") === ${JSON.stringify(code)})[0];
    if (!item) return "no " + ${JSON.stringify(code)} + " in the language list";
    item.click();
    return "";
  })()`);
  eq(res, "", "choosing " + code);
  await page.evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))");
}

/** The question's own "next" button, i.e. the way a respondent advances. */
async function advance(page) {
  return page.evaluate(`(() => {
    const next = document.querySelector("#btn-next");
    if (!next) return "no next button on this question";
    if (next.disabled) return "the next button is disabled, so the question was not answered";
    next.click();
    return "";
  })()`);
}

// ── the one checker ────────────────────────────────────────────────────────
/**
 * The card's state must match the question on screen: never visible on the one
 * question, always visible on any other, and never left aria-hidden while shown.
 */
function checkPicker(state, { expectHidden, where }) {
  assert(!state.error, `${where}: ${state.error}`);
  eq(state.visible, !expectHidden, `${where}: the language card's visibility`);
  eq(state.hidden, expectHidden, `${where}: the card's hidden attribute`);
  eq(state.ariaHidden, expectHidden ? "true" : "false", `${where}: the card's aria-hidden`);
  if (expectHidden) {
    assert(!state.focusInside, `${where}: focus was left inside the card that is now hidden`);
  }
}

async function run() {
  const exe = findBrowser();
  if (!exe) {
    console.log("  skip  no Chrome or Edge found to drive the page with (set CHROME_BIN to point at one)");
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

    // The premise: this test would prove nothing if the question did not exist.
    await runAsync("the question the card is hidden on exists and is translated", async () => {
      const q = QUESTIONS.find((x) => x.id === HIDDEN_ON);
      assert(q, `no question with id ${HIDDEN_ON} in survey-data.js`);
      assert(EN_TEXT.length > 0, `${HIDDEN_ON} has no text, so nothing can be shown to check against`);
      for (const lang of LANGS.filter((l) => l !== "en")) {
        assert(textIn(lang), `${lang}: ${HIDDEN_ON} has no translation, so the id-not-text rule is untestable`);
      }
    });

    await runAsync("the card is invisible on 'Where have you moved from?'", async () => {
      const state = await openQuestion(page, site.origin, HIDDEN_ON, {
        consent: "Yes, I confirm",
        eligible: "Yes",
      });
      assert(
        state.title.indexOf(textIn("en")) !== -1,
        `the page is not on the intended question (title was "${state.title}")`
      );
      checkPicker(state, { expectHidden: true, where: "on " + HIDDEN_ON });
    });

    await runAsync("the card is visible again on the question before it", async () => {
      const q = QUESTIONS.find((x) => x.id === HIDDEN_ON);
      const before = QUESTIONS[QUESTIONS.indexOf(q) - 1];
      assert(before, "there is no question before " + HIDDEN_ON);
      const state = await openQuestion(page, site.origin, before.id, {
        consent: "Yes, I confirm",
        eligible: "Yes",
      });
      checkPicker(state, { expectHidden: false, where: "on " + before.id });
    });

    await runAsync("the card is visible on the homepage", async () => {
      await openQuestion(page, site.origin, HIDDEN_ON, { consent: "Yes, I confirm", eligible: "Yes" });
      await page.setHash("#/");
      await page.evaluate("new Promise((r) => setTimeout(r, 300))");
      const state = await page.evaluate(PICKER_STATE);
      eq(state.bodyRoute, "home", "the homepage did not open");
      checkPicker(state, { expectHidden: false, where: "on the homepage" });
    });

    await runAsync("a respondent who hides the card by leaving the question gets it back", async () => {
      // Forward: answer the question and advance, the way a real visitor does.
      await openQuestion(page, site.origin, HIDDEN_ON, { consent: "Yes, I confirm", eligible: "Yes" });
      const advanced = await page.evaluate(`(() => {
        const opts = Array.prototype.slice.call(document.querySelectorAll(".opt, .option, label"));
        const other = opts.filter((n) => /Other parts of Ontario/.test(n.textContent || ""))[0];
        if (!other) return "the answer options are not on screen";
        (other.querySelector("input") || other).click();
        return "";
      })()`);
      eq(advanced, "", "selecting an option on " + HIDDEN_ON);
      await page.evaluate("new Promise((r) => setTimeout(r, 300))");
      const step = await advance(page);
      eq(step, "", "advancing past " + HIDDEN_ON);
      await page.evaluate("new Promise((r) => setTimeout(r, 400))");
      const state = await page.evaluate(PICKER_STATE);
      assert(
        state.title.indexOf(textIn("en")) === -1,
        "advancing did not leave the question, so this proves nothing"
      );
      checkPicker(state, { expectHidden: false, where: "after advancing past " + HIDDEN_ON });
    });

    await runAsync("an open language list does not survive the card being hidden", async () => {
      // Open the list on the question before, then move forward onto the one
      // that hides the card: nothing may be left floating over the options.
      const q = QUESTIONS.find((x) => x.id === HIDDEN_ON);
      const before = QUESTIONS[QUESTIONS.indexOf(q) - 1];
      await openQuestion(page, site.origin, before.id, { consent: "Yes, I confirm", eligible: "Yes" });
      const opened = await page.evaluate(OPEN_MENU);
      eq(opened, "", "opening the language list");
      await openQuestion(page, site.origin, HIDDEN_ON, { consent: "Yes, I confirm", eligible: "Yes" });
      const state = await page.evaluate(PICKER_STATE);
      checkPicker(state, { expectHidden: true, where: "with the list having been open" });
      const floating = await page.evaluate(MENU_PRESENT);
      eq(floating, false, "a language list was left floating over the question that hides the card");
    });

    await runAsync("the card comes back in the other eight languages too", async () => {
      // The rule keys on the question id, so no translation may change it, and
      // the card must return as soon as the visitor moves off the question.
      for (const lang of LANGS) {
        await openQuestion(page, site.origin, HIDDEN_ON, { consent: "Yes, I confirm", eligible: "Yes" });
        if (lang !== "en") await pickLanguage(page, lang);
        const hidden = await page.evaluate(PICKER_STATE);
        assert(
          hidden.title.indexOf(textIn(lang)) !== -1 || hidden.title.trim() === textIn(lang).trim(),
          `${lang}: the page is not showing the translated question (title was "${hidden.title}")`
        );
        checkPicker(hidden, { expectHidden: true, where: `${HIDDEN_ON} in ${lang}` });

        await page.setHash("#/");
        await page.evaluate("new Promise((r) => setTimeout(r, 300))");
        const shown = await page.evaluate(PICKER_STATE);
        checkPicker(shown, { expectHidden: false, where: `the homepage after ${lang}` });
      }
    });

    await runAsync("nothing else about the question is affected", async () => {
      // The card is the only thing hidden: the question still shows its text and
      // every answer option, so the visitor can actually answer it.
      const state = await openQuestion(page, site.origin, HIDDEN_ON, { consent: "Yes, I confirm", eligible: "Yes" });
      assert(state.visible === false, "premise failed: the card was not hidden");
      const q = await page.evaluate(`(() => {
        const opts = Array.prototype.slice.call(document.querySelectorAll(".opt, .option, label"))
          .map((n) => (n.textContent || "").trim())
          .filter(Boolean);
        return {
          title: (document.querySelector(".q-text") || {}).textContent || "",
          options: opts,
          headerBrand: !!document.querySelector(".brand-name"),
        };
      })()`);
      assert(q.title.indexOf(textIn("en")) !== -1, "the question text is not on screen");
      const expected = ["Other parts of Ontario", "Outside of Ontario but within Canada", "Outside of Canada"];
      for (const e of expected) {
        assert(q.options.some((o) => o.indexOf(e) !== -1), `answer option "${e}" is not on screen`);
      }
      assert(q.headerBrand, "the header brand disappeared too, so more than the card was hidden");
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
    if (!checks) {
      console.log("1 check skipped: the language card was not exercised (no browser).");
      return;
    }
    console.log(`${checks} checks passed: the language card is hidden only on "Where have you moved from?".`);
  })
  .catch((err) => {
    console.error("\n" + (err && err.stack ? err.stack : err) + "\n");
    process.exit(1);
  });
