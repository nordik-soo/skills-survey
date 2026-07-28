// Add the "Listen" UI string (text-to-speech button label) to every map's ui
// bucket. English is the source. DRAFT pending fluent review.
const fs = require("fs");
const K = "Listen";
const T = {
  fr: "Écouter", es: "Escuchar", pt: "Ouvir", it: "Ascolta", de: "Anhören",
  pl: "Posłuchaj", uk: "Прослухати", fi: "Kuuntele", tl: "Pakinggan",
  hi: "सुनें", bn: "শুনুন", pa: "ਸੁਣੋ", gu: "સાંભળો", ta: "கேளுங்கள்",
  ml: "കേൾക്കുക", zh: "朗读", ar: "استمع", ur: "سنیں", ku: "Guhdarî bike",
};
let n = 0, errs = [];
for (const [code, val] of Object.entries(T)) {
  const p = "_maps/" + code + ".js";
  if (!fs.existsSync(p)) { errs.push(`${code}: no map`); continue; }
  let t = fs.readFileSync(p, "utf8");
  const uiAt = t.indexOf("  ui: {");
  if (uiAt < 0) { errs.push(`${code}: no ui bucket`); continue; }
  const close = t.indexOf("  },", uiAt);
  if (close < 0) { errs.push(`${code}: ui close not found`); continue; }
  const keyRe = new RegExp("^[ \\t]*" + JSON.stringify(K).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ":", "m");
  if (keyRe.test(t)) { console.log(`[${code}] already present`); continue; }
  const add = "    " + JSON.stringify(K) + ": " + JSON.stringify(val) + ",\n";
  t = t.slice(0, close) + add + t.slice(close);
  fs.writeFileSync(p, t);
  n++;
}
console.log("maps updated:", n);
if (errs.length) { console.error("ERRORS:\n  " + errs.join("\n  ")); process.exit(1); }
