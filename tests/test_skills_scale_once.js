// The skills question prints its answer scale ONCE, in the selected language.
//
// Each uploaded master puts the scale on the same line as the question
// ("… ? 1 – No experience · 5 – Expert · 0 – Not sure"), while the app renders
// that scale as the question's own help line (survey-data.js `help`). Printed
// together, the scale appeared twice. The question therefore keeps only its
// translated sentence, and the scale from the master becomes that language's
// help line (dict.help.skills) — so the 1–5/0 labels are translated as well.
//
// Guarded here:
//   • no language's question text carries the 1–5/0 labels; the scale is on the
//     help line only, and each of the six labels appears exactly once;
//   • the help line is the master's own scale wording — not English, not the
//     English line re-used, not a re-wording of the labels;
//   • the sentence that is left is still the master's own opening wording (the
//     scale is the only thing dropped), and still translated;
//   • the pre-recorded question clip says the shortened sentence — the recording
//     never speaks a scale the page no longer shows;
//   • the real page, in four languages, shows the translated scale once and
//     never falls back to the English labels.
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
// The digits the scale offers, in the order every master writes them.
const SCALE_DIGITS = ["1", "2", "3", "4", "5", "0"];

const answers = {
  consent: "Yes, I confirm",
  eligible: "Yes",
  employment_status: "Employed full time permanent (30+ hours/week)",
  current_job_title: "00010.00 - Legislators",
};

// ── what each master says the scale is ─────────────────────────────────────
/**
 * The uploaded master line for the skills question, split into its sentence and
 * its six answer labels. Read straight from the .docx extract so the dictionary
 * is held to the upload rather than to a copy of the build's own logic.
 */
function masterScale(lang) {
  const f = FIXTURE[lang] || {};
  const line = Object.values(f.q || {})
    .map((s) => String(s).replace(/\s+/g, " ").trim())
    .find((s) => /\s1\s*[–—−=]\s*\S/.test(s) && /\s0\s*[–—−=]\s*\S/.test(s));
  assert(line, `${lang}: no master line carries the 1–5/0 scale`);
  const at = line.search(/\s1\s*[–—−=]\s*\S/);
  const labels = line
    .slice(at)
    .split(/\s*[·•]\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      const m = /^([0-9])\s*[–—−=]\s*(\S.*)$/.exec(part);
      assert(m, `${lang}: cannot read a scale label from ${JSON.stringify(part)}`);
      return { digit: m[1], label: m[2].trim() };
    });
  eq(labels.map((l) => l.digit).join(""), SCALE_DIGITS.join(""), `${lang}: the master's scale order`);
  return { line, sentence: line.slice(0, at).trim(), rest: line.slice(at), labels };
}

/** The help line the page must show: the master's own labels, English's shape. */
function expectedHelp(lang) {
  if (lang === "en") return SKILL_Q.help;
  const { labels } = masterScale(lang);
  return labels.map((l) => `${l.digit} – ${l.label}`).join(", ");
}

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
 * scale-free, the help line is that language's own master scale with each of the
 * six labels exactly once, and the recording matches the shortened sentence.
 */
function checkLanguage(lang) {
  const q = shownQuestion(lang);
  const help = shownHelp(lang);
  assert(q.trim().length > 10, `${lang}: the skills question is empty`);
  eq(SCALE_TOKEN.test(q), false, `${lang}: the question text still carries the answer scale (${JSON.stringify(q.slice(-60))})`);
  eq(q.indexOf("·"), -1, `${lang}: the question text still carries a "·" separated scale`);
  eq(help, expectedHelp(lang), `${lang}: the help line is not this language's own scale`);
  if (lang !== "en") {
    assert(help !== SKILL_Q.help, `${lang}: the help line is still the English one`);
    assert(DICT[lang] && DICT[lang].help && DICT[lang].help.skills, `${lang}: no translated help line — the page would fall back to English`);
  }
  for (const d of SCALE_DIGITS) {
    const n = help.split(d + " – ").length - 1;
    eq(n, 1, `${lang}: the help line shows "${d} –" ${n} times, expected once`);
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
  eq(state.help, expectedHelp(lang), `${lang}: the page does not show this language's translated scale`);
  if (lang !== "en") assert(state.help !== SKILL_Q.help, `${lang}: the page still shows the English labels`);
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

  checkData("no language prints the answer scale inside the question", () => {
    checkLanguage("en");
    for (const lang of NON_EN) checkLanguage(lang);
  });

  checkData("every language prints the scale in its own words, never the English one", () => {
    for (const lang of NON_EN) {
      const help = shownHelp(lang);
      eq(help, expectedHelp(lang), `${lang}: the printed scale is not the master's`);
      assert(help !== SKILL_Q.help, `${lang}: the printed scale is English`);
      // The labels are the master's, so each must occur in the uploaded line.
      const { labels } = masterScale(lang);
      for (const { label } of labels) {
        assert(help.includes(label), `${lang}: label ${JSON.stringify(label)} is missing from the printed scale`);
      }
    }
  });

  checkData("the sentence that is left is the master's own opening wording", () => {
    for (const lang of NON_EN) {
      const { sentence, rest } = masterScale(lang);
      const want = shownQuestion(lang).replace(/\s+/g, " ").trim();
      assert(want.length > 0, `${lang}: the question is empty`);
      // The question is the master's own sentence, word for word …
      eq(want, sentence, `${lang}: the question is not its uploaded master sentence`);
      // … and the scale is the only thing dropped from the uploaded line.
      assert(
        /^\s*1\s*[–—−=]\s*\S/.test(rest),
        `${lang}: something other than the answer scale was dropped: ${JSON.stringify(rest.slice(0, 40))}`
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

  checkData("no language falls back to the English scale", () => {
    for (const lang of NON_EN) {
      const h = (DICT[lang] || {}).help;
      assert(h && h.skills, `${lang}: the dictionary has no skills help line, so the page shows English`);
      eq(h.skills, expectedHelp(lang), `${lang}: the help line is not the master's scale`);
    }
    // English is the only language without a dictionary entry: it reads survey-data.
    assert(!(DICT.en && DICT.en.help && DICT.en.help.skills), "the English help line is duplicated in the dictionary");
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
      await runAsync(`the page shows the scale once, in the selected language (${lang})`, async () => {
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
  console.log(`${checks} checks passed: the skills scale prints once, in the selected language.`);
}

run().catch((err) => {
  console.error("FAILED:", err && err.message ? err.message : err);
  process.exit(1);
});
