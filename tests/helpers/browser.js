"use strict";
// A tiny headless-browser driver for the layout tests. It serves the project
// over http, starts the Chrome/Edge already installed on the machine in
// headless mode, and drives it over the DevTools protocol using Node's own
// WebSocket — so the suite keeps its "no npm dependencies" property.
//
// The layout tests need a real engine because they measure where things end up
// on screen (getBoundingClientRect) while a region scrolls; the fake DOM used
// by the other tests has no layout at all.

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const CANDIDATES = [
  process.env.CHROME_BIN,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];

/** The browser executable on this machine, or null when there is none. */
function findBrowser() {
  for (const exe of CANDIDATES) {
    if (!exe) continue;
    try { if (fs.existsSync(exe)) return exe; } catch (e) { /* unreadable path */ }
  }
  return null;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

/** Serve `rootDir` on a free port of the loopback interface. */
function serve(rootDir) {
  const root = path.resolve(rootDir);
  const server = http.createServer((req, res) => {
    let rel;
    try { rel = decodeURIComponent((req.url || "/").split("?")[0].split("#")[0]); }
    catch (e) { res.writeHead(400).end(); return; }
    const file = path.resolve(root, "." + (rel === "/" ? "/index.html" : rel));
    if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404, { "content-type": "text/plain" }).end("not found"); return; }
      res.writeHead(200, {
        "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
        "cache-control": "no-store",
      }).end(buf);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        origin: "http://127.0.0.1:" + server.address().port,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

/** One DevTools page: navigate, resize, evaluate. */
class Page {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.loadWaiters = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.method + ": " + msg.error.message));
        else resolve(msg.result);
        return;
      }
      if (msg.method === "Page.loadEventFired") {
        const waiters = this.loadWaiters;
        this.loadWaiters = [];
        for (const w of waiters) w();
      }
    });
  }

  send(method, params) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }

  loadFired() { return new Promise((resolve) => this.loadWaiters.push(resolve)); }

  /** Run an expression in the page and return its value. */
  async evaluate(expression) {
    const r = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error((d.exception && (d.exception.description || d.exception.value)) || d.text || "page error");
    }
    return r.result.value;
  }

  /** Set the viewport, then navigate and wait for the load event. */
  async goto(url, width, height) {
    await this.send("Emulation.setDeviceMetricsOverride", {
      width, height, deviceScaleFactor: 1, mobile: width < 600,
    });
    const loaded = this.loadFired();
    await this.send("Page.navigate", { url });
    await loaded;
    // let the first render pass and any fonts settle
    await this.evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))");
  }

  /**
   * Change only the hash and let the app's router render. A hash change makes
   * no new document, so there is no load event to wait for.
   */
  async setHash(hash) {
    await this.evaluate("location.hash = " + JSON.stringify(hash));
    await this.evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))");
  }

  /** Reload the current URL and wait for the app to start again. */
  async reload() {
    const loaded = this.loadFired();
    await this.send("Page.reload", { ignoreCache: true });
    await loaded;
    await this.evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))");
  }

  close() { try { this.ws.close(); } catch (e) { /* already gone */ } }
}

/**
 * Start the browser and return { page, close }. `onStderr` receives anything
 * the browser prints that is not the debugger banner, which is where a startup
 * failure shows up.
 */
async function launch(exe) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "sss-browser-"));
  const proc = spawn(exe, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--mute-audio",
    "--hide-scrollbars",
    "--user-data-dir=" + profile,
    "--remote-debugging-port=0",
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });

  const banner = await new Promise((resolve, reject) => {
    let seen = "";
    const timer = setTimeout(() => { try { proc.kill(); } catch (e) { /* gone */ } reject(new Error("the browser opened no debugging port within 30s")); }, 30000);
    proc.stderr.on("data", (chunk) => {
      seen += chunk.toString();
      const m = seen.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    proc.on("error", (err) => { clearTimeout(timer); reject(err); });
    proc.on("exit", (code) => { clearTimeout(timer); reject(new Error("the browser exited with code " + code + ": " + seen.slice(-300))); });
  });

  const port = new URL(banner).port;
  const targets = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json();
  const target = targets.find((t) => t.type === "page");
  if (!target) throw new Error("the browser opened no page to drive");

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("could not attach to the browser page")), { once: true });
  });
  const page = new Page(ws);
  await page.send("Page.enable");
  await page.send("Runtime.enable");

  const close = async () => {
    page.close();
    try { proc.kill(); } catch (e) { /* already gone */ }
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* locked on Windows; harmless */ }
  };
  return { page, close };
}

module.exports = { findBrowser, serve, launch };
