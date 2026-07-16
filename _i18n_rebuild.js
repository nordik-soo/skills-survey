// Rebuild the ENTIRE DICT in translations.js from _maps/*.js.
// translations.js becomes a pure function of (survey-data.js + app.js + _maps/).
// Refuses to write if any language has a coverage gap or a stale key.
const fs = require("fs");

// ── source keys (single source of truth) ──
global.window = { NOC_DATA: { OCCUPATIONS: [], SKILLS: {} }, CIP_DATA: { OPTIONS: [] } };
eval(fs.readFileSync("survey-data.js", "utf8") + "\n;global.__S=window.SURVEY;");
const S = global.__S;
const qKeys = new Set(), oKeys = new Set(), helpKeys = new Set(), ph = new Set(), leg = new Set();
const defKeys = Object.keys(S.DEFINITIONS);
for (const q of S.QUESTIONS) {
  if (typeof q.text === "string") qKeys.add(q.id);
  if (q.help) helpKeys.add(q.id);
  if (q.placeholder) ph.add(q.placeholder);
  if (Array.isArray(q.legend)) q.legend.forEach((l) => leg.add(l));
  if (Array.isArray(q.options) && q.id !== "language" && q.id !== "country_moved_from") q.options.forEach((o) => oKeys.add(o));
}
["a", "b", "c", "d", "e"].forEach((x) => qKeys.add("work_barrier." + x));
const app = fs.readFileSync("app.js", "utf8");
const uiKeys = new Set([...ph, ...leg, "Type to search…", "Select one…"]);
const re = /\bS\("((?:[^"\\]|\\.)*)"/g;
let m; while ((m = re.exec(app))) uiKeys.add(m[1].replace(/\\"/g, '"'));
const NUMERIC_OK = new Set(["18-24", "25-34", "35-44", "45-54", "55-64", "65-74", "75-84"]);
const SRC = { q: qKeys, o: oKeys, help: helpKeys, def: new Set(defKeys), ui: uiKeys };

// ── build every language ──
const codes = fs.readdirSync("_maps").filter((f) => f.endsWith(".js")).map((f) => f.replace(/\.js$/, "")).sort();
const dicts = {};
let fatal = false;
for (const code of codes) {
  const MAP = require("./_maps/" + code + ".js");
  const dict = { q: {}, o: {}, help: {}, def: {}, ui: {} };
  const missing = {}, stale = {};
  for (const b of ["q", "o", "help", "def", "ui"]) {
    missing[b] = [];
    for (const k of SRC[b]) {
      if (MAP[b] && MAP[b][k] != null) dict[b][k] = MAP[b][k];
      else if (!(b === "o" && NUMERIC_OK.has(k))) missing[b].push(k);
    }
    stale[b] = Object.keys(MAP[b] || {}).filter((k) => !SRC[b].has(k));
  }
  const gaps = Object.entries(missing).filter(([, v]) => v.length);
  const stl = Object.entries(stale).filter(([, v]) => v.length);
  if (gaps.length || stl.length) {
    fatal = true;
    console.log(`[${code}] ✗`);
    gaps.forEach(([b, v]) => console.log(`    MISSING ${b}: ${JSON.stringify(v)}`));
    stl.forEach(([b, v]) => console.log(`    STALE   ${b}: ${JSON.stringify(v)}`));
  } else {
    const n = ["q", "o", "help", "def", "ui"].map((b) => `${b}:${Object.keys(dict[b]).length}`).join(" ");
    console.log(`[${code}] ✓  ${n}`);
  }
  dicts[code] = dict;
}
if (fatal) { console.error("\nNOT written — fix gaps/stale first."); process.exit(1); }

// ── splice the DICT block back into translations.js ──
let t = fs.readFileSync("translations.js", "utf8");
const startTok = "  const DICT = {";
const start = t.indexOf(startTok);
const afterTok = "\n  const codeFor";
const after = t.indexOf(afterTok, start);
if (start < 0 || after < 0) { console.error("anchors not found in translations.js"); process.exit(1); }
const endTok = "  };";
const end = t.lastIndexOf(endTok, after);
if (end < 0) { console.error("DICT close not found"); process.exit(1); }

const body = codes.map((c) => "    " + JSON.stringify(c) + ": " +
  JSON.stringify(dicts[c], null, 2).split("\n").map((l, i) => (i === 0 ? l : "    " + l)).join("\n") + ",").join("\n");
t = t.slice(0, start) + startTok + "\n" + body + "\n" + endTok + t.slice(end + endTok.length);
fs.writeFileSync("translations.js", t);
console.log(`\nrebuilt translations.js — ${codes.length} languages: ${codes.join(", ")}`);
