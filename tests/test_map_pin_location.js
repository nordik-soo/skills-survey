#!/usr/bin/env node
/**
 * Checks where the hero map's "Sault Ste. Marie" marker points.
 *
 * Decisions these encode:
 *   1. The city sits on the isthmus between Lake Superior and Lake Huron, so on a
 *      map of Ontario its marker belongs on the land between the two lakes, not
 *      out in the eastern body of water. The marker is painted into
 *      assets/northern-ontario-map.png, so a wrong position cannot be caught by
 *      reading markup - it has to be measured on the artwork.
 *   2. There is exactly one marker. Moving the pin means removing the old one,
 *      otherwise a second pin stays behind and the map claims two cities.
 *   3. The callout pill in app.css is positioned in percentages of the artwork,
 *      so it has to stay beside whichever marker the artwork carries. If the pin
 *      moves and the label does not, the label names empty land.
 *
 * Run with:
 *
 *     node tests/test_map_pin_location.js
 *
 * No dependencies.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const CSS = fs.readFileSync(path.join(ROOT, "app.css"), "utf8");

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

// --- minimal 8-bit RGBA PNG reader (same shape as the one in test_assets.js) ---
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
  if (ihdr.colorType !== 6 || ihdr.bitDepth !== 8 || ihdr.interlace !== 0) {
    throw new Error(`unsupported PNG (colour type ${ihdr.colorType}, depth ${ihdr.bitDepth})`);
  }
  const ch = 4;
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
  return {
    width: ihdr.width,
    height: ihdr.height,
    at(x, y) {
      const i = y * stride + x * ch;
      return [out[i], out[i + 1], out[i + 2], out[i + 3]];
    },
  };
}

const map = decodePng(fs.readFileSync(path.join(ROOT, "assets", "northern-ontario-map.png")));
const W = map.width;
const H = map.height;

// The marker is the only saturated orange in the artwork; the lakes are sage and
// the land is green, so these thresholds cannot pick up anything else.
const isPin = (r, g, b, a) => a > 200 && r > 200 && g > 140 && b < 190 && r - b > 55;
const isLake = (r, g, b, a) => a > 200 && Math.abs(r - 229) < 7 && Math.abs(g - 232) < 6 && Math.abs(b - 219) < 7;
const isLand = (r, g, b, a) => a > 200 && g > r && g - b > 5 && r < 195;

const pin = { xs: [], ys: [], n: 0 };
const lakeCols = new Array(W).fill(0);
const landCols = new Array(W).fill(0);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const [r, g, b, a] = map.at(x, y);
    if (isPin(r, g, b, a)) { pin.xs.push(x); pin.ys.push(y); pin.n++; }
    if (isLake(r, g, b, a)) lakeCols[x]++;
    if (isLand(r, g, b, a)) landCols[x]++;
  }
}
const pinLeft = Math.min(...pin.xs), pinRight = Math.max(...pin.xs);
const pinTop = Math.min(...pin.ys), pinBottom = Math.max(...pin.ys);
const pinCx = (pinLeft + pinRight) / 2;

// Column runs of lake pixels: the two lakes are the two widest runs of columns
// carrying lake colour, separated by the land the city stands on.
const lakeRuns = [];
let runStart = -1;
for (let x = 0; x < W; x++) {
  if (lakeCols[x] > 0) { if (runStart < 0) runStart = x; }
  else if (runStart >= 0) { lakeRuns.push([runStart, x - 1]); runStart = -1; }
}
if (runStart >= 0) lakeRuns.push([runStart, W - 1]);
lakeRuns.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
const lakes = lakeRuns.slice(0, 2).sort((a, b) => a[0] - b[0]);
const superiorEnd = lakes[0][1];   // lake on the left (Superior)
const huronStart = lakes[1][0];    // lake on the right (Huron + Georgian Bay)

// --- 1. one marker only ------------------------------------------------------
check("hero map carries exactly one Sault Ste. Marie marker", () => {
  if (pin.n < 800) throw new Error(`found only ${pin.n} marker pixels`);
  const w = pinRight - pinLeft, h = pinBottom - pinTop;
  // a second marker left behind at the old spot would widen the bounding box
  if (w > 70 || h > 90) throw new Error(`marker pixels span ${w}x${h}px, so more than one marker is painted`);
  return true;
});

// --- 2. the marker stands on land between the two lakes ----------------------
check("marker stands on the land between Lake Superior and Lake Huron", () => {
  if (!landCols.length) throw new Error("no land found");
  const pad = 35;
  if (pinCx <= superiorEnd + pad) throw new Error(`marker at x=${pinCx} is against Lake Superior (ends x=${superiorEnd})`);
  if (pinCx >= huronStart - pad) throw new Error(`marker at x=${pinCx} is against Lake Huron (starts x=${huronStart})`);
  return true;
});

check("marker sits on Northern Ontario land, not in a lake", () => {
  const [r, g, b, a] = map.at(Math.round(pinCx), Math.round((pinTop + pinBottom) / 2));
  if (isLake(r, g, b, a)) throw new Error("marker head is painted over lake colour");
  // ring around the marker should be land, not open background
  let land = 0, tot = 0;
  for (let x = pinLeft - 12; x <= pinRight + 12; x += 2) {
    for (const y of [pinTop - 12, pinTop - 8, pinBottom + 6, pinBottom + 10]) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const p = map.at(x, y);
      tot++;
      if (isLand(...p)) land++;
    }
  }
  if (tot && land / tot < 0.5) throw new Error(`only ${Math.round((100 * land) / tot)}% of the ground around the marker is land`);
  return true;
});

check("marker tip points at the city position, above the province's south shore", () => {
  // Sault Ste. Marie is in the middle band of the map, never on the southern tip
  const tipY = pinBottom / H;
  const tipX = pinCx / W;
  if (tipX < 0.44 || tipX > 0.60) throw new Error(`tip x is ${(tipX * 100).toFixed(1)}% across, expected 44-60%`);
  if (tipY < 0.58 || tipY > 0.74) throw new Error(`tip y is ${(tipY * 100).toFixed(1)}% down, expected 58-74%`);
  return true;
});

// --- 3. the callout pill stays with the marker -------------------------------
function labelRule() {
  const at = CSS.indexOf(".map-location-label {");
  if (at < 0) throw new Error("rule .map-location-label not found");
  const body = CSS.slice(at, CSS.indexOf("}", at));
  const left = body.match(/left:\s*([\d.]+)%/);
  const top = body.match(/top:\s*([\d.]+)%/);
  if (!left || !top) throw new Error("label lost its percentage position");
  return { left: parseFloat(left[1]), top: parseFloat(top[1]) };
}

check("label pill sits beside the marker, not over empty land", () => {
  const { left, top } = labelRule();
  const labelX = (left / 100) * W;
  const labelY = (top / 100) * H;
  const gap = labelX - pinRight;
  if (gap < 8 || gap > 90) throw new Error(`label starts ${gap.toFixed(0)}px from the marker's right edge`);
  const headCentre = (pinTop + pinBottom) / 2 - (pinBottom - pinTop) * 0.18;
  if (Math.abs(labelY - headCentre) > 70) {
    throw new Error(`label top is ${Math.abs(labelY - headCentre).toFixed(0)}px off the marker head`);
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
