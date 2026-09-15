// Apply the revised consent (Sept 14) to the 19 live _maps: new question text
// with the two doc links, and rename the two options. Targeted line edits so the
// rest of each map is untouched.
const fs = require("fs");
const SCRATCH = process.argv[2];
const T = JSON.parse(fs.readFileSync(SCRATCH + "/consent_translations.json", "utf8"));

const URL1 = "https://docs.google.com/document/d/1WeSqBQoyR3hGENO1d44B8Ff98TfHZ8eZ9jf7PDLDhQ0/edit?tab=t.0";
const URL2 = "https://docs.google.com/document/d/1uvspGqoCXBP8rUQTVf9yc9gd-8LcpqHhq-a7FHy6uUg/edit?tab=t.0";
const buildConsent = (o) =>
  o.consent.replace("[[L]]", "[" + o.label_letter + "](" + URL1 + ")")
           .replace("[[C]]", "[" + o.label_consent + "](" + URL2 + ")");

let done = 0; const errs = [];
for (const [code, o] of Object.entries(T)) {
  const p = "_maps/" + code + ".js";
  if (!fs.existsSync(p)) { errs.push(code + ": no map"); continue; }
  let t = fs.readFileSync(p, "utf8");

  const reConsent = /(\n\s*"?consent"?\s*:\s*)"(?:[^"\\]|\\.)*"/;
  const reAgree = /(\n\s*)"I agree"(\s*:\s*)"(?:[^"\\]|\\.)*"/;
  const reDisagree = /(\n\s*)"I disagree"(\s*:\s*)"(?:[^"\\]|\\.)*"/;
  if (!reConsent.test(t)) { errs.push(code + ": q.consent not found"); continue; }
  if (!reAgree.test(t)) { errs.push(code + ': o "I agree" not found'); continue; }
  if (!reDisagree.test(t)) { errs.push(code + ': o "I disagree" not found'); continue; }

  t = t.replace(reConsent, (m, pre) => pre + JSON.stringify(buildConsent(o)));
  t = t.replace(reAgree, (m, pre, mid) => pre + JSON.stringify("Yes, I confirm") + mid + JSON.stringify(o.yes));
  t = t.replace(reDisagree, (m, pre, mid) => pre + JSON.stringify("No, I do not confirm") + mid + JSON.stringify(o.no));
  fs.writeFileSync(p, t);
  done++;
}
console.log("patched:", done, "maps");
if (errs.length) { console.error("ERRORS:\n  " + errs.join("\n  ")); process.exit(1); }
