"use strict";
// The HP2 motivation card carries a speaker at the end of its paragraph, and it
// reads the line in the language on screen.
//
// The card shows `dict().home.encourage || MOTIV_TEXT` — the homepage's own
// "encourage" line. Three things can go wrong with a speaker on it, and each one
// is a real bug this project has already had somewhere else:
//
//   1. no recording, or a recording of the wrong wording. Every other speaker on
//      the site prefers a pre-generated clip and falls back to the device voice,
//      which is not the voice the rest of the survey uses — and with no clip AND
//      no device voice for that language, speakBtn() returns null and the icon is
//      missing entirely. So every language must have its clip, and the clip must
//      have been recorded from the string the card shows. audio/motiv_texts.json
//      records that string; the static checks below re-derive it from
//      translations.js and app.js's MOTIV_TEXT.
//   2. the card swallowed the tap. `.motiv-card` is `pointer-events: none` (taps
//      pass through to the question), so an icon that does not take taps back is
//      unpressable — it looks fine and does nothing. Checked by hit-testing the
//      icon's centre point, which is what a finger hits.
//   3. a switch of language left a stale card. The card is built once and nothing
//      else rebuilds it, so before this change switching to Spanish translated the
//      question while the card kept its English line. A speaker makes that worse:
//      the icon would carry the ENGLISH clip ref for ever. The switch checks assert
//      the rebuilt text, the rebuilt aria-label AND the clip actually requested.
//
// The last two checks keep the work from overshooting: the card is still HP2-only,
// and a clip started from the card must stop when the respondent advances (the card
// is removed; a voice left reading with no control to stop it is a bug, and it is
// the "audio outlives its button" failure).
//
// Run: node tests/test_motiv_audio.js

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

// ── the data the page reads ────────────────────────────────────────────────
const ctx = { window: {}, console };
ctx.global = ctx;
vm.createContext(ctx);
vm.runInContext(read("translations.js"), ctx);
const I18N = ctx.window.I18N;
const LANGS = (I18N && I18N.LANGS) || [];
const dict = (code) => (I18N.dicts && I18N.dicts[code]) || null;

const APP = read("app.js");
const MANIFEST = JSON.parse(read(path.join("audio", "manifest.json")));
const TEXTS = JSON.parse(read(path.join("audio", "motiv_texts.json")));
const REF = "h/encourage";

// app.js's own English fallback, read out of the source so the two cannot drift.
const MOTIV_TEXT = (APP.match(/const MOTIV_TEXT = "([^"]+)";/) || [])[1];

/** The card's line exactly as showMotivationCard()/renderMotivBody() draws it. */
function cardText(code) {
  const d = dict(code);
  return (d && d.home && d.home.encourage) || MOTIV_TEXT;
}

// A draft past the consent and eligibility gates, parked on "gender" — the
// earliest unconditional question, whose pre-test median is the shortest we can
// rely on (7100ms).
const GENDER = "gender";
const PAST_MEDIAN = 7900;
const BACK = { consent: "Yes, I confirm", eligible: "Yes" };
const SEED = (arm) => `(() => {
  localStorage.clear();
  localStorage.setItem("sault_home_variant_v1", ${JSON.stringify(arm)});
  localStorage.setItem("sault_survey_draft_v1", JSON.stringify({
    answers: ${JSON.stringify(BACK)},
    currentId: ${JSON.stringify(GENDER)},
    respondentId: null,
    timings: {},
  }));
  return 1;
})()`;

const PICK = (code) => `(() => {
  const btn = document.querySelector("#lang-btn");
  if (!btn) return "no language button in the header";
  btn.click();
  const item = Array.prototype.slice.call(document.querySelectorAll(".lang-menu .lang-item"))
    .filter((n) => n.getAttribute("lang") === ${JSON.stringify(code)})[0];
  if (!item) return "no " + ${JSON.stringify(code)} + " in the language list";
  item.click();
  return "";
})()`;

// The card as a respondent meets it: the icon's place in the paragraph, its size,
// whether a tap on it reaches it, and the text it reads.
const CARD = `(() => {
  const card = document.getElementById("motiv-card");
  if (!card) return { present: false };
  const p = card.querySelector("p");
  const sp = p && p.querySelector(".speak-btn");
  const cr = card.getBoundingClientRect();
  const pr = p ? p.getBoundingClientRect() : null;
  const sr = sp ? sp.getBoundingClientRect() : null;
  const hit = sr ? document.elementFromPoint(sr.left + sr.width / 2, sr.top + sr.height / 2) : null;
  // Where the final word of the line actually ends. Being the last element child is
  // not enough — an icon written before the text is still the only element — so this
  // measures the box of the paragraph's last character and asks the icon to follow it
  // on the same line (to the left of it in an RTL paragraph, which is "after" there).
  let textEnd = null;
  for (let i = 0; i < p.childNodes.length; i += 1) {
    const n = p.childNodes[i];
    if (n.nodeType === 3 && n.nodeValue && n.nodeValue.replace(/\\s+$/, "").length) textEnd = n;
  }
  let afterLastWord = false;
  if (sr && textEnd) {
    const body = textEnd.nodeValue.replace(/\\s+$/, "");
    const rng = document.createRange();
    rng.setStart(textEnd, body.length - 1);
    rng.setEnd(textEnd, body.length);
    const wr = rng.getBoundingClientRect();
    const rtl = getComputedStyle(p).direction === "rtl";
    const sameLine = Math.abs(sr.top + sr.height / 2 - (wr.top + wr.height / 2)) < 6;
    afterLastWord = sameLine && (rtl ? sr.right <= wr.left + 1 : sr.left >= wr.right - 1);
  }
  return {
    present: true,
    lastChild: !!sp && p.lastElementChild === sp,
    hasIcon: !!sp,
    aria: sp ? sp.getAttribute("aria-label") : null,
    speaks: !!sp && sp.hasAttribute("role") && sp.getAttribute("role") === "button",
    width: sr ? Math.round(sr.width) : null,
    height: sr ? Math.round(sr.height) : null,
    // a tap on the icon must land on the icon, not the question behind the card
    tapHitsIcon: !!hit && (hit === sp || sp.contains(hit)),
    insideCard: !!sr && sr.right <= cr.right + 0.5 && sr.bottom <= cr.bottom + 0.5
      && sr.left >= cr.left - 0.5 && sr.top >= cr.top - 0.5,
    afterLastWord: afterLastWord,
    insideText: !!sr && !!pr && sr.bottom <= pr.bottom + 0.5,
    text: p ? p.textContent.replace(/\\s+$/, "") : null,
    cardHeight: Math.round(cr.height),
    lang: document.documentElement.lang,
  };
})()`;

// Every /audio/ file the page has fetched, so a press can be followed to its clip.
const AUDIO = `(() => performance.getEntriesByType("resource")
  .map((r) => r.name).filter((n) => n.indexOf("/audio/") !== -1))()`;

// Record every <audio> the page creates. The card's own button leaves the DOM with
// the card, so "is it still reading?" cannot be asked of the DOM — the answer lives
// in the media element, which is what would keep playing over the next question.
const SPY_AUDIO = `(() => {
  if (window.__spyInstalled) return 1;
  window.__spyInstalled = true;
  window.__audios = [];
  const Real = window.Audio;
  window.Audio = function (url) { const a = new Real(url); window.__audios.push(a); return a; };
  return 1;
})()`;
const AUDIO_STATE = `(() => {
  const all = window.__audios || [];
  const last = all[all.length - 1];
  return { count: all.length, paused: last ? last.paused : null, src: last ? last.src.split("/").pop() : null };
})()`;

// Press the card's speaker and report the clip it asked for. The press is a real
// click at the icon's centre, the way a tap arrives.
function PRESS() {
  return `(() => {
  const sp = document.querySelector("#motiv-card .speak-btn");
  if (!sp) return Promise.resolve({ error: "the card has no speaker" });
  const before = ${AUDIO};
  const r = sp.getBoundingClientRect();
  const target = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  if (!target) return Promise.resolve({ error: "nothing at the icon's centre" });
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  return new Promise((done) => setTimeout(() => {
    const after = ${AUDIO};
    const fresh = after.filter((n) => before.indexOf(n) === -1);
    done({
      requested: fresh,
      speaking: sp.classList.contains("speaking"),
      anySpeaking: document.querySelectorAll(".speak-btn.speaking").length,
    });
  }, 900));
})()`;
}

async function main() {
  // ── static: every language has its recording, of the right words ─────────
  eq(LANGS.length, 9, "translations.js advertises its languages");

  for (const code of LANGS) {
    const line = cardText(code);
    assert(typeof line === "string" && line.trim().length > 20, `${code}: the card line is missing`);
    // the baseline says what the clip was recorded from
    const recorded = TEXTS[code] && TEXTS[code][REF];
    eq(recorded, line, `${code}: the clip's recorded text is not the line the card shows`);
    // and the manifest points at a real file
    const rel = MANIFEST[code] && MANIFEST[code][REF];
    assert(rel, `${code}: the manifest has no ${REF} clip, so the card would use the device voice`);
    const file = path.join(ROOT, rel.replace(/^\/+/, ""));
    assert(fs.existsSync(file), `${code}: the manifest points at ${rel}, which does not exist`);
    // an mp3 of a spoken sentence, not a stub or an error page
    const bytes = fs.statSync(file).size;
    assert(bytes > 20000, `${code}: ${rel} is only ${bytes} bytes — not a recording of this sentence`);
    const head = fs.readFileSync(file).subarray(0, 3).toString("latin1");
    assert(head === "ID3" || (head.charCodeAt(0) === 0xff), `${code}: ${rel} is not an mp3 (starts ${JSON.stringify(head)})`);
  }

  // The ref is one ref for all nine languages (the clip is chosen by the language
  // bucket, not by the ref) — a per-language ref would mean nine code paths.
  eq((APP.match(/const MOTIV_REF = "([^"]+)";/) || [])[1], REF, "app.js's MOTIV_REF");
  // English is the fallback the card shows when a master has no encourage line.
  eq(cardText("en"), MOTIV_TEXT, "English falls back to app.js's MOTIV_TEXT");
  assert(/encourage/.test(APP), "the card still reads the translated encourage line");

  // ── the card in the browser ───────────────────────────────────────────────
  const site = await serve(ROOT);
  const browser = await launch(findBrowser());
  const page = browser.page;
  try {
    // One appearance serves every browser check: the icon, the press in both
    // languages, the rebuild on a switch, and the stop on advancing.
    await page.goto(site.origin + "/index.html?motiv-audio=desktop#/", 1280, 900);
    await page.evaluate(SEED("HP2"));
    await page.reload();
    await page.evaluate("document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 250)))");
    await page.setHash("#/survey");
    await page.evaluate(`new Promise((r) => setTimeout(r, ${PAST_MEDIAN}))`);

    const en = await page.evaluate(CARD);
    assert(en.present, "the motivation card did not appear on HP2 after the question's median");
    eq(en.lang, "en", "the boot language");
    assert(en.hasIcon, "the card has no speaker, so its line cannot be listened to");
    assert(en.lastChild, "the speaker is not the last thing in the card's paragraph");
    assert(en.afterLastWord, "the speaker does not sit right after the paragraph's final word on the same line");
    assert(en.speaks, "the speaker is not an activatable control");
    eq(en.aria, "Listen", "the speaker's label in English");
    eq(en.text, cardText("en"), "the card's text in English");
    assert(en.width === 14 && en.height === 14, `the icon is ${en.width}x${en.height}, expected the compact 14x14`);
    assert(en.tapHitsIcon, "a tap on the speaker's centre does not reach it — the card passes taps through");
    assert(en.insideCard, "the speaker sits outside the card's border");
    assert(en.insideText, "the speaker hangs below the paragraph's last line");

    await page.evaluate(SPY_AUDIO); // from here on, every clip the page plays is on record
    const pressedEn = await page.evaluate(PRESS());    assert(!pressedEn.error, pressedEn.error || "");
    eq(pressedEn.requested.length, 1, `pressing in English requested ${JSON.stringify(pressedEn.requested)}`);
    assert(/\/audio\/en\//.test(pressedEn.requested[0]), `pressing in English requested ${pressedEn.requested[0]}, not the English clip`);
    eq(pressedEn.requested[0].split("/").pop(), path.basename(MANIFEST.en[REF]), "the English clip requested");
    assert(pressedEn.speaking, "the icon does not show that it is reading");
    eq(pressedEn.anySpeaking, 1, "exactly one speaker is reading");

    // A switch while the card is open rebuilds it: text, label and clip.
    eq(await page.evaluate(PICK("es")), "", "choosing Spanish");
    await page.evaluate("new Promise((r) => setTimeout(r, 400))");
    const es = await page.evaluate(CARD);
    assert(es.present, "the card vanished on a language switch");
    eq(es.lang, "es", "the page language after switching");
    eq(es.text, cardText("es"), "the card's text in Spanish — the card did not follow the switch");
    assert(es.text !== cardText("en"), "the Spanish card still reads the English line");
    eq(es.aria, "Escuchar", "the speaker's label in Spanish");
    assert(es.lastChild && es.tapHitsIcon, "the rebuilt speaker is not the paragraph's last child, or cannot be tapped");
    assert(es.afterLastWord, "the rebuilt speaker does not sit right after the paragraph's final word");
    const pressedEs = await page.evaluate(PRESS());
    assert(!pressedEs.error, pressedEs.error || "");
    eq(pressedEs.requested.length, 1, `pressing in Spanish requested ${JSON.stringify(pressedEs.requested)}`);
    assert(
      /\/audio\/es\//.test(pressedEs.requested[0]),
      `pressing in Spanish requested ${pressedEs.requested[0]} — a stale card keeps the English clip ref`
    );
    eq(pressedEs.requested[0].split("/").pop(), path.basename(MANIFEST.es[REF]), "the Spanish clip requested");
    assert(pressedEs.speaking, "the Spanish icon does not show that it is reading");

    // Advancing: the card goes, and the voice it started stops with it.
    const playing = await page.evaluate(AUDIO_STATE);
    assert(playing.count >= 2, `expected the English and Spanish clips on record, got ${playing.count}`);
    eq(playing.paused, false, "the Spanish clip should still be playing when the respondent advances");
    await page.evaluate(`(() => { const o = document.querySelector("#survey-root .opt"); if (o) o.click(); return 1; })()`);
    await page.evaluate("new Promise((r) => setTimeout(r, 250))");
    await page.evaluate(`(() => { const n = document.querySelector("#btn-next"); if (n) n.click(); return 1; })()`);
    await page.evaluate("new Promise((r) => setTimeout(r, 800))");
    const gone = await page.evaluate(`(() => ({
      card: !!document.getElementById("motiv-card"),
      speaking: document.querySelectorAll(".speak-btn.speaking").length,
      question: (document.querySelector("#survey-root h2") || {}).textContent || "",
    }))()`);
    eq(gone.card, false, "the card is still up after advancing");
    eq(gone.speaking, 0, "a clip started from the card is still marked as playing after the card was removed");
    assert(gone.question.length > 0, "advancing did not reach the next question");
    // The card, and with it the only control for that clip, is gone. The clip must
    // not carry on reading over the next question with nothing left to stop it.
    const after = await page.evaluate(AUDIO_STATE);
    eq(after.count, playing.count, "advancing started an unexpected clip");
    eq(after.paused, true, `the clip from the card is still playing (${after.src}) after the card was removed`);

    // Phone width: the card is narrower and lower, so the icon must still fit,
    // still be last in the paragraph and still take a tap.
    await page.goto(site.origin + "/index.html?motiv-audio=phone#/", 390, 844);
    await page.evaluate(SEED("HP1")); // HP1 must show no card, which makes the HP2 run meaningful
    await page.reload();
    await page.evaluate("document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 250)))");
    await page.setHash("#/survey");
    await page.evaluate(`new Promise((r) => setTimeout(r, ${PAST_MEDIAN}))`);
    const hp1 = await page.evaluate(CARD);
    eq(hp1.present, false, "the HP1 arm showed the motivation card");

    await page.evaluate(SEED("HP2"));
    await page.reload();
    await page.evaluate("document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 250)))");
    await page.setHash("#/survey");
    await page.evaluate(`new Promise((r) => setTimeout(r, ${PAST_MEDIAN}))`);
    const phone = await page.evaluate(CARD);
    assert(phone.present, "the motivation card did not appear on a 390px-wide screen");
    assert(phone.lastChild, "on a phone the speaker is not the paragraph's last child");
    assert(phone.afterLastWord, "on a phone the speaker does not sit right after the paragraph's final word");
    assert(phone.tapHitsIcon, "on a phone a tap on the speaker does not reach it");
    assert(phone.insideCard && phone.insideText, "on a phone the speaker sits outside the card or below the last line");

    // Leaving the survey (not advancing through it): route() finalises the card on
    // the way out. Advancing would also stop the clip, because renderSurvey() calls
    // stopSpeak() for the question it is about to replace — so the leaving path is
    // the one that proves the card stops its own clip rather than inheriting that.
    await page.evaluate(SPY_AUDIO);
    const phonePress = await page.evaluate(PRESS());
    assert(!phonePress.error, phonePress.error || "");
    assert(phonePress.requested.length === 1, `on a phone, pressing requested ${JSON.stringify(phonePress.requested)}`);
    const leftPlaying = await page.evaluate(AUDIO_STATE);
    eq(leftPlaying.count, 1, "one clip requested on the phone");
    eq(leftPlaying.paused, false, "the clip should still be playing before leaving the survey");
    await page.setHash("#/");
    await page.evaluate("new Promise((r) => setTimeout(r, 700))");
    const home = await page.evaluate(`(() => ({
      card: !!document.getElementById("motiv-card"),
      screen: (document.querySelector(".view.active") || {}).id,
      question: (document.querySelector("#survey-root h2") || {}).textContent || "",
    }))()`);
    eq(home.screen, "view-home", "leaving the survey did not reach the homepage");
    eq(home.card, false, "the card followed the respondent out of the survey");
    const left = await page.evaluate(AUDIO_STATE);
    eq(
      left.paused,
      true,
      `the clip from the card is still playing (${left.src}) after the respondent left the survey — no control is left on screen to stop it`
    );
  } finally {
    await browser.close();
    await site.close();
  }

  console.log(`${checks} checks passed: the motivation card's speaker reads its line in the language on screen.`);
}

main().catch((err) => {
  console.error("\n" + (err && err.stack ? err.stack : err) + "\n");
  process.exitCode = 1;
});
