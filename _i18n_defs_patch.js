// Replace a language's whole `def:` bucket in _maps/<code>.js from _defs/<code>.json.
// Usage: node _i18n_defs_patch.js <code> [<code> ...]
const fs = require("fs");

for (const code of process.argv.slice(2)) {
  const mapPath = "_maps/" + code + ".js";
  const defPath = "_defs/" + code + ".json";
  if (!fs.existsSync(mapPath)) { console.log(`[${code}] no map — skipped`); continue; }
  if (!fs.existsSync(defPath)) { console.log(`[${code}] no _defs/${code}.json — skipped`); continue; }
  const defs = JSON.parse(fs.readFileSync(defPath, "utf8"));
  let t = fs.readFileSync(mapPath, "utf8");

  // def bucket runs from "  def: {" to the "  }," immediately before "  ui: {"
  const start = t.indexOf("  def: {");
  const uiAt = t.indexOf("  ui: {", start);
  if (start < 0 || uiAt < 0) { console.log(`[${code}] anchors not found — skipped`); continue; }
  const end = t.lastIndexOf("  },", uiAt);
  if (end < 0) { console.log(`[${code}] def close not found — skipped`); continue; }

  const body = Object.entries(defs)
    .map(([k, v]) => "    " + JSON.stringify(k) + ": " + JSON.stringify(v) + ",")
    .join("\n");
  t = t.slice(0, start) + "  def: {\n" + body + "\n  },\n" + t.slice(end + "  },\n".length);
  fs.writeFileSync(mapPath, t);
  console.log(`[${code}] def bucket replaced — ${Object.keys(defs).length} entries`);
}
