"use strict";
// The consent screen's letter used to end with an instruction: "Please print,
// save, or take a screenshot of this page for your records." That asked the
// respondent to do the work of a records copy by hand — on a phone the dialog
// scrolls, so a screenshot is truncated, and a picture of a consent document is
// not something a participant can read back later. It is now a card that hands
// them the documents themselves as a file.
//
// What must hold, and why each is a real risk here:
//
//   1. the instruction is gone from the screen, in every language, and the card
//      is what sits at the bottom instead. The wording lives in the approved
//      documents (translations.js / LETTER_INFO_BLOCKS carry a `note` block), so
//      the renderer drops it rather than the data losing it. If a *different*
//      note block were ever added it would vanish too, so the corpus is checked to
//      hold exactly the one closing instruction — a new one breaks the test loudly.
//   2. pressing it downloads a file. Checked by taking the blob the page hands
//      the browser and reading its text, not by trusting that click() ran, and the
//      file must be the documents: both titles, the consent points, the ethics
//      contact, print styles, and no reference to the network — it has to open
//      years later on a device that is offline.
//   3. the file is in the language on screen. A respondent who read the Spanish
//      letter must not be handed the English one; the file also carries lang and
//      dir, so Arabic opens right-to-left.
//   4. downloading is not an answer. The card is inside the consent step, whose
//      progress and consent answers are timed and stored; pressing it must change
//      neither, and must not close the card.
//
// Run: node tests/test_motiv_audio.js  (this file: node tests/test_download_letter.js)

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { findBrowser, serve, launch } = require("./helpers/browser.js");

const ROOT = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

let checks = 0;
function assert(ok, msg) {
  if (!ok) throw new Error(msg);
  checks++;
}
function eq(actual, expected, msg) {
  assert(actual === expected, `${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function includes(hay, needle, msg) {
  assert(String(hay).indexOf(needle) !== -1, msg + ": " + JSON.stringify(needle) + " not found");
}
function missing(hay, needle, msg) {
  assert(String(hay).indexOf(needle) === -1, msg + ": " + JSON.stringify(needle) + " is still there");
}

// ── the data the page reads ────────────────────────────────────────────────
const ctx = { window: {}, console };
ctx.global = ctx;
vm.createContext(ctx);
vm.runInContext(read("translations.js"), ctx);
const I18N = ctx.window.I18N;
const LANGS = (I18N && I18N.LANGS) || [];
const dict = (code) => (I18N.dicts && I18N.dicts[code]) || null;
const APP = read("app.js");
const CSS = read("app.css");

const OLD = "print, save, or take a screenshot";
// The card is the word alone: one small button, not a block. What it does lives
// in the tooltip and the accessible name, which cost no space on screen.
const CARD_KEYS = [
  "The survey information letter and the consent information, as one file you can keep.",
  "Download",
  "Saved to your device.",
  "The download did not start. Please try again.",
];

// ── 1. the instruction is replaced, in the code and in every language ──────
assert(APP.indexOf("modal-note") === -1, "the letter still renders its old closing note");

for (const code of LANGS.filter((c) => c !== "en")) {
  const home = (dict(code) && dict(code).home) || {};
  const letter = Array.isArray(home.letter) ? home.letter : [];
  const notes = letter.filter((b) => b && b.note);
  assert(letter.length >= 20, `${code}: the letter has only ${letter.length} blocks`);
  // The translated letters still carry the closing instruction, because those are
  // the approved documents and the build does not rewrite them. The renderer
  // drops it. Exactly one note block is expected: a second one would disappear
  // with nobody noticing, so this count is the tripwire for that.
  eq(notes.length, 1, `${code}: the letter's note blocks (the closing instruction is expected to be the only one)`);
  assert(/records|print|imprimir|imprima|imprime|screenshot|captura|रिकॉर्ड|prů|طباعة|لقطة|打印|截图|i-print/i.test(notes[0].note || ""),
    `${code}: the letter's note block is not the closing instruction the card replaces`);
  const ui = (dict(code) && dict(code).ui) || {};
  for (const key of CARD_KEYS) {
    // Short strings are legitimate: Chinese says "下载" and Arabic "تنزيل". What
    // matters is that the key exists, is not blank, and is not the English text
    // passed through.
    assert(typeof ui[key] === "string" && ui[key].trim().length > 0,
      `${code}: the download card has no translation for ${JSON.stringify(key)}`);
    assert(ui[key].trim() !== key, `${code}: the card's ${JSON.stringify(key)} is the English string unchanged`);
  }
}

// The English letter is in app.js; its closing instruction block was removed from
// the source, so no English respondent can see it. Comment lines are stripped:
// the code explains the removal in a comment that quotes the old sentence.
const enMaster = APP.slice(APP.indexOf("const LETTER_INFO_BLOCKS = ["));
const enBody = enMaster
  .slice(0, enMaster.indexOf("\n  ];"))
  .split("\n")
  .filter((line) => !/^\s*\/\//.test(line))
  .join("\n");
assert(enBody.length > 1000, "could not read the English letter blocks");
eq((enBody.match(/note:/g) || []).length, 0, "the English letter still carries its closing instruction block");
missing(enBody, "for your records", "the English letter still carries the print/save instruction");
assert((enBody.match(/\{ p: /g) || []).length >= 10, "the English letter lost its paragraphs");
assert((enBody.match(/\{ h: /g) || []).length >= 6, "the English letter lost its section headings");

// Every language renders with the same builder, and that builder drops notes.
assert(/if \(b\.note\) return ""/.test(APP),
  "the card builder does not skip the closing instruction block");
assert(APP.indexOf("b.note") !== -1, "the note branch disappeared from the builder");

// ── 2. the browser: the card, the file, the language, the state ────────────
const site = () => serve(ROOT);
const seed = (answers) => `(() => {
  localStorage.clear();
  localStorage.setItem("sault_survey_draft_v1", JSON.stringify({
    answers: ${JSON.stringify(answers)}, currentId: "consent", respondentId: null, timings: {} }));
  return 1; })()`;
const CONSENTED = { consent: "Yes, I confirm", eligible: "Yes" };

// Capture what the page hands the browser instead of relying on the shelf.
const CAPTURE = `(() => {
  window.__dl = { blobs: [], names: [], types: [] };
  const realCreate = URL.createObjectURL;
  URL.createObjectURL = function (obj) { window.__dl.blobs.push(obj); return realCreate.call(URL, obj); };
  HTMLAnchorElement.prototype.click = function () {
    window.__dl.names.push(this.download); window.__dl.types.push(this.type);
  };
  return 1; })()`;

const GRAB = `(async () => {
  const card = document.querySelector(".modal-download");
  const tall = Math.round(card.getBoundingClientRect().height);
  card.click();
  await new Promise((r) => setTimeout(r, 700));
  const blob = window.__dl.blobs[0];
  const text = blob ? await blob.text() : "";
  return {
    name: window.__dl.names[0] || "",
    type: (blob && blob.type) || "",
    size: (blob && blob.size) || 0,
    text: text,
    status: (document.querySelector(".modal-download-status") || {}).textContent || "",
    statusShown: !!document.querySelector(".modal-download-status")
      && document.querySelector(".modal-download-status").getBoundingClientRect().height > 0,
    marked: card.classList.contains("is-downloaded"),
    cardStillOpen: !!document.querySelector(".modal-overlay") && document.body.contains(card),
    tall: tall,
  };
})()`;

// The letter's link in the consent step, by its visible label.
const OPEN = (label) => `(() => {
  const hit = [...document.querySelectorAll("a, button")]
    .filter((n) => (n.textContent || "").trim().indexOf(${JSON.stringify(label)}) !== -1)[0];
  if (!hit) return false;
  hit.click();
  return true;
})()`;

const MODAL = `(() => {
  const o = document.querySelector(".modal-overlay");
  if (!o) return { open: false };
  const body = o.querySelector(".modal-body");
  const card = body.querySelector(".modal-download");
  return {
    open: true,
    text: o.textContent,
    hasNote: !!o.querySelector(".modal-note"),
    cardIsLast: !!card && body.lastElementChild === card.parentElement,
    cardTag: card ? card.tagName : "",
    cardType: card ? card.getAttribute("type") : "",
    paragraphs: body.querySelectorAll(".modal-p").length,
    headings: body.querySelectorAll(".modal-h").length,
    consentCardIsSeparate: !!body.querySelector(".modal-list"),
  };
})()`;

(async () => {
  const server = await site();
  const browser = await launch(findBrowser());
  const page = browser.page;
  try {
    // ── the letter as an English respondent meets it ──────────────────────
    await page.goto(server.origin + "/index.html?dl=1#/", 1280, 900);
    await page.evaluate(seed(CONSENTED));
    await page.reload();
    await page.evaluate("document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 250)))");
    await page.setHash("#/survey");
    await page.evaluate("new Promise((r) => setTimeout(r, 600))");

    eq(await page.evaluate(OPEN("Survey Information Letter")), true, "the letter's link did not open a card");
    await page.evaluate("new Promise((r) => setTimeout(r, 400))");

    const letter = await page.evaluate(MODAL);
    eq(letter.open, true, "the letter card did not open");
    eq(letter.hasNote, false, "the old print/save instruction is still rendered");
    missing(letter.text, OLD, "the letter card still carries the instruction");
    missing(letter.text, "for your records", "the letter card still carries the instruction's ending");
    eq(letter.cardIsLast, true, "the download card is not the last thing in the letter");
    eq(letter.cardTag, "BUTTON", "the download card is not a button, so it cannot be pressed by keyboard or screen reader");
    eq(letter.cardType, "button", "the download card is not type=button");
    // positive control: the rest of the letter still rendered
    assert(letter.paragraphs >= 10, "the letter lost its paragraphs (" + letter.paragraphs + ")");
    assert(letter.headings >= 2, "the letter lost its section headings (" + letter.headings + ")");
    eq(letter.consentCardIsSeparate, false, "the letter is showing the consent card's list");

    // the card says what it does, in English, and is a real size to press
    const wording = await page.evaluate(`(() => {
      const c = document.querySelector(".modal-download");
      const t = c.querySelector(".modal-download-cta").textContent.trim();
      const r = c.getBoundingClientRect();
      const cardBox = document.querySelector(".modal-card").getBoundingClientRect();
      const body = document.querySelector(".modal-body");
      return { t: t, label: c.getAttribute("aria-label") || "", tip: c.getAttribute("title") || "",
        w: Math.round(r.width), h: Math.round(r.height),
        spans: Math.round((r.width / body.getBoundingClientRect().width) * 100),
        sharesRowWithNothing: r.width < cardBox.width,
        extraText: (c.textContent || "").replace(t, "").trim(),
        children: c.querySelectorAll("span, svg, img, p, div").length };
    })()`);
    eq(wording.t, "Download", "the card's only word");
    // The whole card is small: one word, not a block spanning the letter.
    eq(wording.children, 1, "the card holds more than its one word (" + wording.children + " elements inside)");
    eq(wording.extraText, "", "the card carries text besides the word Download: " + JSON.stringify(wording.extraText));
    assert(wording.spans < 45, "the card is " + wording.spans + "% of the letter's width; it should be a small button");
    assert(wording.w < 200, "the card is " + wording.w + "px wide");
    assert(wording.h >= 40, "the card is only " + wording.h + "px tall to press");
    assert(wording.h <= 60, "the card is " + wording.h + "px tall; that is a block again");
    // The explanation still reaches whoever needs it: a tooltip and a name.
    const WHAT = "The survey information letter and the consent information, as one file you can keep.";
    eq(wording.label, WHAT, "the card has no accessible name saying what it downloads");
    eq(wording.tip, wording.label, "the card's tooltip does not match its accessible name");

    // No visible explanation and no status line before the press.
    const quiet = await page.evaluate(`(() => {
      const wrap = document.querySelector(".modal-download-wrap");
      const status = wrap.querySelector(".modal-download-status");
      const box = wrap.getBoundingClientRect();
      return { lines: wrap.querySelectorAll("p, .modal-download-title, .modal-download-hint").length,
        statusShown: status.getBoundingClientRect().height > 0, statusText: status.textContent.trim(),
        icons: wrap.querySelectorAll("svg, img").length,
        height: Math.round(box.height) };
    })()`);
    eq(quiet.statusShown, false, "an empty confirmation line takes room above the card");
    eq(quiet.statusText, "", "the confirmation says something before anything was pressed");
    eq(quiet.icons, 0, "the card still carries an icon");
    assert(quiet.height <= 100, "the card's footer is " + quiet.height + "px tall; it should be the button alone");

    // The whole card is the target. It is one word wide, so the check is that a
    // press anywhere on the button reaches it, including its padding.
    const targets = await page.evaluate(`(() => {
      const card = document.querySelector(".modal-download");
      card.scrollIntoView({ block: "center" });
      const r = card.getBoundingClientRect();
      const probe = (x, y) => {
        const hit = document.elementFromPoint(x, y);
        return !!hit && (hit === card || card.contains(hit));
      };
      return {
        middle: probe(r.left + r.width / 2, r.top + r.height / 2),
        leftPad: probe(r.left + 3, r.top + r.height / 2),
        rightPad: probe(r.right - 3, r.top + r.height / 2),
        topPad: probe(r.left + r.width / 2, r.top + 3),
        bottomPad: probe(r.left + r.width / 2, r.bottom - 3),
      };
    })()`);
    for (const where of ["middle", "leftPad", "rightPad", "topPad", "bottomPad"]) {
      eq(targets[where], true, "a press on the card's " + where + " does not reach the button");
    }

    // ── pressing it ───────────────────────────────────────────────────────
    const before = await page.evaluate(`(() => JSON.parse(localStorage.getItem("sault_survey_draft_v1") || "{}"))()`);
    await page.evaluate(CAPTURE);
    const got = await page.evaluate(GRAB);
    const after = await page.evaluate(`(() => JSON.parse(localStorage.getItem("sault_survey_draft_v1") || "{}"))()`);

    eq(got.name, "sault-survey-information-en.html", "the downloaded file's name");
    includes(got.type, "text/html", "the downloaded file is not HTML, so no browser will open it");
    assert(got.size > 3000, "the downloaded file is only " + got.size + " bytes");
    assert(got.tall >= 40 && got.tall <= 60, "after the press the card is " + got.tall + "px tall; it should stay a small button");
    eq(got.cardStillOpen, true, "downloading closed the card, so the respondent cannot read on");
    includes(got.status, "Saved", "the card did not confirm the download");
    eq(got.statusShown, true, "the card's confirmation is not shown after the press");
    eq(got.marked, true, "the card did not mark itself as downloaded");
    // downloading is not an answer
    eq(JSON.stringify(after.answers), JSON.stringify(before.answers), "downloading changed the answers");
    eq(JSON.stringify(after.timings), JSON.stringify(before.timings), "downloading changed the timing record");
    eq(after.currentId, before.currentId, "downloading moved the survey on");

    // ── the file's contents ───────────────────────────────────────────────
    const file = got.text;
    includes(file, "<!doctype html>", "the file is not a document");
    includes(file, 'lang="en"', "the file does not declare its language");
    includes(file, 'dir="ltr"', "the file does not declare its direction");
    includes(file, "INFORMATION LETTER", "the file is missing the letter");
    includes(file, "CONSENT INFORMATION", "the file is missing the consent information");
    includes(file, "ethicsoffice@algomau.ca", "the file is missing the ethics contact");
    includes(file, "@media print", "the file has no print styles, so it cannot be saved as a clean PDF");
    missing(file, OLD, "the file repeats the print/save instruction");
    // self-contained: nothing to fetch, nothing to break offline
    eq(file.split("http").length - 1, 0, "the file points at the network, so it rots or fails offline");
    assert(file.indexOf("<script") === -1, "the downloaded file carries script");
    // both halves are complete
    const parts = file.split('class="doc-part"');
    eq(parts.length, 2, "the file does not hold the letter and the consent section as two parts");
    assert(file.length > 4000, "the file is truncated at " + file.length + " characters");

    // Escape the card; the survey is still where it was.
    await page.evaluate(`document.querySelector(".modal-close").click()`);
    await page.evaluate("new Promise((r) => setTimeout(r, 300))");
    eq(await page.evaluate(`!!document.querySelector(".modal-overlay")`), false, "the card did not close");

    // ── the same card on a phone ──────────────────────────────────────────
    await page.goto(server.origin + "/index.html?dl=phone#/", 390, 844);
    await page.evaluate(seed(CONSENTED));
    await page.reload();
    await page.evaluate("document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 250)))");
    await page.setHash("#/survey");
    await page.evaluate("new Promise((r) => setTimeout(r, 600))");
    eq(await page.evaluate(OPEN("Survey Information Letter")), true, "on a phone the letter's link did not open");
    await page.evaluate("new Promise((r) => setTimeout(r, 400))");
    const phone = await page.evaluate(`(() => {
      const card = document.querySelector(".modal-download");
      if (!card) return { card: false };
      card.scrollIntoView({ block: "center" });
      const r = card.getBoundingClientRect();
      const cardBox = document.querySelector(".modal-card").getBoundingClientRect();
      const cta = card.querySelector(".modal-download-cta");
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        card: true,
        w: Math.round(r.width), h: Math.round(r.height),
        insideCard: r.left >= cardBox.left - 0.5 && r.right <= cardBox.right + 0.5,
        // the word must never be hidden to make room, as an earlier layout did
        wordVisible: cta.getBoundingClientRect().height > 0 && cta.textContent.trim().length > 0,
        hitIsButton: !!hit && (hit === card || card.contains(hit)),
        isLast: document.querySelector(".modal-body").lastElementChild.classList.contains("modal-download-wrap"),
      };
    })()`);
    eq(phone.card, true, "the phone's letter has no download card");
    eq(phone.insideCard, true, "on a phone the download card overflows the letter's edge");
    eq(phone.wordVisible, true, "on a phone the word Download is hidden");
    eq(phone.hitIsButton, true, "on a phone a press on the card does not reach the button");
    eq(phone.isLast, true, "on a phone the download card is not the last thing in the letter");
    assert(phone.h >= 40, "on a phone the card is only " + phone.h + "px tall to press");
    assert(phone.w < 200, "on a phone the card is " + phone.w + "px wide; it should still be a small button");
    await page.evaluate(CAPTURE);
    const phoneGot = await page.evaluate(GRAB);
    eq(phoneGot.name, "sault-survey-information-en.html", "the phone download's name");
    assert(phoneGot.size > 3000, "the phone's file is only " + phoneGot.size + " bytes");
    await page.evaluate(`document.querySelector(".modal-close").click()`);
    await page.evaluate("new Promise((r) => setTimeout(r, 300))");
    eq(await page.evaluate(`!!document.querySelector(".modal-overlay")`), false,
      "on a phone the card did not close");

    // ── the consent card has no download card of its own ──────────────────
    await page.evaluate(OPEN("Consent Information"));
    await page.evaluate("new Promise((r) => setTimeout(r, 350))");
    const consent = await page.evaluate(MODAL);
    eq(consent.open, true, "the consent card did not open");
    eq(await page.evaluate(`!!document.querySelector(".modal-download")`), false,
      "the consent card carries a download card; the file is offered at the letter only");
    eq(await page.evaluate(`!!document.querySelector(".modal-note")`), false,
      "the consent card renders a note");
    assert(consent.paragraphs + consent.headings === 0, "the consent card is not the points list");
    await page.evaluate(`document.querySelector(".modal-close").click()`);
    await page.evaluate("new Promise((r) => setTimeout(r, 250))");

    // ── the file follows the language on screen ───────────────────────────
    const SWITCH = (code) => `(() => {
      document.querySelector("#lang-btn").click();
      const item = [...document.querySelectorAll(".lang-menu .lang-item")]
        .filter((n) => n.getAttribute("lang") === ${JSON.stringify(code)})[0];
      if (!item) return false;
      item.click();
      return true;
    })()`;

    eq(await page.evaluate(SWITCH("es")), true, "the language menu has no Spanish");
    await page.evaluate("new Promise((r) => setTimeout(r, 450))");
    const esHome = dict("es").home;
    // The link's label is the dictionary's own, so find it that way.
    eq(await page.evaluate(OPEN(esHome.letterTitle)), true, "the Spanish letter's link did not open");
    await page.evaluate("new Promise((r) => setTimeout(r, 400))");
    eq(await page.evaluate(`!!document.querySelector(".modal-note")`), false,
      "the Spanish letter still renders its closing instruction");
    const esText = await page.evaluate(`document.querySelector(".modal-overlay").textContent`);
    missing(esText, "captura de pantalla", "the Spanish letter still tells the respondent to take a screenshot");
    const esWording = await page.evaluate(`(() => {
      const c = document.querySelector(".modal-download");
      return { label: c.getAttribute("aria-label") || "", tip: c.getAttribute("title") || "",
        cta: c.querySelector(".modal-download-cta").textContent.trim() };
    })()`);
    eq(esWording.cta, dict("es").ui["Download"], "the Spanish card's word is not translated");
    eq(esWording.label, dict("es").ui["The survey information letter and the consent information, as one file you can keep."],
      "the Spanish card's accessible name is not translated");
    eq(esWording.tip, esWording.label, "the Spanish card's tooltip is not translated");

    await page.evaluate(CAPTURE);
    const es = await page.evaluate(GRAB);
    eq(es.name, "sault-survey-information-es.html", "the Spanish download's name");
    includes(es.text, 'lang="es"', "the Spanish file does not declare its language");
    includes(es.text, esHome.letterTitle, "the Spanish file is missing the Spanish letter's title");
    includes(es.text, esHome.consentTitle, "the Spanish file is missing the Spanish consent title");
    includes(es.text, esHome.consentPoints[0].slice(0, 40), "the Spanish file is missing the Spanish consent points");
    missing(es.text, "CONSENT INFORMATION", "the Spanish file contains the English consent section");
    missing(es.text, "INFORMATION LETTER", "the Spanish file contains the English letter title");
    // and the English file did carry English, so the check above is not vacuous
    includes(file, "INFORMATION LETTER", "the English file is missing its letter title");

    await page.evaluate(`document.querySelector(".modal-close").click()`);
    await page.evaluate("new Promise((r) => setTimeout(r, 250))");

    // ── right-to-left: the file opens the right way round ────────────────
    eq(await page.evaluate(SWITCH("ar")), true, "the language menu has no Arabic");
    await page.evaluate("new Promise((r) => setTimeout(r, 500))");
    eq(await page.evaluate(OPEN(dict("ar").home.letterTitle)), true, "the Arabic letter's link did not open");
    await page.evaluate("new Promise((r) => setTimeout(r, 400))");
    await page.evaluate(CAPTURE);
    const ar = await page.evaluate(GRAB);
    eq(ar.name, "sault-survey-information-ar.html", "the Arabic download's name");
    includes(ar.text, 'dir="rtl"', "the Arabic file does not open right-to-left");
    includes(ar.text, dict("ar").home.letterTitle, "the Arabic file is missing the Arabic letter");
    await page.evaluate(`document.querySelector(".modal-close").click()`);
    await page.evaluate("new Promise((r) => setTimeout(r, 250))");

    // ── and once the respondent is past consent, nothing lingers ──────────
    eq(await page.evaluate(`!!document.querySelector(".modal-overlay")`), false,
      "a card is still on screen after closing");

    // the stylesheet carries the card, in the same family as the modal
    includes(CSS, ".modal-download {", "app.css has no download card");
    // The old layout hid the word on narrow phones to make room for a sentence;
    // with the sentence gone, nothing may hide the word.
    assert(CSS.indexOf("modal-download-cta { display: none") === -1,
      "app.css still hides the card's word on narrow screens");
    assert(CSS.indexOf(".modal-download-title") === -1, "app.css still styles a title that is not on the card");
    assert(CSS.indexOf(".modal-download-hint") === -1, "app.css still styles a hint that is not on the card");
    assert(/\.modal-download-wrap \{[^}]*flex-direction: column/.test(CSS),
      "the card's footer is not a column, so the card and its confirmation do not stack");
    assert(CSS.indexOf(".modal-note") === -1, "app.css still styles the removed note");

    // ── the file opens as a document, on a device with no network ─────────
    // Written to disk and opened the way a respondent will open it: from the
    // downloads shelf, as a local file. Nothing in it may fetch.
    const tmpName = ".tmp-download-check.html";
    const tmp = path.join(ROOT, tmpName);
    fs.writeFileSync(tmp, file, "utf8");
    try {
      await page.goto(server.origin + "/" + tmpName, 900, 800);
      const rendered = await page.evaluate(`(() => ({
        titles: [...document.querySelectorAll("h1")].map((n) => n.textContent.trim()),
        points: document.querySelectorAll(".modal-list li").length,
        paragraphs: document.querySelectorAll(".modal-p").length,
        headings: document.querySelectorAll(".modal-h").length,
        scripts: document.querySelectorAll("script").length,
        fetched: performance.getEntriesByType("resource").length,
        paper: getComputedStyle(document.body).backgroundColor,
      }))()`);
      eq(rendered.titles.length, 2, "the file does not open as two titled sections");
      includes(rendered.titles.join(" | "), "INFORMATION LETTER", "the opened file has no letter");
      includes(rendered.titles.join(" | "), "CONSENT INFORMATION", "the opened file has no consent section");
      assert(rendered.paragraphs >= 10, "the opened file shows only " + rendered.paragraphs + " paragraphs");
      assert(rendered.headings >= 6, "the opened file shows only " + rendered.headings + " headings");
      assert(rendered.points >= 4, "the opened file shows only " + rendered.points + " consent points");
      eq(rendered.scripts, 0, "the opened file runs script");
      eq(rendered.fetched, 0, "the opened file fetched something over the network");
      eq(rendered.paper, "rgb(255, 255, 255)", "the opened file is not set on white paper");

      // and at phone width, where a records copy is most likely to be opened
      await page.goto(server.origin + "/" + tmpName, 390, 844);
      const narrow = await page.evaluate(`(() => {
        const wide = [...document.querySelectorAll(".modal-p, .modal-list li, h1")]
          .filter((n) => n.getBoundingClientRect().width > 0);
        return {
          widest: Math.round(Math.max.apply(null, wide.map((n) => n.getBoundingClientRect().right))),
          viewport: innerWidth,
          overflowX: document.documentElement.scrollWidth > innerWidth + 1,
        };
      })()`);
      eq(narrow.overflowX, false, "the file scrolls sideways on a phone");
      assert(narrow.widest <= narrow.viewport, "the file's text runs past a phone's screen edge (" + narrow.widest + " > " + narrow.viewport + ")");
    } finally {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
  } finally {
    await browser.close();
    await server.close();
  }
  console.log(`${checks} checks passed: the letter offers its documents as a file instead of asking for a screenshot.`);
})().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
