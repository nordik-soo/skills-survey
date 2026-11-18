// The language pill in the header carries an icon: a speech bubble holding the
// translate mark (A next to 文) — the translated-speech idea from Google Meet.
//
// The pill is the site's language control, but it only said so in words, and
// before a language is chosen it reads "Select language" in whatever language
// the page is currently in. The mark says "language" at a glance, in every one
// of the nine languages.
//
// It cannot be an element in index.html: app.js's syncLangButton() rewrites the
// pill's textContent on every language change, which deletes any child element.
// So the mark is a CSS ::before — not DOM, so it survives the switch.
//
// The strokes are vector paths inside the mask, never characters: a text-based
// mark would need a CJK font on the respondent's machine and would draw tofu
// where there is none. It began life as a globe; the globe was replaced by this
// mark, and the checks below name the bubble so a revert has to be deliberate.
//
// Guarded here:
//   • the mark is one masked SVG line drawing — a bubble, a tail, and two glyph
//     groups inside — in the pill's own colour, and decorative (no text);
//   • it is still there after a language is chosen through the real menu, and
//     after switching twice and back to English;
//   • it sits on the leading edge — left in LTR, right in Arabic — measured
//     from the text's own box, not assumed;
//   • it adds exactly the icon and its gap to the pill's width, does not grow
//     the pill's height or wrap, and does not overflow the header at 360px.
const fs = require("fs");
const path = require("path");

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

const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const CSS = read("app.css");
const HTML = read("index.html");

const iconRule = () => {
  const at = CSS.indexOf(".lang-btn::before");
  assert(at !== -1, "app.css has no .lang-btn::before rule, so the pill has no icon");
  return CSS.slice(at, CSS.indexOf("}", at));
};

function checkMarkup() {
  const body = iconRule();
  assert(/content:\s*""/.test(body), "the icon pseudo-element has text content instead of being decorative");

  // One mask, one drawing: the bubble, and the two glyph groups inside it.
  assert(/mask:\s*var\(--translate-msg\)/.test(body), "the icon is not drawn from the masked SVG");
  const uri = (body.match(/--translate-msg:\s*url\("([^"]+)"\)/) || [])[1];
  assert(uri, "the icon's SVG data URI is missing");
  assert(uri.indexOf("data:image/svg+xml,") === 0, "the icon is not an inline SVG");

  const paths = (uri.match(/%3Cpath/g) || []).length;
  eq(paths, 3, "the icon should be the bubble plus two glyph groups");
  assert(uri.indexOf("L6.5 21") !== -1, "the bubble's tail is missing, so it is not a speech bubble");
  assert(uri.indexOf("A2.5 2.5") !== -1, "the bubble has no rounded corners");
  assert(uri.indexOf("stroke-width") !== -1, "the icon's strokes have no weight");
  assert(uri.indexOf("circle") === -1, "the icon is still the old globe (a circle)");
  // The mark must be drawn, never typed: a character here needs a CJK font.
  assert(uri.indexOf("%E6%96%87") === -1 && uri.indexOf("文") === -1 && uri.indexOf("A%3C") === -1,
    "the mark is a character, so a machine without a CJK font would draw a box");

  assert(/currentColor/.test(body), "the icon does not take the pill's colour");
  assert(/width:\s*16px/.test(body) && /height:\s*16px/.test(body), "the icon is not 16px square");
  assert(/flex:\s*0 0 auto/.test(body), "the icon can be squeezed by a long language name");

  // The button must lay the icon out inline and keep one line.
  const btn = CSS.slice(CSS.indexOf(".lang-btn {"));
  const btnBody = btn.slice(0, btn.indexOf("}"));
  assert(/display:\s*inline-flex/.test(btnBody), "the pill is not an inline flex row, so the icon and label do not align");
  assert(/align-items:\s*center/.test(btnBody), "the icon is not vertically centred with the label");
  assert(/gap:\s*6px/.test(btnBody), "there is no gap between the icon and the label");
  assert(/white-space:\s*nowrap/.test(btnBody), "the pill may wrap onto two lines");

  // Nothing was added to the markup: the pill's content must be exactly its
  // label, so any element put inside it would change the content and fail here.
  const pill = (HTML.match(/<button[^>]*id="lang-btn"[^>]*>([\s\S]*?)<\/button>/) || [])[1] || "";
  assert(pill, "index.html has no #lang-btn to check");
  assert(
    /^\s*Select language\s*$/.test(pill),
    "the pill's content is not just its label; an icon element in index.html would be wiped by app.js on a language change: " +
      JSON.stringify(pill.trim().slice(0, 60))
  );
}

// What the real page reports about the pill.
const READ_PILL = `(() => {
  const btn = document.querySelector("#lang-btn");
  if (!btn) return { error: "no language button" };
  const cs = getComputedStyle(btn);
  const pre = getComputedStyle(btn, "::before");
  const r = btn.getBoundingClientRect();
  // the text's own box, so the icon's side can be measured rather than assumed
  const range = document.createRange();
  range.selectNodeContents(btn);
  const tr = range.getBoundingClientRect();
  const mask = pre.maskImage || pre.webkitMaskImage || "";
  return {
    text: (btn.textContent || "").trim(),
    aria: btn.getAttribute("aria-label"),
    dir: cs.direction,
    w: Math.round(r.width),
    h: Math.round(r.height),
    preContent: pre.content,
    preWidth: pre.width,
    preHeight: pre.height,
    preColor: pre.backgroundColor,
    preMask: mask,
    hasMaskUrl: mask.indexOf("url(") === 0,
    textLeft: Math.round(tr.left - r.left),
    textRight: Math.round(r.right - tr.right),
    display: cs.display,
    gap: cs.columnGap,
  };
})()`;

/** The mark must be rendered, 16px, masked, and in the pill's own ink. */
function checkIcon(s, lang) {
  assert(!s.error, s.error);
  eq(s.preContent, '""', `${lang}: the icon pseudo-element is not rendered`);
  eq(s.preWidth, "16px", `${lang}: the icon is not 16px wide`);
  eq(s.preHeight, "16px", `${lang}: the icon is not 16px tall`);
  assert(s.hasMaskUrl, `${lang}: the icon is not drawn from the SVG mask (mask-image=${JSON.stringify(s.preMask)})`);
  assert(typeof s.preMask === "string" && s.preMask.indexOf("svg") !== -1, `${lang}: the mask is not an SVG`);
  // currentColor resolves to the label's colour, so the two never drift apart.
  assert(/^rgb\(\s*36,\s*122,\s*90\s*\)$/.test(s.preColor), `${lang}: the icon is ${s.preColor}, not the pill's ink #247A5A`);
  eq(s.display, "inline-flex", `${lang}: the pill is not laid out as a flex row`);
  eq(s.gap, "6px", `${lang}: the icon and the label are not 6px apart`);
}

/** The icon sits before the label in LTR and after it in RTL. */
function checkSide(s, lang, rtl) {
  // 16px icon + 6px gap = 22px of leading gutter; the pill's padding+border is 15.
  const leading = rtl ? s.textRight : s.textLeft;
  const trailing = rtl ? s.textLeft : s.textRight;
  assert(leading >= 35, `${lang}: the icon is not on the ${rtl ? "right" : "left"} of the label (leading space ${leading}px)`);
  assert(trailing <= 17, `${lang}: something also sits after the label (trailing space ${trailing}px)`);
}

async function run() {
  const check = (name, fn) => {
    checks += 1;
    try {
      fn();
      console.log("  ok  " + name);
    } catch (err) {
      failures += 1;
      console.log("  x   " + name + ": " + err.message);
    }
  };

  check("the icon is a decorative masked bubble in the CSS, not an element in the markup", checkMarkup);

  const exe = findBrowser();
  if (!exe) {
    console.log("  skip  no Chrome or Edge found to drive the page with (set CHROME_BIN to point at one)");
    if (failures) {
      console.error(`\n${failures} of ${checks} checks FAILED.\n`);
      process.exit(1);
    }
    console.log(`${checks} data checks passed; the pill itself was not exercised (no browser).`);
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

    let seq = 0;
    const open = async () => {
      seq += 1;
      await page.goto(`${site.origin}/index.html?visit=icon${seq}#/`, 1280, 900);
      await page.evaluate("localStorage.clear();");
      await page.reload();
      await page.evaluate("new Promise((r) => setTimeout(r, 350))");
    };

    const pick = async (code) => {
      await page.evaluate("(() => { const b = document.querySelector('#lang-btn'); if (b) b.click(); })()");
      const res = await page.evaluate(`(() => {
        const item = Array.prototype.slice.call(document.querySelectorAll(".lang-menu .lang-item"))
          .filter((n) => n.getAttribute("lang") === ${JSON.stringify(code)})[0];
        if (!item) return "no " + ${JSON.stringify(code)} + " in the language list";
        item.click();
        return "";
      })()`);
      eq(res, "", "choosing " + code);
      await page.evaluate("new Promise((r) => setTimeout(r, 250))");
    };

    await runAsync("the pill shows the mark before any language is chosen", async () => {
      await open();
      const s = await page.evaluate(READ_PILL);
      checkIcon(s, "en");
      checkSide(s, "en", false);
      eq(s.text, "Select language", "the pill's label");
    });

    await runAsync("the mark survives choosing a language, and the label is still only that language", async () => {
      const before = await page.evaluate(READ_PILL);
      await pick("es");
      const after = await page.evaluate(READ_PILL);
      checkIcon(after, "es");
      checkSide(after, "es", false);
      // This is what a markup icon cannot do: app.js rewrites textContent.
      eq(after.text, "Español", "the pill's label after choosing");
      assert(after.text.indexOf("Select language") === -1, "the pill kept the 'Select language' prefix");
      assert(after.w > 0 && after.w < before.w, `the chosen pill is ${after.w}px, wider than the invitation (${before.w}px)`);
    });

    await runAsync("the mark is still there after switching again and back to English", async () => {
      await pick("hi");
      const hi = await page.evaluate(READ_PILL);
      checkIcon(hi, "hi");
      checkSide(hi, "hi", false);
      await pick("en");
      const en = await page.evaluate(READ_PILL);
      checkIcon(en, "en");
      checkSide(en, "en", false);
      eq(en.text, "English", "the pill did not come back to English");
    });

    await runAsync("in Arabic the mark sits on the right of the label", async () => {
      await pick("ar");
      const s = await page.evaluate(READ_PILL);
      checkIcon(s, "ar");
      eq(s.dir, "rtl", "the pill did not flip with the page");
      checkSide(s, "ar", true);
      eq(s.text, "العربية", "the pill's label");
    });

    await runAsync("every language keeps the mark, and none wraps to two lines", async () => {
      const codes = ["en", "es", "fr", "hi", "it", "pt", "ar", "zh", "tl"];
      for (const code of codes) {
        await pick(code);
        const s = await page.evaluate(READ_PILL);
        checkIcon(s, code);
        checkSide(s, code, code === "ar");
        eq(s.h, 34, `${code}: the pill is ${s.h}px tall, so it wrapped or grew`);
        assert(s.text.length > 0, `${code}: the pill lost its label`);
      }
    });

    await runAsync("the mark adds exactly the icon and its gap, nothing else", async () => {
      await open();
      await pick("en");
      const withIcon = await page.evaluate(READ_PILL);
      // Remove only the pseudo-element; the label, padding and border stay.
      await page.evaluate(`(() => {
        const s = document.createElement("style");
        s.textContent = ".lang-btn::before { content: none !important; }";
        document.head.appendChild(s);
      })()`);
      await page.evaluate("new Promise((r) => setTimeout(r, 120))");
      const without = await page.evaluate(READ_PILL);
      eq(without.preContent, "none", "the pseudo-element could not be disabled to measure");
      const grew = withIcon.w - without.w;
      eq(grew, 22, `the icon changed the pill's width by ${grew}px, expected 16px icon + 6px gap`);
      eq(withIcon.h, without.h, "the icon changed the pill's height");
    });

    await runAsync("the pill stays inside the header on a narrow phone", async () => {
      await open();
      const narrow = await page.evaluate(`(() => {
        const btn = document.querySelector("#lang-btn");
        const header = btn.closest("header") || document.querySelector("header");
        return { pill: Math.round(btn.getBoundingClientRect().width), overflow: header.scrollWidth > header.clientWidth };
      })()`);
      await page.evaluate("(() => { document.documentElement.style.width = '360px'; })()");
      await page.evaluate("new Promise((r) => setTimeout(r, 150))");
      const phone = await page.evaluate(`(() => {
        const btn = document.querySelector("#lang-btn");
        const header = btn.closest("header") || document.querySelector("header");
        return { pill: Math.round(btn.getBoundingClientRect().width), overflow: header.scrollWidth > header.clientWidth };
      })()`);
      assert(phone.pill > 0, "the pill vanished on a narrow phone");
      assert(!phone.overflow, `the header overflows at 360px by ${phone.pill - narrow.pill}px`);
    });
  } finally {
    if (browser) await browser.close();
    await site.close();
  }

  if (failures) {
    console.error(`\n${failures} of ${checks} checks FAILED.\n`);
    process.exit(1);
  }
  console.log(`${checks} checks passed: the language pill carries the translate mark and it survives every switch.`);
}

run().catch((err) => {
  console.error("FAILED:", err && err.message ? err.message : err);
  process.exit(1);
});
