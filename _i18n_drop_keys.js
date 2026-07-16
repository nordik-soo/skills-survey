// Drop specific ui keys from every language map (used when a UI string is removed
// from the app, so the key would otherwise go stale and block the rebuild).
// Usage: node _i18n_drop_keys.js "Some string" "Another string"
const fs = require("fs");
const kill = process.argv.slice(2);
if (!kill.length) { console.error("no keys given"); process.exit(1); }

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
let touched = 0;
for (const f of fs.readdirSync("_maps").filter((f) => f.endsWith(".js"))) {
  const p = "_maps/" + f;
  let t = fs.readFileSync(p, "utf8");
  let hits = 0;
  for (const k of kill) {
    // match:   "<key>": "<value>",\n   (value may contain escaped quotes)
    const re = new RegExp('^[ \\t]*' + esc(JSON.stringify(k)) + ':[ \\t]*"(?:[^"\\\\]|\\\\.)*",[ \\t]*\\r?\\n', "m");
    if (re.test(t)) { t = t.replace(re, ""); hits++; }
  }
  if (hits) { fs.writeFileSync(p, t); touched++; }
}
console.log("maps updated:", touched, "/", fs.readdirSync("_maps").filter((f) => f.endsWith(".js")).length);
