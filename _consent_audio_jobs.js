// Emit ONLY the consent-related audio jobs (the consent question and its two
// options) for every shipped language, so those clips can be regenerated on
// their own. Text comes from translations.js — the same data the page renders —
// never from ./_maps, which is the parallel store that let a recording drift
// away from the wording on screen.
//   node _consent_audio_jobs.js <out.json>
const fs = require("fs");
global.window = {};
require("./survey-data.js");
require("./translations.js");
const S = window.SURVEY;
const I = window.I18N;
const LANGS = (I && I.LANGS) || ["en"];
const dict = (code) => (I && I.dicts && I.dicts[code]) || null;
const MD_LINK = /\[([^\]]+)\]\(([^)]+)\)/g;
const stripMd = (s) => String(s).replace(MD_LINK, "$1"); // link label only, no URL

const consentQ = S.QUESTIONS.find((q) => q.id === "consent");
if (!consentQ) throw new Error("survey-data.js has no consent question");
const enConsent = typeof consentQ.text === "function" ? consentQ.text({}) : consentQ.text;
const OPTION_VALUES = ["Yes, I confirm", "No, I do not confirm"];

const jobs = [];
for (const code of LANGS) {
  const d = dict(code);
  const consent = (d && d.q && d.q.consent) || enConsent;
  MD_LINK.lastIndex = 0;
  jobs.push({ lang: code, bucket: "q", key: "consent", text: MD_LINK.test(consent) ? stripMd(consent) : consent });
  for (const value of OPTION_VALUES) {
    const shown = (d && d.o && d.o[value]) || value;
    jobs.push({ lang: code, bucket: "o", key: value, text: shown });
  }
}

const out = process.argv[2];
if (!out) throw new Error("usage: node _consent_audio_jobs.js <out.json>");
fs.writeFileSync(out, JSON.stringify({ jobs }));
console.log("consent jobs:", jobs.length, "across", LANGS.length, "languages");
