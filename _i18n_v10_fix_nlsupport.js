// v10 fix: not_looking_support was drafted by reusing work_support's translation
// ("...support would help you get the job you want"). The real v10 question asks
// about a FUTURE job search:
//   "Which type of support would help in your future job search? Select all that apply."
// Replace the q.not_looking_support value in each _maps/<code>.js with a faithful
// translation. Options are shared (o bucket) and unaffected. Still DRAFT pending
// fluent-speaker review, but now semantically correct.
const fs = require("fs");

const NL = {
  fr: "Quel type de soutien vous aiderait dans votre future recherche d'emploi ? Sélectionnez tout ce qui s'applique.",
  es: "¿Qué tipo de apoyo le ayudaría en su futura búsqueda de empleo? Seleccione todas las opciones que correspondan.",
  pt: "Que tipo de apoio ajudaria na sua futura procura de emprego? Selecione todas as opções aplicáveis.",
  it: "Che tipo di supporto ti aiuterebbe nella tua futura ricerca di lavoro? Seleziona tutte le opzioni pertinenti.",
  de: "Welche Art von Unterstützung würde Ihnen bei Ihrer zukünftigen Arbeitssuche helfen? Wählen Sie alles Zutreffende aus.",
  pl: "Jaki rodzaj wsparcia pomógłby w Twoim przyszłym poszukiwaniu pracy? Zaznacz wszystkie pasujące odpowiedzi.",
  uk: "Який вид підтримки допоміг би вам у майбутньому пошуку роботи? Виберіть усе, що підходить.",
  fi: "Millainen tuki auttaisi sinua tulevassa työnhaussasi? Valitse kaikki sopivat.",
  tl: "Anong uri ng suporta ang makakatulong sa iyong hinaharap na paghahanap ng trabaho? Piliin lahat ng naaangkop.",
  hi: "आपकी भविष्य की नौकरी खोज में किस प्रकार की सहायता मददगार होगी? लागू होने वाले सभी विकल्प चुनें।",
  bn: "আপনার ভবিষ্যতের চাকরি খোঁজায় কোন ধরনের সহায়তা সাহায্য করবে? প্রযোজ্য সবগুলো নির্বাচন করুন।",
  pa: "ਤੁਹਾਡੀ ਭਵਿੱਖ ਦੀ ਨੌਕਰੀ ਦੀ ਖੋਜ ਵਿੱਚ ਕਿਸ ਕਿਸਮ ਦੀ ਸਹਾਇਤਾ ਮਦਦਗਾਰ ਹੋਵੇਗੀ? ਲਾਗੂ ਹੋਣ ਵਾਲੇ ਸਾਰੇ ਚੁਣੋ।",
  gu: "તમારી ભવિષ્યની નોકરી શોધમાં કયા પ્રકારની સહાય મદદરૂપ થશે? લાગુ પડતા બધા પસંદ કરો.",
  ta: "உங்கள் எதிர்கால வேலைத் தேடலில் எந்த வகையான ஆதரவு உதவும்? பொருந்தும் அனைத்தையும் தேர்ந்தெடுக்கவும்.",
  ml: "നിങ്ങളുടെ ഭാവിയിലെ ജോലി അന്വേഷണത്തിൽ ഏത് തരത്തിലുള്ള പിന്തുണ സഹായകമാകും? ബാധകമായവയെല്ലാം തിരഞ്ഞെടുക്കുക.",
  zh: "哪种类型的支持能帮助您未来找工作？请选择所有适用项。",
  ar: "ما نوع الدعم الذي سيساعدك في بحثك عن عمل مستقبلاً؟ اختر كل ما ينطبق.",
  ur: "آپ کی مستقبل کی ملازمت کی تلاش میں کس قسم کی مدد فائدہ مند ہوگی؟ ان تمام کو منتخب کریں جو لاگو ہوں۔",
  ku: "Kîjan cure piştgirî dê di lêgerîna kar a paşerojê de alîkariya te bike? Hemû yên ku li gorî rewşê ne hilbijêre.",
};

let done = 0, errs = [];
for (const f of fs.readdirSync("_maps").filter((f) => f.endsWith(".js"))) {
  const code = f.replace(/\.js$/, "");
  const val = NL[code];
  if (val == null) { errs.push(`${code}: no NL translation`); continue; }
  let t = fs.readFileSync("_maps/" + f, "utf8");
  // match the whole "not_looking_support": "....", line (value may contain escaped quotes)
  const re = /( *"not_looking_support":\s*)"(?:[^"\\]|\\.)*"(,?)/;
  if (!re.test(t)) { errs.push(`${code}: key line not found`); continue; }
  t = t.replace(re, (_m, pre, comma) => pre + JSON.stringify(val) + comma);
  fs.writeFileSync("_maps/" + f, t);
  done++;
}
console.log("fixed:", done, "maps");
if (errs.length) { console.error("ERRORS:\n  " + errs.join("\n  ")); process.exit(1); }
