// Add ui strings to every language map's `ui:` bucket, from the table below.
// Used when a new UI string is introduced and must exist in all 19 dictionaries.
const fs = require("fs");

const A = "Thank you for starting the survey.";
const B = "Unfortunately we cannot proceed without your consent.";

const ADD = {
  fr: { [A]: "Merci d'avoir commencé le sondage.", [B]: "Malheureusement, nous ne pouvons pas continuer sans votre consentement." },
  es: { [A]: "Gracias por comenzar la encuesta.", [B]: "Lamentablemente, no podemos continuar sin su consentimiento." },
  pt: { [A]: "Obrigado por iniciar a pesquisa.", [B]: "Infelizmente, não podemos continuar sem o seu consentimento." },
  it: { [A]: "Grazie per aver iniziato il sondaggio.", [B]: "Purtroppo non possiamo procedere senza il tuo consenso." },
  de: { [A]: "Vielen Dank, dass Sie die Umfrage begonnen haben.", [B]: "Leider können wir ohne Ihre Zustimmung nicht fortfahren." },
  pl: { [A]: "Dziękujemy za rozpoczęcie ankiety.", [B]: "Niestety nie możemy kontynuować bez Twojej zgody." },
  uk: { [A]: "Дякуємо, що почали опитування.", [B]: "На жаль, ми не можемо продовжити без вашої згоди." },
  fi: { [A]: "Kiitos, että aloitit kyselyn.", [B]: "Valitettavasti emme voi jatkaa ilman suostumustasi." },
  tl: { [A]: "Salamat sa pagsisimula ng survey.", [B]: "Sa kasamaang palad, hindi kami makakapagpatuloy nang walang iyong pahintulot." },
  hi: { [A]: "सर्वेक्षण शुरू करने के लिए धन्यवाद।", [B]: "दुर्भाग्यवश, आपकी सहमति के बिना हम आगे नहीं बढ़ सकते।" },
  bn: { [A]: "জরিপ শুরু করার জন্য ধন্যবাদ।", [B]: "দুঃখিত, আপনার সম্মতি ছাড়া আমরা এগিয়ে যেতে পারি না।" },
  pa: { [A]: "ਸਰਵੇਖਣ ਸ਼ੁਰੂ ਕਰਨ ਲਈ ਧੰਨਵਾਦ।", [B]: "ਬਦਕਿਸਮਤੀ ਨਾਲ, ਤੁਹਾਡੀ ਸਹਿਮਤੀ ਤੋਂ ਬਿਨਾਂ ਅਸੀਂ ਅੱਗੇ ਨਹੀਂ ਵਧ ਸਕਦੇ।" },
  gu: { [A]: "સર્વેક્ષણ શરૂ કરવા બદલ આભાર.", [B]: "કમનસીબે, તમારી સંમતિ વિના અમે આગળ વધી શકતા નથી." },
  ta: { [A]: "ஆய்வைத் தொடங்கியதற்கு நன்றி.", [B]: "வருந்துகிறோம், உங்கள் ஒப்புதல் இல்லாமல் எங்களால் தொடர முடியாது." },
  ml: { [A]: "സർവേ ആരംഭിച്ചതിന് നന്ദി.", [B]: "ഖേദകരമെന്നു പറയട്ടെ, നിങ്ങളുടെ സമ്മതമില്ലാതെ ഞങ്ങൾക്ക് തുടരാനാവില്ല." },
  zh: { [A]: "感谢您开始本调查。", [B]: "很遗憾，未经您的同意我们无法继续。" },
  ar: { [A]: "شكرًا لبدء الاستطلاع.", [B]: "للأسف، لا يمكننا المتابعة دون موافقتك." },
  ur: { [A]: "سروے شروع کرنے کا شکریہ۔", [B]: "بدقسمتی سے، آپ کی رضامندی کے بغیر ہم آگے نہیں بڑھ سکتے۔" },
  ku: { [A]: "Spas ji bo destpêkirina anketê.", [B]: "Mixabin, em nikarin bêyî razîbûna te bidomînin." },
};

let n = 0;
for (const [code, entries] of Object.entries(ADD)) {
  const p = "_maps/" + code + ".js";
  if (!fs.existsSync(p)) { console.log(`[${code}] no map — skipped`); continue; }
  let t = fs.readFileSync(p, "utf8");
  const uiAt = t.indexOf("  ui: {");
  if (uiAt < 0) { console.log(`[${code}] no ui bucket — skipped`); continue; }
  const close = t.lastIndexOf("  },");
  if (close < 0 || close < uiAt) { console.log(`[${code}] ui close not found — skipped`); continue; }
  const add = Object.entries(entries)
    .filter(([k]) => !new RegExp("^[ \\t]*" + JSON.stringify(k).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ":", "m").test(t))
    .map(([k, v]) => "    " + JSON.stringify(k) + ": " + JSON.stringify(v) + ",\n").join("");
  if (!add) { console.log(`[${code}] already present`); continue; }
  t = t.slice(0, close) + add + t.slice(close);
  fs.writeFileSync(p, t);
  n++;
}
console.log("maps updated:", n);
