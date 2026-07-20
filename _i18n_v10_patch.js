// v10: add the 8 new question keys to every _maps/<code>.js q bucket, plus the
// new "Didn't look for job" option to the o bucket.
//
// Most new questions reuse an existing question's translation (identical or
// near-identical English) — copied per-language. Only two strings are genuinely
// new and translated below:
//   q.not_looking_expect_look  "Do you expect to start looking for work within the next 12 months?"
//   o["Didn't look for job"]
const fs = require("fs");

// new q key -> existing q key whose translation to reuse (null = use NEW table)
const Q_REUSE = {
  unemployed_support: "work_support",
  not_looking_intended_job: "intended_job_title",
  not_looking_barrier_gate: "unemployed_barrier_gate",
  not_looking_barriers: "work_barriers",
  not_looking_barriers_other: "work_barriers_other",
  not_looking_support: "work_support",              // English differs ("future job search"); reuse translation (draft)
  not_looking_support_other: "work_support_other",
  not_looking_expect_look: null,                    // NEW
};

const EXPECT = {
  fr: "Prévoyez-vous de commencer à chercher un emploi au cours des 12 prochains mois ?",
  es: "¿Espera comenzar a buscar trabajo en los próximos 12 meses?",
  pt: "Você espera começar a procurar trabalho nos próximos 12 meses?",
  it: "Prevedi di iniziare a cercare lavoro nei prossimi 12 mesi?",
  de: "Erwarten Sie, in den nächsten 12 Monaten mit der Arbeitssuche zu beginnen?",
  pl: "Czy spodziewasz się, że zaczniesz szukać pracy w ciągu najbliższych 12 miesięcy?",
  uk: "Чи плануєте ви почати шукати роботу протягом наступних 12 місяців?",
  fi: "Odotatko aloittavasi työnhaun seuraavien 12 kuukauden aikana?",
  tl: "Inaasahan mo bang magsisimulang maghanap ng trabaho sa loob ng susunod na 12 buwan?",
  hi: "क्या आप अगले 12 महीनों में काम खोजना शुरू करने की उम्मीद करते हैं?",
  bn: "আপনি কি আগামী ১২ মাসের মধ্যে কাজ খোঁজা শুরু করার আশা করেন?",
  pa: "ਕੀ ਤੁਸੀਂ ਅਗਲੇ 12 ਮਹੀਨਿਆਂ ਵਿੱਚ ਕੰਮ ਲੱਭਣਾ ਸ਼ੁਰੂ ਕਰਨ ਦੀ ਉਮੀਦ ਰੱਖਦੇ ਹੋ?",
  gu: "શું તમે આગામી 12 મહિનામાં કામ શોધવાનું શરૂ કરવાની અપેક્ષા રાખો છો?",
  ta: "அடுத்த 12 மாதங்களுக்குள் வேலை தேடத் தொடங்குவீர்கள் என்று எதிர்பார்க்கிறீர்களா?",
  ml: "അടുത്ത 12 മാസത്തിനുള്ളിൽ ജോലി അന്വേഷിക്കാൻ തുടങ്ങുമെന്ന് നിങ്ങൾ പ്രതീക്ഷിക്കുന്നുണ്ടോ?",
  zh: "您预计会在未来12个月内开始找工作吗？",
  ar: "هل تتوقع أن تبدأ البحث عن عمل خلال الأشهر الـ 12 القادمة؟",
  ur: "کیا آپ اگلے 12 مہینوں میں کام تلاش کرنا شروع کرنے کی توقع رکھتے ہیں؟",
  ku: "Ma tu hêvî dikî ku di 12 mehên bên de dest bi lêgerîna kar bikî?",
};
const DIDNT = {
  fr: "Je n'ai pas cherché d'emploi", es: "No busqué trabajo", pt: "Não procurei emprego",
  it: "Non ho cercato lavoro", de: "Habe keine Arbeit gesucht", pl: "Nie szukałem pracy",
  uk: "Не шукав роботу", fi: "En etsinyt työtä", tl: "Hindi naghanap ng trabaho",
  hi: "नौकरी नहीं खोजी", bn: "কাজ খুঁজিনি", pa: "ਨੌਕਰੀ ਨਹੀਂ ਲੱਭੀ", gu: "નોકરી શોધી નથી",
  ta: "வேலை தேடவில்லை", ml: "ജോലി അന്വേഷിച്ചില്ല", zh: "没有找工作",
  ar: "لم أبحث عن عمل", ur: "کام تلاش نہیں کیا", ku: "Min li kar negeriya",
};

function insertInto(text, bucketOpen, nextBucketOpen, additions) {
  // insert `additions` (already-formatted lines) right before the bucket's
  // closing "  },\n<nextBucketOpen>"
  const marker = "  },\n" + nextBucketOpen;
  const at = text.indexOf(marker, text.indexOf(bucketOpen));
  if (at < 0) return null;
  return text.slice(0, at) + additions + text.slice(at);
}

let done = 0, errs = [];
for (const f of fs.readdirSync("_maps").filter((f) => f.endsWith(".js"))) {
  const code = f.replace(/\.js$/, "");
  const M = require("./_maps/" + f);
  // build q additions (skip any that already exist)
  const qlines = [];
  for (const [nk, src] of Object.entries(Q_REUSE)) {
    if (M.q[nk] != null) continue; // idempotent
    let val;
    if (src === null) { val = EXPECT[code]; if (val == null) { errs.push(`${code}: no EXPECT`); continue; } }
    else { val = M.q[src]; if (val == null) { errs.push(`${code}: reuse src q.${src} missing`); continue; } }
    qlines.push("    " + JSON.stringify(nk) + ": " + JSON.stringify(val) + ",\n");
  }
  const oval = DIDNT[code];
  const olines = (M.o["Didn't look for job"] == null && oval != null)
    ? "    " + JSON.stringify("Didn't look for job") + ": " + JSON.stringify(oval) + ",\n" : "";
  if (!qlines.length && !olines) { console.log(`[${code}] already patched`); continue; }

  let t = fs.readFileSync("_maps/" + f, "utf8");
  if (qlines.length) { const r = insertInto(t, "  q: {", "  help: {", qlines.join("")); if (!r) { errs.push(`${code}: q anchor`); continue; } t = r; }
  if (olines) { const r = insertInto(t, "  o: {", "  def: {", olines); if (!r) { errs.push(`${code}: o anchor`); continue; } t = r; }
  fs.writeFileSync("_maps/" + f, t);
  done++;
}
console.log("patched:", done, "maps");
if (errs.length) { console.error("ERRORS:\n  " + errs.join("\n  ")); process.exit(1); }
