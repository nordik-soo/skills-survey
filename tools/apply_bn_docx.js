#!/usr/bin/env node
/**
 * Write the Bengali dictionary from tests/fixtures/bn-docx.json.
 *
 * The fixture holds the uploaded questionnaire's Bengali text verbatim. This
 * script merges it into the `bn` bucket of translations.js:
 *   q[id]          <- the document's question line, byte for byte
 *   o[englishValue]< - the document's option line, byte for byte
 * Keys the document does not cover are left exactly as they were, so this only
 * adds missing translations and replaces differing ones.
 *
 * Only the `bn` block is rewritten; every other language is untouched.
 *
 *   node tools/apply_bn_docx.js          # write translations.js
 *   node tools/apply_bn_docx.js --check  # report what would change
 */
const fs = require("fs");

const FIXTURE = "tests/fixtures/bn-docx.json";
const TARGET = "translations.js";

// Matching key used by the fixture, mirroring tools/build_bn_docx_fixture.py.
function norm(s) {
  return String(s)
    .replace(/\u00a0/g, " ")
    .replace(/[\u200b]/g, "")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2265/g, ">=")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function loadSurvey() {
  const sb = { window: {}, document: { createElement: () => ({ style: {} }) } };
  sb.window = sb;
  new Function("window", "document", fs.readFileSync("survey-data.js", "utf8"))(sb, sb.document);
  return sb.SURVEY.QUESTIONS;
}

function loadDict() {
  const sb = { window: {}, document: { createElement: () => ({ style: {} }) } };
  sb.window = sb;
  new Function("window", "document", fs.readFileSync(TARGET, "utf8"))(sb, sb.document);
  return sb.window.I18N.dicts;
}

// Replace `    "bn": { ... }` in place, leaving the rest of the file untouched.
function spliceBn(text, serialized) {
  const marker = '\n    "bn": {';
  const at = text.indexOf(marker);
  if (at < 0) throw new Error('could not find the "bn" block');
  const start = at + 1;
  let i = text.indexOf("{", start);
  let depth = 0;
  let quote = null;
  for (; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) throw new Error('could not match the "bn" block braces');
  return text.slice(0, start) + serialized + text.slice(i + 1);
}

function serialize(bn) {
  // JSON.stringify keeps insertion order and UTF-8 text; re-indent to the
  // file's four-space style: the language key sits at 4, "q"/"o" at 6 and
  // their entries at 8.
  const lines = JSON.stringify(bn, null, 2)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")
    .split("\n");
  return lines
    .map((line, i) => (i === 0 ? '    "bn": {' : "    " + line))
    .join("\n");
}

// The consent screen must keep its two links (survey information letter and
// consent information). The document carries the same sentence without link
// markup, so the links go back around the matching phrases; the plain text
// remains the document's text, which is what the parity test compares.
function linkifyConsent(docxText, current) {
  const urls = [...String(current || "").matchAll(/\]\((https?:[^)]+)\)/g)].map((m) => m[1]);
  if (urls.length < 2) return docxText;
  let out = docxText;
  ["সার্ভের ইনফরমেশন লেটার", "কনসেইন্ট ফর্ম"].forEach((phrase, i) => {
    if (out.includes(phrase) && !out.includes(`[${phrase}]`)) {
      out = out.replace(phrase, `[${phrase}](${urls[i]})`);
    }
  });
  return out;
}

// Picklist values (country names) are canonical data: the survey shows them in
// English in every language, so they are deliberately not translated here.
const PICKLIST_QUESTIONS = new Set(["country_moved_from"]);

// The app offers "Don't know" where the document offers "Not sure". Rather than
// leaving one English label in the Bengali survey, the document's wording for
// that same idea is reused. This is the only non-verbatim mapping.
const ALIASES = { "Don't know": "Not sure" };

function main() {
  const check = process.argv.includes("--check");
  const fixture = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
  const questions = loadSurvey();
  const dict = loadDict();
  const bn = dict.bn;

  const added = [];
  const changed = [];

  for (const [id, entry] of Object.entries(fixture.questions)) {
    if (entry.text) {
      const docxText = id === "consent" ? linkifyConsent(entry.text, bn.q.consent) : entry.text;
      const before = bn.q[id];
      if (before === undefined) added.push(`q.${id}`);
      else if (before !== docxText) changed.push(`q.${id}`);
      bn.q[id] = docxText;
    }
  }

  for (const q of questions) {
    const entry = fixture.questions[q.id];
    if (!entry) continue;
    if (PICKLIST_QUESTIONS.has(q.id)) continue;
    for (const raw of q.options || []) {
      const value = typeof raw === "string" ? raw : raw.value;
      // Option labels are keyed by their English value across the whole survey,
      // and a value is often listed under several questions, so the lookup uses
      // the document-wide map rather than only this question's copy.
      const tr = fixture.options[norm(value)];
      if (!tr) continue;
      const before = bn.o[value];
      if (before === undefined) added.push(`o.${value.slice(0, 40)}`);
      else if (before !== tr) changed.push(`o.${value.slice(0, 40)}`);
      bn.o[value] = tr;
    }
  }

  // One wording the document does not have: the app's extra option.
  for (const [target, source] of Object.entries(ALIASES)) {
    if (bn.o[target] === undefined && bn.o[source] !== undefined) {
      bn.o[target] = bn.o[source];
      added.push(`o.${target} (from ${source})`);
    }
  }

  // Option labels that no question offers any more (older wording) and that the
  // document does not contain are dead weight: they cannot be displayed, and
  // leaving them would mean the Bengali dictionary contains text that is neither
  // reachable nor the document's. Drop them.
  const offered = new Set();
  for (const q of questions) {
    if (PICKLIST_QUESTIONS.has(q.id)) continue;
    for (const raw of q.options || []) offered.add(typeof raw === "string" ? raw : raw.value);
  }
  const stale = [];
  for (const key of Object.keys(bn.o)) {
    if (offered.has(key)) continue;
    // keep it only if it already holds the document's own text for that option
    if (fixture.options[norm(key)] === bn.o[key]) continue;
    stale.push(key);
    delete bn.o[key];
  }

  console.log(`translations from the document: ${Object.keys(fixture.questions).length} questions`);
  console.log(`added: ${added.length}   changed: ${changed.length}   removed (dead): ${stale.length}`);
  for (const k of stale) console.log("  -", k.slice(0, 45));
  for (const k of added.slice(0, 12)) console.log("  +", k);
  if (added.length > 12) console.log(`  ... ${added.length - 12} more`);
  for (const k of changed.slice(0, 12)) console.log("  ~", k);
  if (changed.length > 12) console.log(`  ... ${changed.length - 12} more`);

  if (check) return;

  const text = fs.readFileSync(TARGET, "utf8");
  const out = spliceBn(text, serialize(bn));
  fs.writeFileSync(TARGET, out, "utf8");

  // Parse the result the way the browser will.
  loadDict();
  console.log("translations.js rewritten and re-parsed");
}

main();
