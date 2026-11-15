// The skills question prints its answer scale ONCE, in English, in all nine
// languages.
//
// Each uploaded master puts the scale on the same line as the question
// ("… ? 1 – No experience · 5 – Expert · 0 – Not sure"), while the app renders
// that scale as the question's own English help line (survey-data.js `help`).
// Printed together, the scale appeared twice — once translated inside the
// question and once in English below it. The client's rule: the translated copy
// is removed for all eight translated languages and the labels are shown in
// English only, so the question keeps just its translated sentence.
//
// Guarded here:
//   • no language's question text carries the 1–5/0 labels; the help line is the
//     English wording, byte for byte, and holds each label exactly once;
//   • the sentence that is left is still the master's own opening wording (the
//     scale is the only thing dropped), and still translated;
//   • the pre-recorded question clip says the shortened sentence — the recording
//     never speaks a scale the page no longer shows;
//   • the real page, in three languages, contains the scale once and never twice.
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
const MANIFEST = JSON.parse(read("audio/manifest.json"));
const TEXTS = JSON.parse(read("audio/texts.json"));
const FIXTURE = JSON.parse(read("tests/fixtures/lang8-docx.json"));
const LANGS = I18N.LANGS || [];
const NON_EN = LANGS.filter((l) => l !== "en");
const QUESTIONS = SURVEY.QUESTIONS || [];
const SKILL_Q = QUESTIONS.find((q) => q.id === "skills");
const DICT = I18N.dicts || {};
const DRAFT_KEY = "sault_survey_draft_v1";

// Any "1 –", "1 =", "1 -" style label, i.e. the answer scale.
const SCALE_TOKEN = /\d\s*[–—−=]\s*\S/;

const answers = {
  consent: "Yes, I confirm",
  eligible: "Yes",
  employment_status: "Employed full time permanent (30+ hours/week)",
  current_job_title: "00010.00 - Legislators",
};

// What the page renders, mirroring app.js: tQ() and tHelp().
const EN_QUESTION = SKILL_Q ? (typeof SKILL_Q.text === "function" ? SKILL_Q.text({}) : SKILL_Q.text) : "";
const shownQuestion = (lang) => {
  const d = DICT[lang] || {};
  return (d.q && d.q.skills) || EN_QUESTION;
};
const shownHelp = (lang) => {
  const d = DICT[lang] || {};
  return (d.help && d.help.skills) || (SKILL_Q && SKILL_Q.help) || "";
};

// ── the one checker ────────────────────────────────────────────────────────
/**
 * Everything the scale rule requires of one language, checked together so no
 * single test can pass with half of it broken: the question is translated and
 * scale-free, the help line is the English wording with each of the six labels
 * exactly once, and the recording matches the shortened sentence.
 */
function checkLanguage(lang) {
  const q = shownQuestion(lang);
  const help = shownHelp(lang);
  assert(q.trim().length > 10, `${lang}: the skills question is empty`);
  eq(SCALE_TOKEN.test(q), false, `${lang}: the question text still carries the answer scale (${JSON.stringify(q.slice(-60))})`);
  eq(q.indexOf("·"), -1, `${lang}: the question text still carries a "·" separated scale`);
  eq(help, SKILL_Q.help, `${lang}: the help line is not the English wording`);
  for (const label of ["1 –", "2 –", "3 –", "4 –", "5 –", "0 –"]) {
    const n = help.split(label).length - 1;
    eq(n, 1, `${lang}: the help line shows "${label}" ${n} times, expected once`);
  }
  assert(lang === "en" || q !== EN_QUESTION, `${lang}: the question sentence was left in English`);
  // The recording must say what the page shows — never the removed scale.
  const spoken = (TEXTS[lang] || {})["q/skills"];
  eq(spoken, q, `${lang}: the recorded question clip does not match the page`);
  eq(SCALE_TOKEN.test(spoken), false, `${lang}: the recording still speaks the answer scale`);
  const rel = (MANIFEST[lang] || {})["q/skills"];
  assert(rel, `${lang}: no question clip in the audio manifest`);
  const abs = path.join(ROOT, rel.replace(/^audio\//, "audio/"));
  assert(fs.existsSync(abs), `${lang}: the clip ${rel} is missing`);
  assert(fs.statSync(abs).size > 200, `${lang}: the clip ${rel} is empty`);
}

// ── in-page reading ────────────────────────────────────────────────────────
const READ_SCALE = `(() => {
  const q = document.querySelector(".q-text");
  const h = document.querySelector(".q-help");
  const block = document.querySelector(".q-block");
  return {
    question: q ? (q.textContent || "").trim() : null,
    help: h ? (h.textContent || "").trim() : null,
    page: block ? (block.textContent || "") : "",
    rows: document.querySelectorAll(".rate-row").length,
  };
})()`;

let navSeq = 0;
async function openSkills(page, origin) {
  navSeq += 1;
  await page.goto(`${origin}/index.html?visit=${navSeq}#/`, 1280, 1000);
  await page.evaluate(
    "localStorage.clear();" +
      `localStorage.setItem(${JSON.stringify(DRAFT_KEY)}, JSON.stringify({` +
      `answers:${JSON.stringify(answers)},currentId:"skills"}));`
  );
  await page.reload();
  await page.setHash("#/survey");
  await page.evaluate("new Promise((r) => setTimeout(r, 500))");
}

async function pickLanguage(page, code) {
  await page.evaluate(`(() => { const b = document.querySelector("#lang-btn"); if (b) b.click(); })()`);
  const res = await page.evaluate(`(() => {
    const item = Array.prototype.slice.call(document.querySelectorAll(".lang-menu .lang-item"))
      .filter((n) => n.getAttribute("lang") === ${JSON.stringify(code)})[0];
    if (!item) return "no " + ${JSON.stringify(code)} + " in the language list";
    item.click();
    return "";
  })()`);
  eq(res, "", "choosing " + code);
  await page.evaluate("new Promise((r) => setTimeout(r, 200))");
}

function checkPage(state, lang) {
  assert(state.rows > 0, `${lang}: the skills rows did not render`);
  eq(state.question, shownQuestion(lang), `${lang}: the page shows a different question text than the dictionary`);
  eq(state.help, SKILL_Q.help, `${lang}: the page does not show the English help line`);
  eq(SCALE_TOKEN.test(state.question || ""), false, `${lang}: the question line on the page carries the scale`);
  // Exactly one scale on the whole question panel: the help line.
  const n = (state.page.match(/\d\s*[–—−=]\s*\S/g) || []).length;
  eq(n, 6, `${lang}: the page shows ${n} scale labels, expected the 6 in the help line alone`);
  eq(state.page.indexOf("·"), -1, `${lang}: the page still separates scale labels with "·"`);
}

async function run() {
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

  checkData("the skills question still has its English help line and its rows", () => {
    assert(SKILL_Q, "there is no skills question");
    assert(/no experience/i.test(SKILL_Q.help || ""), "the help line lost its low end");
    eq(LANGS.length, 9, "expected nine languages");
  });

  checkData("no language prints the translated scale inside the question", () => {
    checkLanguage("en");
    for (const lang of NON_EN) checkLanguage(lang);
  });

  checkData("the sentence that is left is the master's own opening wording", () => {
    for (const lang of NON_EN) {
      const f = FIXTURE[lang] || {};
      const hay = new Set(
        Object.values(f.q || {})
          .map((s) => String(s).replace(/\s+/g, " ").trim())
          .filter(Boolean)
      );
      const want = shownQuestion(lang).replace(/\s+/g, " ").trim();
      const host = [...hay].filter((s) => s.startsWith(want) && s.length > want.length);
      assert(host.length, `${lang}: the question is not the opening of its uploaded master line`);
      assert(
        host.some((s) => /^\s*1\s*[–—−=]\s*\S/.test(s.slice(want.length))),
        `${lang}: something other than the answer scale was dropped: ${JSON.stringify(host[0].slice(want.length, want.length + 40))}`
      );
    }
  });

  checkData("the recording of the question speaks the shortened sentence", () => {
    for (const lang of LANGS) {
      const spoken = (TEXTS[lang] || {})["q/skills"];
      eq(spoken, shownQuestion(lang), `${lang}: texts.json does not match the page`);
      eq(SCALE_TOKEN.test(spoken || ""), false, `${lang}: texts.json still carries the scale`);
    }
  });

  checkData("no language has a translated help line waiting to be printed", () => {
    for (const lang of NON_EN) {
      const h = (DICT[lang] || {}).help;
      assert(!(h && h.skills), `${lang}: a translated skills help line exists in the dictionary`);
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

    for (const lang of ["en", "hi", "ar", "fr"]) {
      await runAsync(`the page shows the scale once, in English (${lang})`, async () => {
        await openSkills(page, site.origin);
        if (lang !== "en") await pickLanguage(page, lang);
        await page.evaluate("new Promise((r) => setTimeout(r, 150))");
        checkPage(await page.evaluate(READ_SCALE), lang);
      });
    }
  } finally {
    if (browser) await browser.close();
    await site.close();
  }

  if (failures) {
    console.error(`\n${failures} of ${checks} checks FAILED.\n`);
    process.exit(1);
  }
  console.log(`${checks} checks passed: the skills scale prints once, in English, in every language.`);
}

run().catch((err) => {
  console.error("FAILED:", err && err.message ? err.message : err);
  process.exit(1);
});

