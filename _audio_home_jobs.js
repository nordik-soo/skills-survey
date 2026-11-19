// Emit the TTS jobs for the homepage: its title and its three introduction
// cards, for BOTH homepage variants, in every shipped language, so the hero can
// be listened to the way every survey question already can.
//   node _audio_home_jobs.js <out.json>
//
// The text comes from translations.js and survey-data.js — the same data the page
// renders — and the mirror of app.js is exact, so a clip can never say something
// the screen does not show:
//   title  = (d.home.h1)          || "Sault Newcomer Survey 2026"   [applyStaticText]
//   cards  = (d.home.hp2|hp1)     || HOME_VARIANTS[id].body          [renderHomeBody]
//
// Two things about the homepage make the refs unusual, and both are checked
// here rather than assumed:
//   • Card 1 is the experiment: HP1 and HP2 word it differently, so it gets one
//     ref per arm ("h/hp1", "h/hp2"). A single shared ref would read half the
//     visitors the copy of the arm they are not looking at.
//   • Cards 2 and 3 are identical in both arms (in all nine languages), so they
//     are recorded once ("h/card2", "h/card3") and both arms point at them. The
//     identity check below is what keeps that true: the moment an arm rewords
//     card 2, this file stops and says so instead of letting the other arm's
//     recording stand in.
const fs = require("fs");
global.window = {};
require("./survey-data.js");
require("./translations.js");
const S = window.SURVEY;
const I = window.I18N;

const LANGS = (I && I.LANGS) || ["en"];
const dict = (code) => (I && I.dicts && I.dicts[code]) || null;
const VARIANTS = S.HOME_VARIANTS || {};
const ARMS = Object.keys(VARIANTS);
const TITLE_EN = "Sault Newcomer Survey 2026";
const CARDS = 3; // the hero renders one card per paragraph
// The HP2 motivation card's line. app.js carries it as MOTIV_TEXT and shows
// `dict().home.encourage || MOTIV_TEXT`, so this mirrors that exactly.
const MOTIV_EN = "During the pre-test, 86% of participants recommended completing the survey. We encourage you to continue and complete the survey as well.";
// The one line that must stay identical to app.js's MOTIV_TEXT, read from the
// file itself so the two can never drift apart silently.
const appSrc = fs.readFileSync(require("path").join(__dirname, "app.js"), "utf8");
const appMotiv = (appSrc.match(/const MOTIV_TEXT = "([^"]+)";/) || [])[1];
if (appMotiv !== MOTIV_EN) {
  throw new Error("app.js MOTIV_TEXT no longer matches this file:\n  app.js: " + JSON.stringify(appMotiv) + "\n  here:   " + JSON.stringify(MOTIV_EN));
}

if (ARMS.length !== 2) throw new Error("survey-data.js should carry both homepage arms, found: " + ARMS.join(", "));
for (const arm of ARMS) {
  const body = (VARIANTS[arm] || {}).body;
  if (!Array.isArray(body) || body.length !== CARDS) {
    throw new Error(`HOME_VARIANTS.${arm}.body should be ${CARDS} paragraphs, found ${Array.isArray(body) ? body.length : "none"}`);
  }
}

/** The title and the three cards exactly as the page will show them. */
function homeBlocks(code) {
  const d = dict(code);
  const h = (d && d.home) || {};
  const title = h.h1 || TITLE_EN;
  const cards = {};
  for (const arm of ARMS) {
    cards[arm] = h[arm.toLowerCase()] || VARIANTS[arm].body;
    if (!Array.isArray(cards[arm]) || cards[arm].length !== CARDS) {
      throw new Error(`${code}: ${arm} has ${Array.isArray(cards[arm]) ? cards[arm].length : "no"} paragraph(s), expected ${CARDS}`);
    }
  }
  return { title, cards, encourage: h.encourage || MOTIV_EN };
}

// The refs. Card 1 is per arm; cards 2 and 3 are one recording shared by both.
const REFS = [{ ref: "h/title", get: (b) => b.title }];
for (const arm of ARMS) REFS.push({ ref: "h/" + arm.toLowerCase(), get: (b) => b.cards[arm][0] });
for (let i = 1; i < CARDS; i += 1) REFS.push({ ref: "h/card" + (i + 1), get: (b) => b.cards[ARMS[0]][i] });
// The HP2 motivation card. It renders on the survey, not the hero, but it is the
// homepage's own "encourage" line and uses the same speaker, so it belongs here.
REFS.push({ ref: "h/encourage", get: (b) => b.encourage });

// Cards 2 and 3 must be word-for-word the same in every arm of every language,
// or one of the two arms would play a clip that says something else.
const drift = [];
for (const code of LANGS) {
  const { cards } = homeBlocks(code);
  for (let i = 1; i < CARDS; i += 1) {
    for (const arm of ARMS.slice(1)) {
      if (cards[arm][i] !== cards[ARMS[0]][i]) {
        drift.push(`${code}: card ${i + 1} differs between ${ARMS[0]} and ${arm}`);
      }
    }
  }
}
if (drift.length) {
  throw new Error(
    "the arms no longer share these cards, so one clip cannot serve both: " + drift.join(", ") +
    "\nGive the card its own ref per arm (h/<arm>.card<N>) in this file and in app.js's homeCardRef()."
  );
}

const jobs = [];
const texts = {};
for (const code of LANGS) {
  const blocks = homeBlocks(code);
  const seen = (texts[code] = {});
  for (const { ref, get } of REFS) {
    const text = get(blocks);
    if (!text) continue;
    seen[ref] = text;
    jobs.push({ lang: code, bucket: "h", key: ref.slice(2), text });
  }
}

if (!process.argv[2]) {
  console.error("usage: node _audio_home_jobs.js <out.json>");
  process.exit(1);
}
fs.writeFileSync(process.argv[2], JSON.stringify({ jobs, texts }));
console.log(
  "home audio: " + REFS.length + " refs (" + REFS.map((r) => r.ref.slice(2)).join(", ") + ") × " +
  LANGS.length + " languages = " + jobs.length + " jobs"
);
