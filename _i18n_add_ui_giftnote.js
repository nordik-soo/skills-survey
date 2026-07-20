// v10: add the gift-card email privacy note (S() source string) to every map's
// ui bucket. English is the source; these are the 19 translations. DRAFT pending
// fluent-speaker review.
const fs = require("fs");

const K = "Note: This information will be used only for the prize draw and will not be linked to your survey responses.";

const T = {
  fr: "Remarque : ces informations seront utilisées uniquement pour le tirage au sort et ne seront pas liées à vos réponses au sondage.",
  es: "Nota: Esta información se utilizará únicamente para el sorteo del premio y no se vinculará a sus respuestas de la encuesta.",
  pt: "Nota: Estas informações serão usadas apenas para o sorteio do prêmio e não serão vinculadas às suas respostas da pesquisa.",
  it: "Nota: queste informazioni saranno utilizzate solo per l'estrazione del premio e non saranno collegate alle tue risposte al sondaggio.",
  de: "Hinweis: Diese Informationen werden nur für die Verlosung verwendet und nicht mit Ihren Umfrageantworten verknüpft.",
  pl: "Uwaga: te informacje zostaną wykorzystane wyłącznie do losowania nagród i nie będą powiązane z Twoimi odpowiedziami w ankiecie.",
  uk: "Примітка: ця інформація буде використана лише для розіграшу призів і не буде пов'язана з вашими відповідями в опитуванні.",
  fi: "Huomautus: Näitä tietoja käytetään vain palkintoarvontaan, eikä niitä yhdistetä kyselyvastauksiisi.",
  tl: "Tandaan: Ang impormasyong ito ay gagamitin lamang para sa premyong draw at hindi iuugnay sa iyong mga sagot sa survey.",
  hi: "नोट: इस जानकारी का उपयोग केवल पुरस्कार ड्रॉ के लिए किया जाएगा और इसे आपके सर्वेक्षण उत्तरों से नहीं जोड़ा जाएगा।",
  bn: "দ্রষ্টব্য: এই তথ্য শুধুমাত্র পুরস্কার ড্রয়ের জন্য ব্যবহার করা হবে এবং আপনার জরিপের উত্তরের সাথে যুক্ত করা হবে না।",
  pa: "ਨੋਟ: ਇਹ ਜਾਣਕਾਰੀ ਸਿਰਫ਼ ਇਨਾਮੀ ਡਰਾਅ ਲਈ ਵਰਤੀ ਜਾਵੇਗੀ ਅਤੇ ਤੁਹਾਡੇ ਸਰਵੇਖਣ ਜਵਾਬਾਂ ਨਾਲ ਨਹੀਂ ਜੋੜੀ ਜਾਵੇਗੀ।",
  gu: "નોંધ: આ માહિતીનો ઉપયોગ ફક્ત ઇનામ ડ્રો માટે કરવામાં આવશે અને તમારા સર્વેક્ષણ જવાબો સાથે લિંક કરવામાં આવશે નહીં.",
  ta: "குறிப்பு: இந்தத் தகவல் பரிசு டிராவிற்கு மட்டுமே பயன்படுத்தப்படும், உங்கள் கணக்கெடுப்பு பதில்களுடன் இணைக்கப்படாது.",
  ml: "കുറിപ്പ്: ഈ വിവരങ്ങൾ സമ്മാന നറുക്കെടുപ്പിനായി മാത്രമേ ഉപയോഗിക്കൂ, നിങ്ങളുടെ സർവേ പ്രതികരണങ്ങളുമായി ബന്ധിപ്പിക്കില്ല.",
  zh: "注意：此信息仅用于奖品抽奖，不会与您的调查回复相关联。",
  ar: "ملاحظة: ستُستخدم هذه المعلومات فقط لسحب الجائزة ولن تُربط بإجاباتك في الاستطلاع.",
  ur: "نوٹ: یہ معلومات صرف انعامی قرعہ اندازی کے لیے استعمال ہوں گی اور آپ کے سروے کے جوابات سے منسلک نہیں کی جائیں گی۔",
  ku: "Têbînî: Ev agahî tenê ji bo kişandina xelatê tê bikaranîn û bi bersivên anketê ve nayê girêdan.",
};

let n = 0, errs = [];
for (const [code, val] of Object.entries(T)) {
  const p = "_maps/" + code + ".js";
  if (!fs.existsSync(p)) { errs.push(`${code}: no map`); continue; }
  let t = fs.readFileSync(p, "utf8");
  const uiAt = t.indexOf("  ui: {");
  if (uiAt < 0) { errs.push(`${code}: no ui bucket`); continue; }
  const close = t.indexOf("  },", uiAt);
  if (close < 0) { errs.push(`${code}: ui close not found`); continue; }
  const keyRe = new RegExp("^[ \\t]*" + JSON.stringify(K).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ":", "m");
  if (keyRe.test(t)) { console.log(`[${code}] already present`); continue; }
  const add = "    " + JSON.stringify(K) + ": " + JSON.stringify(val) + ",\n";
  t = t.slice(0, close) + add + t.slice(close);
  fs.writeFileSync(p, t);
  n++;
}
console.log("maps updated:", n);
if (errs.length) { console.error("ERRORS:\n  " + errs.join("\n  ")); process.exit(1); }
