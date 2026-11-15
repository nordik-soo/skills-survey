// Picklist 4: "The skill names should remain in English but their tooltips should
// be translated form."
//
// Two halves, and they must not drift:
//   • the row label is the English OaSIS skill name in EVERY language — the
//     uploaded masters keep the Section D rows as "Skill 1…9" placeholders and
//     never define translated names, so an English label in an Arabic page is
//     the intended result, not a missing translation;
//   • the "?" tooltip is the definition written in the selected language, taken
//     from that master's appendix (translations.js dicts[lang].def[<English name>]).
// A renderer that translates the label, or that pins the tooltip to English,
// fails here.
//
// Audio is deliberately NOT changed by this rule: the speaker on a row still
// plays the selected language's recording of the skill (clip ref "sk/<English
// name>" in that language's bucket), exactly like speakers elsewhere in the
// survey. The last check proves it, so a later "make the audio match the English
// label" edit has to be a deliberate one.
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
const ctx = { window: {}, console, JSON, Object, Array, String, Number };
ctx.global = ctx;
vm.createContext(ctx);
for (const f of ["noc-data.js", "translations.js", "survey-data.js"]) vm.runInContext(read(f), ctx, { filename: f });

const W = ctx.window;
const I18N = W.I18N || {};
const SURVEY = W.SURVEY || {};
const NOC = W.NOC_DATA || {};
const MANIFEST = JSON.parse(read("audio/manifest.json"));
const LANGS = I18N.LANGS || [];
const DEFS = SURVEY.SKILL_DEFINITIONS || {};
const QUESTIONS = SURVEY.QUESTIONS || [];
const SKILL_Q = QUESTIONS.find((q) => q.id === "skills");
const DRAFT_KEY = "sault_survey_draft_v1";

// Every English skill name the survey can show, taken from the picklist lookup.
const ALL_SKILLS = (() => {
  const seen = new Set();
  for (const list of Object.values(NOC.SKILLS || {})) for (const n of list) seen.add(n);
  return [...seen];
})();

// The draft that puts the visitor on the skills question: consent, eligibility,
// and an occupation whose OaSIS code carries ten skills (two pages of five).
const ANSWERS = {
  consent: "Yes, I confirm",
  eligible: "Yes",
  employment_status: "Employed full time permanent (30+ hours/week)",
  current_job_title: "00010.00 - Legislators",
};
const OASIS_CODE = "0001000";
const EXPECTED_SKILLS = (NOC.SKILLS || {})[OASIS_CODE] || [];

const defIn = (lang, name) => {
  const d = I18N.dicts && I18N.dicts[lang];
  return d && d.def ? d.def[name] : undefined;
};
const questionText = (lang) => {
  const d = I18N.dicts && I18N.dicts[lang];
  return (d && d.q && d.q.skills) || (SKILL_Q && SKILL_Q.text) || "";
};

// ── in-page helpers ────────────────────────────────────────────────────────
// Everything the visitor can see on a row: the label with the tooltip and the
// speaker taken out (they live inside the same element), and the tooltip text.
const READ_ROWS = `(() => {
  const rows = Array.prototype.slice.call(document.querySelectorAll(".rate-row")).map((row) => {
    const nameEl = row.querySelector(".rate-name");
    const tip = row.querySelector(".opt-tip");
    let label = "";
    if (nameEl) {
      const clone = nameEl.cloneNode(true);
      Array.prototype.slice.call(clone.querySelectorAll(".opt-help, .opt-speak")).forEach((n) => n.remove());
      label = (clone.textContent || "").trim();
    }
    return {
      label,
      help: !!row.querySelector(".opt-help"),
      speaker: !!row.querySelector(".opt-speak"),
      tip: tip ? (tip.textContent || "").trim() : null,
    };
  });
  return { title: (document.querySelector(".q-text") || {}).textContent || "", rows };
})()`;

let navSeq = 0;

async function openSkills(page, origin) {
  navSeq += 1;
  await page.goto(`${origin}/index.html?visit=${navSeq}#/`, 1280, 1000);
  await page.evaluate(
    "localStorage.clear();" +
      `localStorage.setItem(${JSON.stringify(DRAFT_KEY)}, JSON.stringify({` +
      `answers:${JSON.stringify(ANSWERS)},currentId:"skills"}));`
  );
  await page.reload();
  await page.setHash("#/survey");
  await page.evaluate("new Promise((r) => setTimeout(r, 500))");
}

async function pickLanguage(page, code) {
  // Open the header list, then click the language by its lang code — never by
  // its visible name, which changes with the current language.
  await page.evaluate(`(() => { const b = document.querySelector("#lang-btn"); if (b) b.click(); })()`);
  const res = await page.evaluate(`(() => {
    const item = Array.prototype.slice.call(document.querySelectorAll(".lang-menu .lang-item"))
      .filter((n) => n.getAttribute("lang") === ${JSON.stringify(code)})[0];
    if (!item) return "no " + ${JSON.stringify(code)} + " in the language list";
    item.click();
    return "";
  })()`);
  eq(res, "", "choosing " + code);
  await page.evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))");
  await page.evaluate("new Promise((r) => setTimeout(r, 150))");
}

/** Rate the five rows on the page so the list can move to the next five. */
async function rateVisiblePage(page) {
  const res = await page.evaluate(`(() => {
    const rows = Array.prototype.slice.call(document.querySelectorAll(".rate-row"));
    if (rows.length === 0) return "no skill rows on screen";
    rows.forEach((row) => {
      const dot = row.querySelectorAll(".rate-dot")[2]; // "3"
      if (dot) dot.click();
    });
    return "";
  })()`);
  eq(res, "", "rating the visible page");
  await page.evaluate("new Promise((r) => setTimeout(r, 500))");
}

// ── the one checker ────────────────────────────────────────────────────────
/**
 * Every row of a page must satisfy both halves of Picklist 4 at once: the label
 * is the English name from the picklist (unchanged in every language), and the
 * tooltip is the definition written in `lang` — never the English source when a
 * translation exists, and never absent.
 */
function checkPage(state, lang, pageIdx, where) {
  assert(state.rows.length > 0, `${where}: no skill rows rendered`);
  assert(
    state.title.indexOf(questionText(lang).slice(0, 20)) !== -1,
    `${where}: the skills question is not on screen (title was "${state.title.slice(0, 60)}")`
  );
  const offset = pageIdx * 5;
  state.rows.forEach((row, i) => {
    const expectedName = EXPECTED_SKILLS[offset + i];
    assert(expectedName, `${where}: the question shows more rows than the picklist has skills`);
    eq(row.label, expectedName, `${where}: row ${offset + i + 1} label`);
    assert(row.help, `${where}: row ${offset + i + 1} ("${expectedName}") has no tooltip icon`);
    const expectedTip = lang === "en" ? DEFS[expectedName] : defIn(lang, expectedName);
    eq(row.tip, expectedTip, `${where}: row ${offset + i + 1} ("${expectedName}") tooltip`);
    assert(row.speaker, `${where}: row ${offset + i + 1} ("${expectedName}") lost its speaker`);
  });
}

async function run() {
  // ── data premises (no browser needed) ────────────────────────────────────
  const dataChecks = [];
  const checkData = (name, fn) => {
    checks += 1;
    try {
      fn();
      console.log("  ok  " + name);
    } catch (err) {
      failures += 1;
      console.log("  x   " + name + ": " + err.message);
    }
  };

  checkData("the skills question, its picklist and its definitions exist", () => {
    assert(SKILL_Q, "there is no skills question");
    assert(EXPECTED_SKILLS.length > 5, `the test occupation has only ${EXPECTED_SKILLS.length} skills`);
    assert(Object.keys(DEFS).length > 5, "SKILL_DEFINITIONS is empty");
    for (const name of ALL_SKILLS) {
      assert(DEFS[name], `"${name}" is a picklist skill with no English definition`);
    }
    assert(ALL_SKILLS.length === 33, `expected 33 distinct skills in the picklist, found ${ALL_SKILLS.length}`);
  });

  checkData("every language translates every skill tooltip", () => {
    // If a language were missing a definition the page would draw no tooltip at
    // all, and the "translated tooltip" half of the rule would be untestable.
    for (const lang of LANGS.filter((l) => l !== "en")) {
      const missing = ALL_SKILLS.filter((name) => !defIn(lang, name));
      eq(missing.length, 0, `${lang}: skills with no translated definition (${missing.slice(0, 4).join(", ")})`);
      for (const name of ALL_SKILLS) {
        assert(
          defIn(lang, name) !== DEFS[name],
          `${lang}: "${name}" has its English definition in the translation table`
        );
      }
    }
  });

  const exe = findBrowser();
  if (!exe) {
    console.log("  skip  no Chrome or Edge found to drive the page with (set CHROME_BIN to point at one)");
    if (failures) {
      console.error(`\n${failures} of ${checks} checks FAILED.\n`);
      process.exit(1);
    }
    console.log(`${checks} data checks passed; the page itself was not exercised (no browser).`);
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

    await runAsync("the English page shows English names with English tooltips", async () => {
      await openSkills(page, site.origin);
      checkPage(await page.evaluate(READ_ROWS), "en", 0, "en");
    });

    await runAsync("in every language the label stays English and the tooltip is that language's", async () => {
      for (const lang of LANGS) {
        await pickLanguage(page, lang);
        checkPage(await page.evaluate(READ_ROWS), lang, 0, lang);
      }
    });

    await runAsync("the label does not move between languages, the tooltip does", async () => {
      // Read the same five rows in English and in Spanish and compare directly:
      // identical labels, different tooltips. A renderer that translated the
      // label (or pinned the tooltip) fails one of these two comparisons.
      await pickLanguage(page, "en");
      const en = await page.evaluate(READ_ROWS);
      await pickLanguage(page, "es");
      const es = await page.evaluate(READ_ROWS);
      eq(en.rows.length, es.rows.length, "the two languages show a different number of rows");
      let tipChanges = 0;
      en.rows.forEach((row, i) => {
        eq(es.rows[i].label, row.label, `row ${i + 1} label changed with the language`);
        if (es.rows[i].tip !== row.tip) tipChanges += 1;
      });
      eq(tipChanges, en.rows.length, "some tooltips stayed in English when Spanish was selected");
    });

    await runAsync("both halves hold on the second page of five skills", async () => {
      // The list is paged five at a time; the rule has to survive a page change.
      // Rating the fifth row completes the page, which auto-advances to the next
      // five after ~300ms — the same way a respondent moves forward.
      await openSkills(page, site.origin);
      await pickLanguage(page, "en");
      await rateVisiblePage(page);
      const state = await page.evaluate(READ_ROWS);
      assert(
        state.rows.length > 0 && state.rows[0].label === EXPECTED_SKILLS[5],
        `the list did not reach its second page (first row was "${(state.rows[0] || {}).label}")`
      );
      checkPage(state, "en", 1, "en page 2");
      for (const lang of ["ar", "es"]) {
        await pickLanguage(page, lang);
        checkPage(await page.evaluate(READ_ROWS), lang, 1, `${lang} page 2`);
      }
    });

    await runAsync("audio still plays the selected language's recording", async () => {
      // Picklist 4 changes the label only. The speaker is wired exactly as on the
      // rest of the survey: clip "sk/<English name>" out of the selected
      // language's bucket, so a Spanish page plays the Spanish name.
      await openSkills(page, site.origin);
      const played = {};
      for (const lang of ["en", "es"]) {
        await pickLanguage(page, lang);
        const res = await page.evaluate(`(() => {
          window.__played = [];
          if (!window.__realAudio) {
            window.__realAudio = window.Audio;
            window.Audio = function (src) { window.__played.push(String(src)); return new window.__realAudio(src); };
          }
          const row = document.querySelector(".rate-row");
          if (!row) return "no skill row";
          const btn = row.querySelector(".opt-speak");
          if (!btn) return "the first skill row has no speaker";
          btn.click();
          return "";
        })()`);
        eq(res, "", `${lang}: clicking the row's speaker`);
        const src = await page.evaluate("window.__played[0] || null");
        assert(src, `${lang}: no audio was started by the speaker`);
        const expected = (MANIFEST[lang] || {})["sk/" + EXPECTED_SKILLS[0]];
        assert(expected, `${lang}: no clip for "sk/${EXPECTED_SKILLS[0]}" in the manifest`);
        eq(src.replace(/^\//, ""), String(expected).replace(/^\//, ""), `${lang}: the clip the speaker played`);
        played[lang] = src;
      }
      assert(played.en !== played.es, "English and Spanish played the same recording");
      assert(played.es.indexOf("/audio/es/") !== -1, `the Spanish page did not play a Spanish clip (${played.es})`);
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
      console.log("1 check skipped: the skills rows were not exercised.");
      return;
    }
    console.log(`${checks} checks passed: skill names stay English, tooltips follow the language (Picklist 4).`);
  })
  .catch((err) => {
    console.error("\n" + (err && err.stack ? err.stack : err) + "\n");
    process.exit(1);
  });
