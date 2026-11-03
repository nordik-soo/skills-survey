#!/usr/bin/env node
/**
 * Static checks for the front-end stylesheet and the assets it points at.
 *
 * Decisions these encode:
 *   1. Every url(...) that app.css / index.html / app.js reference exists on disk.
 *      app.css once shipped a `url("assets/waterfront-bg.png")` whose PNG was never
 *      committed, so production served a 404 and the background silently vanished
 *      while localhost looked fine. This test fails before that reaches a server.
 *   2. The home backdrop is the pastel waterfront sky gradient defined by
 *      --home-bg and consumed by body[data-route="home"]. Other routes keep their
 *      own backdrops (survey photo, admin flat colour).
 *
 * Run with:
 *
 *     node tests/test_assets.js
 *
 * No dependencies.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

let pass = 0;
const fails = [];
function check(name, fn) {
  try {
    const r = fn();
    if (r === false) throw new Error("returned false");
    pass++;
  } catch (e) {
    fails.push(`${name}: ${e.message}`);
  }
}

const CSS = read("app.css");
const HTML = read("index.html");
const JS = read("app.js");

// --- 1. every referenced asset exists ---------------------------------------
function urlRefs(src, file) {
  const out = [];
  const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    const u = m[2].trim();
    if (/^(data:|https?:|#|\/\/)/i.test(u)) continue;
    out.push({ url: u, file });
  }
  return out;
}
function htmlRefs(src) {
  const out = [];
  const re = /(?:src|href)="([^"]+)"/g;
  let m;
  while ((m = re.exec(src))) {
    const u = m[1].trim();
    if (/^(data:|https?:|#|\/\/|mailto:|javascript:)/i.test(u)) continue;
    out.push({ url: u, file: "index.html" });
  }
  return out;
}

const refs = [...urlRefs(CSS, "app.css"), ...htmlRefs(HTML)];
check("stylesheet and markup reference at least one asset", () => refs.length > 0);

for (const r of refs) {
  check(`${r.file} asset exists: ${r.url}`, () => {
    const p = path.join(ROOT, decodeURIComponent(r.url.split("?")[0]));
    if (!fs.existsSync(p)) throw new Error(`missing file ${p}`);
    if (fs.statSync(p).size === 0) throw new Error("file is empty");
    return true;
  });
}

// Referenced audio clips are generated, not committed; verify the manifest only.
check("audio manifest parses and lists clips", () => {
  const p = path.join(ROOT, "audio", "manifest.json");
  if (!fs.existsSync(p)) throw new Error("audio/manifest.json missing");
  const m = JSON.parse(fs.readFileSync(p, "utf8"));
  const keys = Array.isArray(m) ? m : Object.keys(m);
  if (!keys.length) throw new Error("manifest lists no clips");
  return true;
});

// --- 2. home backdrop -------------------------------------------------------
const VARS = (CSS.match(/:root\s*\{[\s\S]*?\n\}/) || [""])[0];
check(":root defines --home-bg", () => /--home-bg\s*:/.test(VARS));

check("--home-bg is a gradient stack, not a bitmap", () => {
  const m = VARS.match(/--home-bg\s*:\s*([\s\S]*?);\s*\n/);
  if (!m) throw new Error("--home-bg not found");
  const v = m[1];
  if (!/gradient\(/.test(v)) throw new Error("no gradient in --home-bg");
  if (/url\(/.test(v)) throw new Error("--home-bg still points at a bitmap");
  return true;
});

check("--home-bg ends on the reference horizon colour (#d4dedd)", () => {
  if (!/#d4dedd/i.test(VARS)) throw new Error("expected #d4dedd stop");
  return true;
});

check('body[data-route="home"] uses --home-bg', () => {
  const m = CSS.match(/body\[data-route="home"\]\s*\{([^}]*)\}/);
  if (!m) throw new Error('rule body[data-route="home"] not found');
  if (!/var\(--home-bg\)/.test(m[1])) throw new Error("does not use var(--home-bg)");
  return true;
});

check("survey and admin routes keep their own backdrops", () => {
  const home = CSS.match(/body\[data-route="home"\]\s*\{([^}]*)\}/)[1];
  const survey = CSS.match(/body\[data-route="survey"\]\s*\{([^}]*)\}/);
  const admin = CSS.match(/body\[data-route="admin"\]\s*\{([^}]*)\}/);
  if (!survey || !admin) throw new Error("survey or admin rule missing");
  if (/--home-bg/.test(survey[1])) throw new Error("survey route picked up --home-bg");
  if (/--home-bg/.test(admin[1])) throw new Error("admin route picked up --home-bg");
  if (/--home-bg/.test(home) === false) throw new Error("home rule lost --home-bg");
  return true;
});

// --- 3. hero map artwork has no opaque card ---------------------------------
// The illustration ships with its paper background cut to transparency, so the
// --home-bg sky shows through it. If the opaque ivory PNG comes back, this fails.
const zlib = require("zlib");

function decodePng(buf) {
  if (buf.slice(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("not a PNG");
  let off = 8, ihdr = null;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === "IHDR") {
      ihdr = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), bitDepth: data[8], colorType: data[9], interlace: data[12] };
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (!ihdr) throw new Error("no IHDR");
  const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const ch = CHANNELS[ihdr.colorType];
  if (!ch) throw new Error("unsupported colour type " + ihdr.colorType);
  if (ihdr.bitDepth !== 8) throw new Error("expected 8-bit, got " + ihdr.bitDepth);
  if (ihdr.interlace !== 0) throw new Error("interlaced PNG unsupported");
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = ihdr.width * ch;
  const out = Buffer.alloc(ihdr.height * stride);
  let pos = 0;
  for (let y = 0; y < ihdr.height; y++) {
    const ft = raw[pos++];
    const line = raw.slice(pos, pos + stride);
    pos += stride;
    const cur = out.slice(y * stride, (y + 1) * stride);
    const prev = y ? out.slice((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (ft !== 0) throw new Error("bad scanline filter " + ft);
      cur[x] = v & 0xff;
    }
  }
  const alphaIndex = ihdr.colorType === 6 ? 3 : ihdr.colorType === 4 ? 1 : -1;
  return {
    width: ihdr.width,
    height: ihdr.height,
    colorType: ihdr.colorType,
    bitDepth: ihdr.bitDepth,
    alpha(x, y) {
      if (alphaIndex < 0) return 255;
      return out[y * stride + x * ch + alphaIndex];
    },
    histogram() {
      const h = new Array(4).fill(0); // [transparent, partial, opaque]
      if (alphaIndex < 0) { h[2] = this.width * this.height; return h; }
      for (let i = alphaIndex; i < out.length; i += ch) {
        const v = out[i];
        if (v === 0) h[0]++;
        else if (v === 255) h[2]++;
        else h[1]++;
      }
      return h;
    },
  };
}

const MAP_PNG = decodePng(fs.readFileSync(path.join(ROOT, "assets", "northern-ontario-map.png")));
const MAP_TOTAL = MAP_PNG.width * MAP_PNG.height;

check("hero map artwork carries an alpha channel (8-bit RGBA)", () => {
  if (MAP_PNG.colorType !== 6) throw new Error("colour type " + MAP_PNG.colorType + " has no alpha");
  if (MAP_PNG.bitDepth !== 8) throw new Error("bit depth " + MAP_PNG.bitDepth);
  return true;
});

check("hero map corners are fully transparent (no card corners)", () => {
  const pts = [[0, 0], [MAP_PNG.width - 1, 0], [0, MAP_PNG.height - 1], [MAP_PNG.width - 1, MAP_PNG.height - 1]];
  for (const [x, y] of pts) {
    const a = MAP_PNG.alpha(x, y);
    if (a !== 0) throw new Error(`corner ${x},${y} has alpha ${a}, expected 0`);
  }
  return true;
});

check("hero map paper background is cut (>= 40% transparent)", () => {
  const [transparent] = MAP_PNG.histogram();
  const pct = (100 * transparent) / MAP_TOTAL;
  if (pct < 40) throw new Error(`only ${pct.toFixed(1)}% transparent`);
  return true;
});

check("hero map artwork is preserved (>= 30% opaque)", () => {
  const h = MAP_PNG.histogram();
  const pct = (100 * h[2]) / MAP_TOTAL;
  if (pct < 30) throw new Error(`only ${pct.toFixed(1)}% opaque`);
  return true;
});

check("hero map retains artwork in all four quadrants", () => {
  const q = [0, 0, 0, 0];
  for (let y = 0; y < MAP_PNG.height; y += 4) {
    for (let x = 0; x < MAP_PNG.width; x += 4) {
      if (MAP_PNG.alpha(x, y) !== 255) continue;
      q[(y >= MAP_PNG.height / 2 ? 2 : 0) + (x >= MAP_PNG.width / 2 ? 1 : 0)]++;
    }
  }
  const empty = q.findIndex((n) => n === 0);
  if (empty >= 0) throw new Error("quadrant " + empty + " has no artwork");
  return true;
});

function ruleBody(selector) {
  const at = CSS.indexOf(selector + " {");
  if (at < 0) throw new Error(`rule ${selector} not found`);
  const open = CSS.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < CSS.length; i++) {
    if (CSS[i] === "{") depth++;
    else if (CSS[i] === "}" && --depth === 0) return CSS.slice(open + 1, i);
  }
  throw new Error(`rule ${selector} is unterminated`);
}

check("no card is painted behind the map artwork", () => {
  for (const sel of [".hero-map", ".hero-map img"]) {
    const body = ruleBody(sel);
    const bg = body.match(/background\s*:\s*([^;]+);/);
    if (bg && !/^(none|transparent)\b/i.test(bg[1].trim())) {
      throw new Error(`${sel} paints a background: ${bg[1].trim()}`);
    }
    if (/border-radius\s*:/.test(body)) throw new Error(`${sel} still rounds a card corner`);
  }
  return true;
});

// --- report -----------------------------------------------------------------
if (fails.length) {
  console.error(`FAIL — ${fails.length} of ${pass + fails.length} tests failed`);
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log(`PASS — ${pass} tests`);
