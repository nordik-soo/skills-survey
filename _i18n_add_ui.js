// Add ui strings to every language map's `ui:` bucket, from a table below.
// Used when a new UI string is introduced and must exist in all 19 dictionaries.
const fs = require("fs");

const ADD = {
  fr: { "Thank you for your interest.": "Merci de votre intérêt.", "Unfortunately you are not eligible to participate in the survey.": "Malheureusement, vous n'êtes pas admissible à participer à ce sondage." },
  es: { "Thank you for your interest.": "Gracias por su interés.", "Unfortunately you are not eligible to participate in the survey.": "Lamentablemente, no es elegible para participar en la encuesta." },
  pt: { "Thank you for your interest.": "Obrigado pelo seu interesse.", "Unfortunately you are not eligible to participate in the survey.": "Infelizmente, você não é elegível para participar da pesquisa." },
  it: { "Thank you for your interest.": "Grazie per il tuo interesse.", "Unfortunately you are not eligible to participate in the survey.": "Purtroppo non sei idoneo a partecipare al sondaggio." },
  de: { "Thank you for your interest.": "Vielen Dank für Ihr Interesse.", "Unfortunately you are not eligible to participate in the survey.": "Leider sind Sie nicht berechtigt, an der Umfrage teilzunehmen." },
  pl: { "Thank you for your interest.": "Dziękujemy za zainteresowanie.", "Unfortunately you are not eligible to participate in the survey.": "Niestety nie kwalifikujesz się do udziału w ankiecie." },
  uk: { "Thank you for your interest.": "Дякуємо за ваш інтерес.", "Unfortunately you are not eligible to participate in the survey.": "На жаль, ви не маєте права брати участь в опитуванні." },
  fi: { "Thank you for your interest.": "Kiitos kiinnostuksestasi.", "Unfortunately you are not eligible to participate in the survey.": "Valitettavasti et ole oikeutettu osallistumaan kyselyyn." },
  tl: { "Thank you for your interest.": "Salamat sa iyong interes.", "Unfortunately you are not eligible to participate in the survey.": "Sa kasamaang palad, hindi ka kwalipikadong lumahok sa survey." },
  hi: { "Thank you for your interest.": "आपकी रुचि के लिए धन्यवाद।", "Unfortunately you are not eligible to participate in the survey.": "दुर्भाग्यवश, आप इस सर्वेक्षण में भाग लेने के पात्र नहीं हैं।" },
  bn: { "Thank you for your interest.": "আপনার আগ্রহের জন্য ধন্যবাদ।", "Unfortunately you are not eligible to participate in the survey.": "দুঃখিত, আপনি এই জরিপে অংশগ্রহণের যোগ্য নন।" },
  pa: { "Thank you for your interest.": "ਤੁਹਾਡੀ ਦਿਲਚਸਪੀ ਲਈ ਧੰਨਵਾਦ।", "Unfortunately you are not eligible to participate in the survey.": "ਬਦਕਿਸਮਤੀ ਨਾਲ, ਤੁਸੀਂ ਇਸ ਸਰਵੇਖਣ ਵਿੱਚ ਭਾਗ ਲੈਣ ਦੇ ਯੋਗ ਨਹੀਂ ਹੋ।" },
  gu: { "Thank you for your interest.": "તમારી રુચિ બદલ આભાર.", "Unfortunately you are not eligible to participate in the survey.": "કમનસીબે, તમે આ સર્વેક્ષણમાં ભાગ લેવા પાત્ર નથી." },
  ta: { "Thank you for your interest.": "உங்கள் ஆர்வத்திற்கு நன்றி.", "Unfortunately you are not eligible to participate in the survey.": "வருந்துகிறோம், இந்த ஆய்வில் பங்கேற்க நீங்கள் தகுதியுடையவர் அல்ல." },
  ml: { "Thank you for your interest.": "നിങ്ങളുടെ താൽപ്പര്യത്തിന് നന്ദി.", "Unfortunately you are not eligible to participate in the survey.": "ഖേദകരമെന്നു പറയട്ടെ, ഈ സർവേയിൽ പങ്കെടുക്കാൻ നിങ്ങൾ യോഗ്യനല്ല." },
  zh: { "Thank you for your interest.": "感谢您的关注。", "Unfortunately you are not eligible to participate in the survey.": "很遗憾，您不符合参加本调查的条件。" },
  ar: { "Thank you for your interest.": "شكرًا لاهتمامك.", "Unfortunately you are not eligible to participate in the survey.": "للأسف، أنت غير مؤهل للمشاركة في هذا الاستطلاع." },
  ur: { "Thank you for your interest.": "آپ کی دلچسپی کا شکریہ۔", "Unfortunately you are not eligible to participate in the survey.": "بدقسمتی سے، آپ اس سروے میں حصہ لینے کے اہل نہیں ہیں۔" },
  ku: { "Thank you for your interest.": "Spas ji bo eleqeya te.", "Unfortunately you are not eligible to participate in the survey.": "Mixabin, tu ne mafdar î ku beşdarî vê anketê bibî." },
};

let n = 0;
for (const [code, entries] of Object.entries(ADD)) {
  const p = "_maps/" + code + ".js";
  if (!fs.existsSync(p)) { console.log(`[${code}] no map — skipped`); continue; }
  let t = fs.readFileSync(p, "utf8");
  const uiAt = t.indexOf("  ui: {");
  if (uiAt < 0) { console.log(`[${code}] no ui bucket — skipped`); continue; }
  // ui bucket closes at the last "  }," in the file (followed by "};")
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
