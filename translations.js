// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — display-only translation layer.
//
// PRINCIPLE: this file only changes what the respondent SEES. It never changes
// what is stored or how the survey branches. Every answer is still saved as its
// canonical English value; all visibility rules, NOC/OaSIS + CIP lookups, barrier
// gates, and exports keep using English. `language_preference` records the choice.
//
// Missing translations fall back to English automatically, so a partially
// translated language is safe (English shows through the gaps) — but a language
// is only "release ready" once a fluent reviewer has completed and approved it,
// and (for the consent text) it has passed your team's ethics review.
//
// DICTIONARY BUCKETS (per language code):
//   q    question text            keyed by question id — OR a stable message key
//                                 for dynamic text (e.g. "work_barrier.a".."e")
//   o    option labels            keyed by the canonical ENGLISH option value
//   help per-question help text   keyed by question id
//   def  definitions / tooltips   keyed by the English term (the option value)
//   ui   fixed UI / screen text   keyed by the source ENGLISH string (gettext-style)
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  // Canonical English language name (as stored in language_preference) → code.
  // Config only — no database migration needed to store codes.
  const LANG_CODES = {
    English: "en", French: "fr", Italian: "it", Punjabi: "pa", Spanish: "es",
    Arabic: "ar", Finnish: "fi", Mandarin: "zh", Gujarati: "gu", Hindi: "hi",
    Malayalam: "ml", Portuguese: "pt", Tagalog: "tl", Kurdish: "ku", Polish: "pl",
    German: "de", Tamil: "ta", Bengali: "bn", Urdu: "ur", Ukrainian: "uk",
  };

  // Native display name for the language selector (shown to the respondent while
  // the stored value stays the canonical English name above).
  const NATIVE_NAMES = {
    English: "English", French: "Français", Italian: "Italiano", Punjabi: "ਪੰਜਾਬੀ",
    Spanish: "Español", Arabic: "العربية", Finnish: "Suomi", Mandarin: "中文",
    Gujarati: "ગુજરાતી", Hindi: "हिन्दी", Malayalam: "മലയാളം", Portuguese: "Português",
    Tagalog: "Tagalog", Kurdish: "Kurdî", Polish: "Polski", German: "Deutsch",
    Tamil: "தமிழ்", Bengali: "বাংলা", Urdu: "اردو", Ukrainian: "Українська",
  };

  // Right-to-left languages (layout mode — wired later in Phase 2).
  const RTL = new Set(["ar", "ur", "ku"]);

  // ── Dictionaries, keyed by language code ──────────────────────────────────
  // English is the source and is NOT listed here (it's the fallback). Add a
  // language only after review.
  //
  // No language is released yet. `fr` is present but EMPTY, so the engine is live
  // and dormant: every string falls back to English until a fluent reviewer fills
  // these buckets (and the consent text passes ethics review). The engine was
  // verified end to end with a temporary sample before it was emptied here.
  //
  // To translate French, populate the buckets below. Keys:
  //   q    — question id, e.g. `consent`, `gender`; dynamic barrier gate uses the
  //          stable keys `work_barrier.a` … `work_barrier.e` (five wordings)
  //   o    — the canonical ENGLISH option value, e.g. "Employed full time (30+ hours/week)"
  //   help — question id
  //   def  — the English term (the option value the tooltip explains)
  //   ui   — the source ENGLISH string, e.g. "Submit"
  const DICT = {
    fr: { q: {}, o: {}, help: {}, def: {}, ui: {} },
  };

  const codeFor = (name) => LANG_CODES[name] || "en";
  const dictFor = (code) => (code !== "en" && DICT[code]) || null;
  // generic lookup with English fallback
  const pick = (bucket, key, english, code) => {
    const d = dictFor(code);
    return (d && d[bucket] && d[bucket][key]) || english;
  };

  window.I18N = {
    LANG_CODES,
    NATIVE_NAMES,
    code: codeFor,
    isRTL: (code) => RTL.has(code),
    native: (name) => NATIVE_NAMES[name] || name,
    // question text by id OR dynamic message key
    q: (key, english, code) => pick("q", key, english, code),
    // option label by canonical English value
    o: (value, code) => pick("o", value, value, code),
    // per-question help text by question id
    help: (id, english, code) => pick("help", id, english, code),
    // definition / tooltip by English term
    def: (term, english, code) => pick("def", term, english, code),
    // fixed UI / screen string by its source English text
    ui: (text, code) => pick("ui", text, text, code),
  };
})();
