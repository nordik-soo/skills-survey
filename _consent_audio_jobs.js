// Emit ONLY the consent-related audio jobs (revised consent question + the two
// renamed options) for every language, so we regenerate just those clips.
const fs = require("fs");
global.window = {};
require("./survey-data.js");
require("./translations.js");
const S = window.SURVEY;
const I = window.I18N;
const codes = Object.values(I.LANG_CODES); // en + 19
const stripMd = (s) => String(s).replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"); // link label only, no URL
const enConsent = S.QUESTIONS.find((q) => q.id === "consent").text;

const jobs = [];
for (const code of codes) {
  const isEn = code === "en";
  const M = isEn ? null : require("./_maps/" + code + ".js");
  const consent = isEn ? enConsent : (M.q.consent || enConsent);
  const yes = isEn ? "Yes, I confirm" : (M.o["Yes, I confirm"] || "Yes, I confirm");
  const no = isEn ? "No, I do not confirm" : (M.o["No, I do not confirm"] || "No, I do not confirm");
  jobs.push({ lang: code, bucket: "q", key: "consent", text: stripMd(consent) });
  jobs.push({ lang: code, bucket: "o", key: "Yes, I confirm", text: yes });
  jobs.push({ lang: code, bucket: "o", key: "No, I do not confirm", text: no });
}
fs.writeFileSync(process.argv[2], JSON.stringify({ jobs }, null, 0));
console.log("consent jobs:", jobs.length, "across", codes.length, "languages");
