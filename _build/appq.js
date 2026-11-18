
const fs = require("fs");
const sb = { window: {}, document: { createElement: () => ({ style: {} }) } };
sb.window = sb;
new Function("window", "document", fs.readFileSync("survey-data.js", "utf8"))(sb, sb.document);
const Q = sb.SURVEY.QUESTIONS.map((q) => ({
  id: q.id,
  options: (q.options || []).map((o) => (typeof o === "string" ? o : o.value)),
}));
process.stdout.write(JSON.stringify(Q));
