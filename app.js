/* ── Sault Skill Survey — app logic ─────────────────────────── */
(function () {
  const { QUESTIONS, SECTIONS, SKILLS } = window.SURVEY;
  const SS_KEY = "sault_survey_submissions_v1";
  const SS_STARTS = "sault_survey_starts_v1";
  const SS_DRAFT = "sault_survey_draft_v1";
  const SS_COLLAB = "sault_collaborators_v1";

  // ── state ──────────────────────────────────────────────────
  let answers = {};
  let currentId = QUESTIONS[0].id;
  let adminAuthed = false;
  let adminRole = null; // "super" (full dashboard) | "invite" (invitations only)
  let respondentId = null; // server-side respondent row id for this attempt
  let homeVariant = null;  // which homepage variant (HP1 control / HP2 nudge) this visitor saw
  let inviteToken = null;  // personal-link token (channel = invite) if present
  let source = null;       // community/source tag from a QR link (?src=), e.g. "school-board"
  let motiv = null;        // motivation-card experiment state for the current question (HP2 arm)
  let inviteCompleted = false; // this invite link already has a completed response
  const INVITE_KEY = "sault_invite_token";
  const SOURCE_KEY = "sault_survey_source";
  let ratingStep = 0;      // current skill index within a rating question (one-at-a-time)
  let ratingStepQ = null;  // which rating question ratingStep currently applies to

  // Per-question timing (v13). The tracker owns the arithmetic; app.js tells it
  // which question is on screen and when the response is sent. See timing.js.
  const timing = window.NordikTiming.createTracker();

  // Cloudflare Turnstile (bot check on the final submit). Site key is public.
  // Production keys don't work on localhost, so use Cloudflare's always-pass
  // TEST key there; the real key runs on every real (allowlisted) domain.
  const TURNSTILE_SITE_KEY =
    /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)
      ? "1x00000000000000000000AA"
      : "0x4AAAAAADunx3DOaWKiJx9_";
  let captchaToken = null;      // token from a solved Turnstile challenge
  let turnstileWidgetId = null; // rendered widget id (for reset/remove)

  // Browser storage can be unavailable (blocked cookies, private mode) or full.
  // A failed write must never stop the respondent: every access goes through
  // these helpers and falls back to memory for the rest of the session, so the
  // survey keeps working even when nothing can be saved to the device.
  function storeFallback() {
    if (!storeFallback.mem) storeFallback.mem = {};
    return storeFallback.mem;
  }
  function sGet(key) {
    try {
      const v = localStorage.getItem(key);
      if (v !== null) return v;
    } catch (e) {}
    const mem = storeFallback();
    return Object.prototype.hasOwnProperty.call(mem, key) ? mem[key] : null;
  }
  function sSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { storeFallback()[key] = String(value); }
  }
  function sRemove(key) {
    try { localStorage.removeItem(key); } catch (e) {}
    delete storeFallback()[key];
  }

  // restore draft
  try {
    const d = JSON.parse(sGet(SS_DRAFT) || "null");
    if (d && d.answers) {
      answers = d.answers;
      currentId = d.currentId || currentId;
      respondentId = d.respondentId || null;
      // Totals already measured survive a reload. The question that was open when
      // the tab closed starts fresh on its return, so time away is never counted.
      if (d.timings) timing.restore(d.timings);
    }
  } catch (e) {}

  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  // Markdown-style [label](url) → safe links (used in the consent question for the
  // Survey Information Letter / Consent Information docs). Every segment is escaped.
  // Neither document is opened externally: each label becomes a button that opens
  // its card in place, so respondents never leave the survey for a Google Doc
  // mid-consent. stripMd() gives the plain text for read-aloud (link labels only,
  // no URLs), so the spoken text is unchanged.
  const MD_LINK = /\[([^\]]+)\]\(([^)]+)\)/g;
  // Google Doc ids of the approved documents, so a link opens the in-page card.
  const INFO_DOC_IDS = {
    consent: "1uvspGqoCXBP8rUQTVf9yc9gd-8LcpqHhq-a7FHy6uUg",
    letter: "1WeSqBQoyR3hGENO1d44B8Ff98TfHZ8eZ9jf7PDLDhQ0",
  };
  // Which card a link opens, or null for a genuine external link.
  const infoCardFor = (url) => {
    const u = String(url);
    for (const kind of Object.keys(INFO_DOC_IDS)) {
      if (u.indexOf("#" + kind + "-info") === 0 || u.indexOf(INFO_DOC_IDS[kind]) >= 0) return kind;
    }
    return null;
  };
  function mdLinks(text) {
    let out = "", last = 0, m;
    MD_LINK.lastIndex = 0;
    while ((m = MD_LINK.exec(text))) {
      out += esc(text.slice(last, m.index));
      const kind = infoCardFor(m[2]);
      out += kind
        ? `<button type="button" class="q-link q-link-btn" data-info-card="${esc(kind)}" aria-haspopup="dialog">${esc(m[1])}</button>`
        : `<a href="${esc(m[2])}" target="_blank" rel="noopener noreferrer" class="q-link">${esc(m[1])}</a>`;
      last = m.index + m[0].length;
    }
    return out + esc(text.slice(last));
  }
  const stripMd = (text) => String(text).replace(MD_LINK, "$1");

  // ── in-page information cards ──────────────────────────────
  // Wording pasted verbatim from the two approved documents. Do not paraphrase
  // or reflow: this is ethics-approved language, and the consent step depends on
  // respondents reading exactly this.

  // "Consent Information" — short list of understanding statements.
  const CONSENT_INFO_POINTS = [
    "I understand what I will be asked to do and that the survey will take approximately 5–10 minutes.",
    "I understand the possible risks and benefits of participating.",
    "I understand that participation is voluntary and that I may skip questions or stop before submitting the survey.",
    "I understand that if I leave before submitting the survey, my responses up to that point will be saved anonymously and may be used in the research.",
    "I understand that once I submit my anonymous responses, they cannot be withdrawn because they cannot be linked back to me.",
    "I understand that entering the prize draw is optional and that my contact information will be stored separately from my survey responses.",
    "I understand how my responses will be stored, protected, used, and reported.",
    "I know whom to contact if I have questions about the study or my rights as a participant.",
  ];

  // "Survey Information Letter" — headed sections. `h` heading, `p` paragraph,
  // `lines` the researcher's contact block, `note` the closing instruction.
  const LETTER_INFO_BLOCKS = [
    { h: "Why is this study being conducted?" },
    { p: "NORDIK Institute at Algoma University, with funding from the Ontario Ministry of Rural Affairs through the Rural Ontario Development (ROD) Program, leads the Bridging Labour Market Gaps: Building Workforce Readiness for Newcomers in Northern Ontario project. The project aims to better understand workforce readiness, employment experiences, skill gaps, labour market integration, and workforce needs in Sault Ste. Marie and surrounding Northern Ontario communities. By sharing their experiences, newcomers can help identify what is working, where support is missing, and what could make it easier to find suitable employment and build their careers. Their input will help improve local employment services, training opportunities, and workforce strategies, benefiting both newcomers and the broader community." },
    { p: "If you agree to participate, you will be asked to complete a survey regarding your background, education, employment experiences, skills, workforce readiness, and experiences finding employment and accessing services in Northern Ontario. The survey should take approximately 5–10 minutes to complete." },
    { p: "Participation is entirely voluntary. You may skip any question that you do not wish to answer. If you wish to leave, no further information will be collected; however, anonymous responses entered up to that point will be saved and may be used in the research." },
    { h: "Are my answers anonymous?" },
    { p: "Survey responses will be collected anonymously using a randomly generated participant identifier" },
    { h: "What are the risks or discomforts of participating?" },
    { p: "Some participants may experience minor discomfort when reflecting on employment challenges, skill gaps, or barriers to labour market participation. You may skip any questions that make you uncomfortable." },
    { h: "What are the benefits to me or others?" },
    { p: "Your responses will help improve employment services, training opportunities, and workforce planning for newcomers and the broader community." },
    { p: "After completing the survey, you may voluntarily enter a prize draw for a chance to win one laptop or one of three $100 Visa gift cards. If you provide contact information, you will also receive early access to a skill-matching platform to explore skill gaps, local jobs and training options tailored to your own profile. However, participation does not guarantee an interview, employment, or job placement." },
    { h: "How will my information be stored?" },
    { p: "Survey data will be stored on secure servers developed and controlled by the research team. Research data will be retained and destroyed in accordance with Algoma University policies governing research data retention and management." },
    { h: "Can I learn about the study results?" },
    { p: "Yes. Key findings will be shared through a news release, social media posts, and NORDIK Institute's annual report." },
    { h: "Who is conducting the study?" },
    { p: "Research team led by" },
    { lines: ["Dr. Tamanna Rimi", "Director of Research, NORDIK Institute", "Adjunct Faculty, Algoma University", "tamanna.rimi@algomau.ca"] },
    { p: "If you would like to know more about the study or have concerns, please contact Dr. Rimi." },
    { h: "What are my rights as a research participant?" },
    { p: "This study has been reviewed and received ethics clearance through Algoma University Research Ethics Board. If you have any questions about the rights of study participants, please contact the Research Ethics Board at Algoma University (ethicsoffice@algomau.ca)" },
    { note: "Please print, save, or take a screenshot of this page for your records." },
  ];

  // The card contents are built per language in infoCards() below.

  // Localised copy for the two information cards. English falls through to the
  // survey's own constants; every other language reads the homepage block of its
  // master, which carries the letter sections and consent points word for word.
  function infoCards() {
    const d = dict();
    if (!d || !d.home || !Array.isArray(d.home.letter)) {
      return {
        consent: { title: "CONSENT INFORMATION", points: CONSENT_INFO_POINTS },
        letter: { title: "INFORMATION LETTER", blocks: LETTER_INFO_BLOCKS },
      };
    }
    return {
      consent: { title: d.home.consentTitle, points: d.home.consentPoints },
      letter: { title: d.home.letterTitle, blocks: d.home.letter },
    };
  }

  // Addresses stay exactly as written but become tappable mailto links. Runs on
  // already-escaped text: an email holds no character that esc() changes.
  const EMAIL_RE = /[^\s()<>@]+@[^\s()<>]+\.[A-Za-z]{2,}/g;
  const withMailto = (escaped) =>
    escaped.replace(EMAIL_RE, (m) => `<a class="modal-mail" href="mailto:${m}">${m}</a>`);

  function infoCardBody(spec) {
    if (spec.points) {
      return `<ul class="modal-list">${spec.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>`;
    }
    return spec.blocks.map((b) => {
      if (b.h) return `<h3 class="modal-h">${esc(b.h)}</h3>`;
      if (b.lines) {
        return `<div class="modal-contact">${b.lines
          .map((l, i) => `<div${i === 0 ? ' class="modal-contact-name"' : ""}>${withMailto(esc(l))}</div>`)
          .join("")}</div>`;
      }
      if (b.note) return `<p class="modal-note">${esc(b.note)}</p>`;
      return `<p class="modal-p">${withMailto(esc(b.p))}</p>`;
    }).join("");
  }

  let infoCard = null; // mounted overlay, non-null only while open
  let infoCardFocus = null; // element to give focus back to on close

  function closeInfoCard() {
    if (!infoCard) return;
    const back = infoCardFocus;
    infoCard.remove();
    infoCard = null;
    infoCardFocus = null;
    document.body.classList.remove("modal-open");
    document.removeEventListener("keydown", infoCardKeys, true);
    if (back && back.isConnected) back.focus();
  }

  // Esc closes; Tab is kept inside the card so focus can't wander behind it.
  function infoCardKeys(e) {
    if (!infoCard) return;
    if (e.key === "Escape" || e.key === "Esc") { e.preventDefault(); closeInfoCard(); return; }
    if (e.key !== "Tab") return;
    const items = infoCard.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0], last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !infoCard.contains(active))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (active === last || !infoCard.contains(active))) { e.preventDefault(); first.focus(); }
  }

  function openInfoCard(kind) {
    const spec = infoCards()[kind];
    if (!spec || infoCard) return; // one card at a time
    infoCardFocus = document.activeElement;
    const overlay = el("div", "modal-overlay");
    // the card sits outside #view-survey, so it carries its own direction
    overlay.setAttribute("dir", isRTL() ? "rtl" : "ltr");
    overlay.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="info-card-title" tabindex="-1">
        <h2 class="modal-title" id="info-card-title">${esc(S(spec.title))}</h2>
        <div class="modal-body">${infoCardBody(spec)}</div>
        <div class="modal-actions">
          <button type="button" class="btn modal-close">${esc(S("Close"))}</button>
        </div>
      </div>`;
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay || e.target.closest(".modal-close")) closeInfoCard();
    });
    document.body.appendChild(overlay);
    document.body.classList.add("modal-open");
    document.addEventListener("keydown", infoCardKeys, true);
    infoCard = overlay;
    const card = overlay.querySelector(".modal-card");
    card.focus();
  }

  // Survey nav arrows: a solid block arrow — thick shaft, filled triangular
  // head — not a stroked glyph. It fills its box, so it reads far heavier than
  // the font's ← / → (16x6 px of 1px hairline at any size) at the same height.
  // One left-pointing path; the "next" button flips it (.is-next) and the RTL
  // rule flips the whole button, so both follow the reading order.
  const NAV_ARROW_SVG = '<svg viewBox="0 0 22 14" fill="currentColor" aria-hidden="true" focusable="false"><path d="M0 7 12 0v3.8h10v6.4H12V14Z"/></svg>';

  // Trophy goal marker (original SVG): cup + two handles + stem + base. Colored via currentColor.
  const TROPHY_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4h10v4.5a5 5 0 0 1-10 0V4Z"/><path d="M7 5.5H5a2 2 0 0 0 2 2"/><path d="M17 5.5h2a2 2 0 0 1-2 2"/><path d="M12 13.5V17"/><path d="M8.5 20h7l-1-3h-5Z"/></svg>';

  function saveDraft() {
    // stamp() carries every total measured so far, including the question on
    // screen at this instant, so a draft is never one question behind. The open
    // interval is read, not closed, so nothing is counted twice.
    // sSet never throws: if the device cannot store the draft the respondent
    // still moves on, and the session keeps its answers in memory.
    sSet(
      SS_DRAFT,
      JSON.stringify({ answers, currentId, respondentId, timings: timing.stamp() })
    );
  }
  function getSubmissions() { try { return JSON.parse(sGet(SS_KEY) || "[]"); } catch (e) { return []; } }
  function getStarts() { return parseInt(sGet(SS_STARTS) || "0", 10); }

  // ── visible question flow (branching) ──────────────────────
  function visibleList() { return QUESTIONS.filter((q) => !q.visible || q.visible(answers)); }
  function posOf(id) { const l = visibleList(); const i = l.findIndex((q) => q.id === id); return i < 0 ? 0 : i; }

  // Only Consent and Eligibility block Next/Submit; every other question is
  // optional and can be skipped without answering.
  const REQUIRED_IDS = new Set(["consent", "eligible"]);
  const mustAnswer = (q) => !!q && REQUIRED_IDS.has(q.id);
  function isAnswered(q) {
    if (q.optional) {
      if (q.type === "contact") { const c = answers.contact || {}; return !c.optin || isEmail(c.email); }
      return true;
    }
    const v = answers[q.id];
    if (q.id === "gift_card_draw") {
      if (v === "No") return true;
      return v === "Yes" && isEmail(answers.gift_card_email);
    }
    if (q.type === "multi") return Array.isArray(v) && v.length > 0;
    if (q.type === "rating") { const sk = typeof q.skills === "function" ? q.skills(answers) : q.skills; return !!v && sk.length > 0 && sk.every(([k]) => v[k] != null); }
    return v != null && v !== "";
  }
  const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());

  // ── routing ────────────────────────────────────────────────
  function route() {
    const h = (location.hash || "#/").replace(/^#/, "");
    document.body.dataset.route = h.startsWith("/survey") ? "survey" : h.startsWith("/admin") ? "admin" : "home";
    if (!h.startsWith("/admin")) document.querySelector(".admin-header-actions")?.remove();
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    if (h.startsWith("/survey")) { $("#view-survey").classList.add("active"); renderSurvey(); }
    else if (h.startsWith("/admin")) { $("#view-admin").classList.add("active"); renderAdmin(); }
    else { $("#view-home").classList.add("active"); }
    window.scrollTo(0, 0);
  }

  function go(hash) { location.hash = hash; }

  // ── home ───────────────────────────────────────────────────
  function renderHomeBody(v) {
    const body = $("#home-body");
    // A translated homepage uses the master's own introduction for the variant.
    const d = dict();
    const paras = (d && d.home && (homeVariant === "HP2" ? d.home.hp2 : d.home.hp1)) || v.body;
    if (body && Array.isArray(paras)) {
      body.innerHTML = "";
      paras.forEach((para) => body.appendChild(el("p", "home-body-p", esc(para))));
    }
  }

  // Pick a sticky homepage variant (saved per browser), swap the copy, and count
  // one impression the first time this visitor is assigned one.
  function applyHomeVariant() {
    const variants = (window.SURVEY && window.SURVEY.HOME_VARIANTS) || {};
    const ids = Object.keys(variants);
    if (!ids.length) return;

    // Demo override: ?hp=HP2 forces a variant for previewing. It does NOT persist
    // and is NOT counted as a view, so team previews don't skew the experiment.
    const preview = new URLSearchParams(location.search).get("hp");
    if (preview && ids.includes(preview)) {
      homeVariant = preview;
      renderHomeBody(variants[preview]);
      return;
    }

    const KEY = "sault_home_variant_v1";
    let id = sGet(KEY);
    if (!ids.includes(id)) {
      id = ids[Math.floor(Math.random() * ids.length)];
      sSet(KEY, id);
    }
    homeVariant = id;
    renderHomeBody(variants[id]);
    // Count one view per browser, on its OWN key (independent of the sticky variant
    // assignment) — so a browser that already has a variant still logs its first view.
    const VIEW_KEY = "sault_home_viewed";
    if (!sGet(VIEW_KEY)) {
      sSet(VIEW_KEY, id);
      fetch("/api/home-view", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variant: id }),
      }).catch(() => {});
    }
  }

  // Resolve a personal-invite link (?t=token): tag the channel and learn whether
  // this token already has a completed response (so we don't let them retake it).
  async function captureInvite() {
    const urlT = new URLSearchParams(location.search).get("t");
    if (urlT) sSet(INVITE_KEY, urlT);
    inviteToken = sGet(INVITE_KEY) || null;
    if (!inviteToken) { inviteCompleted = false; return; }
    try {
      const s = await fetch("/api/invite?t=" + encodeURIComponent(inviteToken)).then((r) => r.json());
      if (!s.valid) { sRemove(INVITE_KEY); inviteToken = null; inviteCompleted = false; }
      else inviteCompleted = !!s.completed;
    } catch (e) {}
  }

  // Capture a community source tag from a QR link (?src=school-board). Sanitized
  // to a safe slug and remembered for this browser, so it survives a reload/return
  // before the respondent actually starts. Sent with /api/start → stored per row.
  function captureSource() {
    const raw = new URLSearchParams(location.search).get("src");
    if (raw) {
      const clean = raw.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
      if (clean) sSet(SOURCE_KEY, clean);
    }
    source = sGet(SOURCE_KEY) || null;
  }

  function startSurvey() {
    if (inviteCompleted) { go("#/survey"); return; } // renders the "already completed" notice
    // Already have an in-progress response in this browser → continue where they left
    // off (keep answers + position, and don't create another "started" row).
    if (respondentId) { go("#/survey"); return; }
    answers = {}; currentId = QUESTIONS[0].id; resetMotivation(); saveDraft();
    go("#/survey");
    fetch("/api/start", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variant: homeVariant, token: inviteToken, source: source }),
    })
      .then((r) => r.json())
      .then((d) => { if (d && d.id) { respondentId = d.id; saveDraft(); } })
      .catch(() => {});
  }

  // ── language ────────────────────────────────────────────────
  // English is the source text. Every other language looks its wording up in
  // translations.js, which tools/build_translations.js generates from the eight
  // uploaded translation masters. A missing entry never falls back to English:
  // tDef returns null (so the tooltip is simply not drawn) and the build script
  // reports full coverage for questions, options, tooltips, skills, UI wording,
  // section titles and the homepage.
  const LANG_KEY = "sault_lang_v1";
  let lang = "en";

  function i18n() { return (window.I18N && window.I18N) || null; }
  function dict() {
    const I = i18n();
    if (!I || lang === "en") return null;
    return (I.dicts && I.dicts[lang]) || null;
  }
  function isRTL() {
    const I = i18n();
    return !!(I && Array.isArray(I.RTL) && I.RTL.indexOf(lang) >= 0);
  }

  function tQ(key, english) { const d = dict(); return (d && d.q && d.q[key]) || english; }
  function tHelp(id, english) { const d = dict(); return (d && d.help && d.help[id]) || english; }
  // null rather than English: an untranslated tooltip is better withheld than shown in English
  function tDef(term, english) {
    const d = dict();
    if (!d) return english;
    return (d.def && d.def[term]) || null;
  }
  function S(text) { const d = dict(); return (d && d.ui && d.ui[text]) || text; }
  function tSection(name) { const d = dict(); return (d && d.sections && d.sections[name]) || S(name); }
  function optLabel(q, v) { const d = dict(); return (d && d.o && d.o[v]) || v; }

  // Language picker: the header pill IS the control. Clicking it opens the list
  // of nine languages directly beneath it — no intermediate card and no second
  // panel to pick from. The pill's own wording follows the selected language, so
  // it is translated and always shows the language now in use. The choice is
  // sticky per browser and applies to the whole page — survey, homepage and
  // letter — immediately, without a reload.
  function langList() {
    const I = i18n();
    return (I && I.LANGS) || ["en"];
  }
  function nativeName(code) {
    const I = i18n();
    return (I && I.NATIVE_NAMES && I.NATIVE_NAMES[code]) || code;
  }

  // The pill reads "Select language" until the visitor has chosen one; after
  // that it shows only the language's own name — no "Select language ·" prefix,
  // so the header states which language is in use and nothing more.
  function syncLangButton() {
    const btn = $("#lang-btn");
    if (!btn) return;
    const chosen = sGet(LANG_KEY);
    const name = nativeName(lang);
    btn.textContent = chosen ? name : S("Select language");
    btn.setAttribute("aria-label", S("Select language") + ": " + name);
    btn.setAttribute("lang", lang);
    btn.setAttribute("aria-expanded", langMenuOpen() ? "true" : "false");
  }

  // Static wording in index.html has no render pass, so it is set here.
  function applyStaticText() {
    const h1 = $("#home-h1");
    if (h1) { const d = dict(); h1.textContent = (d && d.home && d.home.h1) || "Sault Newcomer Survey 2026"; }
    const start = $("#start-btn");
    if (start) start.innerHTML = esc(S("Start the survey")) + ' <span aria-hidden="true">→</span>';
    const map = $(".hero-map img");
    if (map) map.setAttribute("alt", S("Illustrated map of Northern Ontario with Sault Ste. Marie marked near the Great Lakes"));
    const loc = $(".map-location-label");
    if (loc) loc.textContent = S("Sault Ste. Marie");
  }

  // ── The language list ────────────────────────────────────────────────────
  // A menu of the nine native names, opened in place under the pill. Picking one
  // applies it at once and closes the list; Escape or a click elsewhere closes it
  // without changing anything.
  function langMenuOpen() { return !!$(".lang-menu"); }

  function onLangOutside(e) {
    const t = e && e.target;
    if (!t || !t.closest || !t.closest(".lang-picker")) closeLangMenu();
  }
  function onLangEscape(e) {
    if (e && e.key === "Escape") {
      closeLangMenu();
      const btn = $("#lang-btn");
      if (btn) btn.focus();
    }
  }

  function closeLangMenu() {
    const menu = $(".lang-menu");
    if (menu) menu.remove();
    const btn = $("#lang-btn");
    if (btn) btn.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", onLangOutside);
    document.removeEventListener("keydown", onLangEscape);
  }

  function toggleLangMenu() {
    if (langMenuOpen()) { closeLangMenu(); return; }
    const host = $("#lang-picker") || $("#lang-btn");
    if (!host) return;
    const menu = el("div", "lang-menu");
    menu.setAttribute("role", "listbox");
    menu.setAttribute("aria-label", S("Select language"));
    langList().forEach((code) => {
      const item = el("button", "lang-item" + (code === lang ? " is-current" : ""), esc(nativeName(code)));
      item.type = "button";
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", code === lang ? "true" : "false");
      item.setAttribute("lang", code);
      item.onclick = () => { closeLangMenu(); setLanguage(code); };
      menu.appendChild(item);
    });
    host.appendChild(menu);
    const btn = $("#lang-btn");
    if (btn) btn.setAttribute("aria-expanded", "true");
    document.addEventListener("click", onLangOutside);
    document.addEventListener("keydown", onLangEscape);
  }

  function setLanguage(code) {
    const I = i18n();
    if (!I || code === "en") code = "en";
    else if (!I.dicts || !I.dicts[code]) code = "en";
    lang = code;
    sSet(LANG_KEY, code);
    const root = document.documentElement;
    root.setAttribute("lang", code);
    root.setAttribute("dir", isRTL() ? "rtl" : "ltr");
    applyStaticText();
    applyHomeVariant(); // homepage copy + impression count stay in step
    syncLangButton();
    if (answers && answers.consent !== undefined || currentId) renderSurvey();
  }

  function restoreLanguage() {
    const saved = sGet(LANG_KEY);
    const I = i18n();
    const code = saved && I && I.dicts && I.dicts[saved] ? saved : "en";
    lang = code;
    document.documentElement.setAttribute("lang", code);
    document.documentElement.setAttribute("dir", isRTL() ? "rtl" : "ltr");
    applyStaticText();
    syncLangButton();
  }

  // ── Text-to-speech (read-aloud) ──────────────────────────────────────────
  // A 🔊 button reads the displayed text aloud. It prefers a pre-generated audio
  // clip (Phase 2: /audio/manifest.json, keyed "<bucket>/<key>") for consistent,
  // device-independent quality; if no clip exists it falls back to the browser's
  // own voice (Phase 1). The button is hidden only when NEITHER is available, so
  // it never fails silently. The manifest is absent until audio is generated, in
  // which case every string simply uses the device voice — today's behaviour.
  let _audioManifest = {};
  fetch("/audio/manifest.json").then((r) => (r.ok ? r.json() : {})).then((m) => { _audioManifest = m || {}; }).catch(() => {});
  function clipFor(code, ref) {
    if (!ref) return null;
    const m = _audioManifest[code];
    return m && m[ref] ? "/" + String(m[ref]).replace(/^\//, "") : null;
  }
  const SPEAK_SVG =
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/>' +
    '<path d="M16 8.5a4 4 0 010 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
    '<path d="M18.5 6a7 7 0 010 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" class="speak-wave2"/></svg>';
  // Our 2-letter code → a reasonable BCP-47 tag when no exact voice is matched.
  const TTS_LANG = {
    en: "en-US", fr: "fr-FR", es: "es-ES", pt: "pt-BR", it: "it-IT", de: "de-DE",
    pl: "pl-PL", uk: "uk-UA", fi: "fi-FI", tl: "fil-PH", hi: "hi-IN", bn: "bn-BD",
    pa: "pa-IN", gu: "gu-IN", ta: "ta-IN", ml: "ml-IN", zh: "zh-CN", ar: "ar-SA",
    ur: "ur-PK", ku: "ku",
  };
  const TTS_ALIAS = { tl: ["tl", "fil"] }; // Tagalog voices report as "fil-*"
  const tts = window.speechSynthesis || null;
  let _voices = [];
  function loadVoices() { if (tts) _voices = tts.getVoices() || []; }
  if (tts) { loadVoices(); try { tts.addEventListener("voiceschanged", loadVoices); } catch (_) {} }
  function voiceFor(code) {
    if (!tts) return null;
    const bases = TTS_ALIAS[code] || [code];
    return _voices.find((v) => bases.includes((v.lang || "").toLowerCase().replace("_", "-").split("-")[0])) || null;
  }
  // Available if a pre-generated clip exists, or a device voice does. Before the
  // voice list has loaded, be optimistic (most devices have their UI-language voice).
  function ttsAvailable(code, ref) {
    if (clipFor(code, ref)) return true;
    return !!tts && (_voices.length === 0 || !!voiceFor(code));
  }
  let _speakingBtn = null, _audioEl = null;
  function markStart(btn) { if (btn) { btn.classList.add("speaking"); _speakingBtn = btn; } }
  function markEnd(btn) { if (btn) btn.classList.remove("speaking"); if (_speakingBtn === btn) _speakingBtn = null; }
  function stopSpeak() {
    if (tts) tts.cancel();
    if (_audioEl) { try { _audioEl.pause(); } catch (_) {} _audioEl = null; }
    if (_speakingBtn) { _speakingBtn.classList.remove("speaking"); _speakingBtn = null; }
  }
  function webSpeak(text, code, btn) {
    if (!tts || !text) return;
    const u = new SpeechSynthesisUtterance(text);
    const v = voiceFor(code);
    u.lang = (v && v.lang) || TTS_LANG[code] || code;
    if (v) u.voice = v;
    u.rate = 0.95;
    u.onend = u.onerror = () => markEnd(btn);
    markStart(btn);
    tts.speak(u);
  }
  function speak(text, code, btn, ref) {
    if (_speakingBtn === btn) { stopSpeak(); return; } // click again = stop
    stopSpeak();
    const url = clipFor(code, ref);
    if (url) {
      const a = new Audio(url);
      _audioEl = a;
      markStart(btn);
      a.onended = () => markEnd(btn);
      a.onerror = () => { markEnd(btn); if (_audioEl === a) _audioEl = null; webSpeak(text, code, btn); };
      a.play().catch(() => { if (_audioEl === a) _audioEl = null; markEnd(btn); webSpeak(text, code, btn); });
      return;
    }
    webSpeak(text, code, btn);
  }
  // A speaker control that reads `text` in `code`. `ref` ("<bucket>/<key>") points
  // at a pre-generated clip when one exists. A <span role=button> (not a <button>)
  // so it can live safely inside the option <button> without nesting. Returns null
  // when neither a clip nor a device voice is available, so callers can skip it.
  function speakBtn(text, code, cls, ref) {
    if (!ttsAvailable(code, ref) || !text) return null;
    const b = el("span", "speak-btn" + (cls ? " " + cls : ""), SPEAK_SVG);
    b.setAttribute("role", "button");
    b.setAttribute("tabindex", "0");
    b.setAttribute("aria-label", S("Listen"));
    b.title = S("Listen");
    const fire = (e) => { e.stopPropagation(); e.preventDefault(); speak(text, code, b, ref); };
    b.addEventListener("click", fire);
    b.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") fire(e); });
    return b;
  }
  // Every speaker is built with the language on screen, never a fixed one. The
  // clip ref is keyed by the English option string in every language bucket, so a
  // fixed English code found the English recording while the label was translated.
  // The question, option, list and skill speakers all pass `lang`.

  // ── Motivation-card experiment (HP2 arm only) ────────────────────────────
  // From the first survey question onward (not consent or eligibility), each
  // question runs a 12s buffer. If the
  // respondent lingers ≥12s, a motivation card appears (middle-right on desktop,
  // bottom on mobile) and stays until they advance. It appears at most TWICE per
  // respondent. A single per-respondent signal (the existing column) records the
  // outcome:  0 = never shown;  1 = shown once and continued;  2 = shown twice and
  // continued both times;  -1 = shown but the respondent did not move forward.
  const MOTIV_TEXT = "During the pre-test, 80% of participants recommended completing the survey. We encourage you to continue and complete the survey as well.";
  const MOTIV_DELAY = 12000;
  const MOTIV_MAX = 2;
  // Master on/off switch for the motivation card. Set to false to temporarily
  // hide the card everywhere without removing any of the logic below; set it
  // back to true to re-enable. All other behaviour (timing, cap, signals) is
  // untouched.
  const MOTIV_ENABLED = false;
  let motivShown = 0;      // times the card has appeared this survey (cap MOTIV_MAX)
  let motivContinues = 0;  // times the card appeared AND the respondent continued (→ 1/2)
  const isHP2 = () => homeVariant === "HP2";
  // Allowed from the first real question ("Where have you moved from?") onward;
  // excludes consent, the eligibility gate, and the final gift-card/submit page
  // (no "next question" to advance to there).
  const cardEligible = (q) => !!q && q.id !== "consent" && q.id !== "eligible" && q.id !== "gift_card_draw";
  function recordSignal(value, viaBeacon) {
    if (!respondentId) return;
    const body = JSON.stringify({ respondent_id: respondentId, signal: value });
    if (viaBeacon && navigator.sendBeacon) {
      try { navigator.sendBeacon("/api/signal", new Blob([body], { type: "application/json" })); } catch (_) {}
    } else {
      fetch("/api/signal", { method: "POST", headers: { "Content-Type": "application/json" }, body: body, keepalive: true }).catch(() => {});
    }
  }
  function showMotivationCard() {
    if (document.getElementById("motiv-card")) return;
    const c = el("div", "motiv-card");
    c.id = "motiv-card";
    c.setAttribute("role", "status");
    const star = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2.5l2.6 5.9 6.4.6-4.8 4.3 1.4 6.3L12 16.9 6.0 19.9l1.4-6.3L2.6 9l6.4-.6L12 2.5z" fill="currentColor"/></svg>';
    c.innerHTML = `<span class="motiv-icon" aria-hidden="true">${star + star + star}</span><p>${esc(MOTIV_TEXT)}</p>`;
    document.body.appendChild(c);
    requestAnimationFrame(() => c.classList.add("in"));
  }
  function removeMotivationCard() { const c = document.getElementById("motiv-card"); if (c) c.remove(); }
  function startMotivation(q) {
    motiv = { qid: q.id, timerId: null, shown: false, finalized: false };
    motiv.timerId = setTimeout(() => {
      if (motiv && !motiv.finalized && motivShown < MOTIV_MAX) { motivShown++; motiv.shown = true; showMotivationCard(); }
    }, MOTIV_DELAY);
  }
  // reason "advance" = moved to another question; "abandon" = page unload.
  function finalizeMotivation(reason) {
    if (!motiv || motiv.finalized) return;
    motiv.finalized = true;
    if (motiv.timerId) clearTimeout(motiv.timerId);
    if (motiv.shown) {
      if (reason === "advance") { motivContinues++; recordSignal(motivContinues, false); } // 1, then 2
      else if (reason === "abandon") recordSignal(-1, true);                                 // did not move forward
    }
    removeMotivationCard();
  }
  function resetMotivation() { motivShown = 0; motivContinues = 0; motiv = null; removeMotivationCard(); }
  // capture "shown but did not move forward" before the tab closes
  window.addEventListener("pagehide", () => finalizeMotivation("abandon"));

  // ── scroll-edge shadow on the answer list ────────────────────
  // The answer list scrolls without a scrollbar (see "no scrollbar" in app.css),
  // and it ends with the Next arrow, which a long list pushes past the fold. The
  // soft shadow at its bottom edge is therefore the only sign that more answers
  // are there, so it is computed from the real metrics rather than left on: a
  // list that fits shows nothing, and the arrows are never shadowed once they
  // are in view.
  let scrollEdgeWatchers = [];
  function watchScrollEdges(box) {
    const update = () => {
      if (!box.isConnected) return false;
      box.classList.toggle("has-more-below",
        box.scrollHeight - box.scrollTop - box.clientHeight > 2);
      return true;
    };
    box.addEventListener("scroll", update, { passive: true });
    scrollEdgeWatchers.push(update);
    update();
    return update;
  }
  // A resize changes how many rows fit, and a re-render drops the previous
  // region; both are handled by re-running every watcher and dropping the ones
  // whose element has left the document.
  function refreshScrollEdges() {
    scrollEdgeWatchers = scrollEdgeWatchers.filter((update) => update() !== false);
  }
  window.addEventListener("resize", refreshScrollEdges, { passive: true });

  // ── survey rendering ───────────────────────────────────────
  function renderSurvey() {
    const root = $("#survey-root");
    root.innerHTML = "";
    closeInfoCard(); // a re-render means we moved on; never leave the card behind
    stopSpeak(); // don't keep reading the previous question aloud
    refreshScrollEdges(); // drop the watcher of the region this render replaces

    // a personal-invite link that's already been completed cannot be retaken
    if (inviteCompleted) { root.appendChild(inviteCompletedState()); return; }

    // consent / ineligible gates
    if (answers.consent === "No, I do not confirm") { root.appendChild(consentDeclinedState()); return; }
    if (answers.eligible === "No") { root.appendChild(ineligibleState()); return; }

    const list = visibleList();
    const pos = posOf(currentId);
    const q = list[pos];
    if (!q) { go("#/"); return; }
    if (q.type !== "rating") ratingStepQ = null; // recompute step fresh on re-entry

    // Timing: a different question closes the previous one; a re-render of the
    // same question (rating sub-pages, info card) keeps its clock running.
    timing.enter(q.id);

    // Motivation-card experiment: on changing to a different question, finalize the
    // one we left (signal 0/1), then start a fresh 12s buffer if this is a card arm +
    // eligible question. Same-question re-renders (e.g. rating sub-pages) keep it.
    if (!motiv || motiv.qid !== q.id) {
      if (motiv) finalizeMotivation("advance");
      motiv = null;
      removeMotivationCard();
      if (MOTIV_ENABLED && isHP2() && cardEligible(q) && motivShown < MOTIV_MAX) startMotivation(q);
    }

    // Compact respondent progress
    const total = list.length;
    const progress = Math.round(((pos + 1) / total) * 100);
    const prog = el("div", "progress-card");
    prog.innerHTML = `
      <div class="progress-top">
        <span class="progress-count">${pos + 1}</span>
      </div>
      <div class="progress-bar-row">
        <div class="progress-track" aria-label="${progress}${esc(S("% complete"))}">
          <span style="width:${progress}%"></span>
        </div>
        <span class="progress-trophy${progress >= 100 ? " done" : ""}" title="${esc(S("Finish to become a Survey Champion"))}">${TROPHY_SVG}</span>
      </div>`;
    root.appendChild(prog);

    // question block — split in two: the heading stays put, the answer block
    // scrolls on its own, so a long option list cannot drag the question or the
    // progress bar off screen (see "pinned question layout" in app.css).
    const block = el("div", "q-block");
    const head = el("div", "q-head");
    const qEnglish = typeof q.text === "function" ? q.text(answers) : q.text;
    const qKey = typeof q.textKey === "function" ? q.textKey(answers) : q.id;
    const qText = tQ(qKey, qEnglish);
    const hasLinks = MD_LINK.test(qText); MD_LINK.lastIndex = 0;
    const qh = el("h2", "q-text", hasLinks ? mdLinks(qText) : esc(qText));
    // read-aloud uses the plain text (link labels only, no URLs)
    const qSpeak = speakBtn(hasLinks ? stripMd(qText) : qText, lang, "q-speak", "q/" + qKey);
    if (qSpeak) qh.appendChild(qSpeak);
    head.appendChild(qh);
    if (q.help) head.appendChild(el("p", "q-help", esc(tHelp(q.id, q.help))));
    // channel-aware privacy note on the consent step (draft wording — confirm with REB).
    // Only the invitation-link case has a note: the plain "Your responses are
    // anonymous." line was removed on the client's instruction, so a respondent
    // who arrives without an invitation now sees the consent prompt alone.
    if (q.id === "consent" && inviteToken) {
      head.appendChild(el("p", "consent-privacy",
        S("You opened a personal invitation link, so your completion may be recorded for reminder purposes. Your responses are kept confidential and analyzed in de-identified form.")));
    }
    block.appendChild(head);
    const scroller = el("div", "q-scroll");
    scroller.appendChild(renderControl(q));
    block.appendChild(scroller);
    root.appendChild(block);

    // nav
    if (pos === total - 1) {
      // Final page: no arrows — a CAPTCHA gate plus an explicit Submit button.
      root.appendChild(renderSubmitNav(q));
    } else {
      const nav = el("div", "q-nav");
      // The arrows go INSIDE the scrolling answer region, after the last option,
      // so they sit directly under it instead of being pinned to the bottom of
      // the screen. Outside the region the block stretched to fill the viewport
      // and pushed them down, leaving a large empty gap under a short list (197px
      // on a 390x640 phone with two options). Inside, the gap is the row spacing
      // no matter how long the list is. See "arrows follow the answers" in app.css.
      const back = el("button", "btn btn-nav-arrow", NAV_ARROW_SVG);
      back.setAttribute("aria-label", S("Previous question"));
      back.title = S("Previous question");
      back.disabled = pos === 0;
      back.onclick = () => { const l = visibleList(); const p = posOf(currentId); if (p > 0) { currentId = l[p - 1].id; saveDraft(); renderSurvey(); } };
      const next = el("button", "btn btn-nav-arrow is-next", NAV_ARROW_SVG);
      next.setAttribute("aria-label", S("Next question"));
      next.title = S("Next question");
      next.id = "btn-next";
      next.disabled = mustAnswer(q) && !isAnswered(q);
      next.onclick = () => advance(q);
      // For the skills rating (shown 5 at a time), the bottom arrows step by page:
      // ← = previous 5 (or previous question on the first page), → = next 5 once complete.
      if (q.type === "rating" && skillsOf(q).length) {
        const pages = ratePageCount(q);
        const page = Math.min(ratingStep, pages - 1);
        back.disabled = pos === 0 && page === 0;
        back.onclick = () => {
          if (ratingStep > 0) { ratingStep--; renderSurvey(); }
          else { const l = visibleList(); const p = posOf(currentId); if (p > 0) { currentId = l[p - 1].id; saveDraft(); renderSurvey(); } }
        };
        next.disabled = mustAnswer(q) && !pageComplete(q, page);
        next.onclick = () => advanceRatingPage(q);
        next.title = page < pages - 1 ? S("Next 5 skills") : S("Next question");
      }
      nav.appendChild(back);
      nav.appendChild(el("span", "q-nav-spacer"));
      nav.appendChild(next);
      // inside the answer region, directly under the last option
      scroller.appendChild(nav);
    }

    // the region is complete now, so its scroll metrics are final
    watchScrollEdges(scroller);
  }

  // Final page: subtle Back link, Turnstile CAPTCHA, and a Submit button that
  // stays disabled until the CAPTCHA is solved (the final question is optional).
  function renderSubmitNav(q) {
    const wrap = el("div", "submit-area");

    const back = el("button", "btn-back-link", "← " + S("Back"));
    back.onclick = () => { const l = visibleList(); const p = posOf(currentId); if (p > 0) { currentId = l[p - 1].id; saveDraft(); renderSurvey(); } };
    wrap.appendChild(back);

    const capWrap = el("div", "captcha-wrap");
    const capBox = el("div", "cf-turnstile-box");
    capWrap.appendChild(capBox);
    wrap.appendChild(capWrap);

    const submitBtn = el("button", "btn btn-submit", S("Submit"));
    submitBtn.id = "btn-submit";
    submitBtn.disabled = !(captchaToken && (!mustAnswer(q) || isAnswered(q)));
    submitBtn.onclick = () => { if (!submitBtn.disabled) submit(); };
    wrap.appendChild(submitBtn);

    captchaToken = null; // fresh challenge whenever this page (re)renders
    requestAnimationFrame(() => mountTurnstile(capBox, () => updateNav(q)));
    return wrap;
  }

  function updateNav(q) {
    const b = $("#btn-next"); if (b) b.disabled = mustAnswer(q) && !isAnswered(q);
    const s = $("#btn-submit"); if (s) s.disabled = !(captchaToken && (!mustAnswer(q) || isAnswered(q)));
  }

  // ── Cloudflare Turnstile loader / mount ────────────────────
  function loadTurnstile(cb) {
    if (window.turnstile) { cb(); return; }
    const existing = document.getElementById("cf-turnstile-js");
    if (existing) { existing.addEventListener("load", cb); return; }
    const s = document.createElement("script");
    s.id = "cf-turnstile-js";
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true; s.defer = true;
    s.onload = cb;
    document.head.appendChild(s);
  }
  function mountTurnstile(box, onChange) {
    loadTurnstile(() => {
      if (!window.turnstile || !document.body.contains(box)) return;
      if (turnstileWidgetId !== null) { try { window.turnstile.remove(turnstileWidgetId); } catch (e) {} turnstileWidgetId = null; }
      try {
        turnstileWidgetId = window.turnstile.render(box, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: "light",
          callback: (tok) => { captchaToken = tok; onChange(); },
          "expired-callback": () => { captchaToken = null; onChange(); },
          "error-callback": () => { captchaToken = null; onChange(); },
        });
      } catch (e) {}
    });
  }

  function advance(q) {
    if (mustAnswer(q) && !isAnswered(q)) return;
    if (q.id === "consent" && answers.consent === "No, I do not confirm") { saveDraft(); renderSurvey(); return; }
    if (q.id === "eligible" && answers.eligible === "No") { saveDraft(); renderSurvey(); return; }
    const list = visibleList();
    const pos = posOf(currentId);
    if (pos >= list.length - 1) { submit(); return; }
    currentId = list[pos + 1].id; saveDraft(); renderSurvey();
  }

  // ── controls ───────────────────────────────────────────────
  function renderControl(q) {
    if (q.id === "gift_card_draw") return giftCardControl(q);
    if (q.type === "single" || q.type === "eligibility") return optionList(q, false);
    if (q.type === "multi") return optionList(q, true);
    if (q.type === "select") return selectControl(q);
    if (q.type === "picklist") return picklistControl(q);
    if (q.type === "text") return textControl(q);
    if (q.type === "textarea") return textareaControl(q);
    if (q.type === "rating") return ratingControl(q);
    if (q.type === "contact") return contactControl(q);
    return el("div");
  }

  // ── option definition tooltips ─────────────────────────────
  // The tip opens upward by default (bottom: calc(100% + 8px)), but the answers
  // live in .q-scroll, a clipped scroll box with no padding at the top. For a row
  // at the top of that box — always the first option, and any row scrolled up
  // there — the tip lands above the box and is clipped away, so hovering shows
  // nothing at all. Open it on whichever side the region has room for, measured
  // before the hover rule reveals it. Inline offsets are used so the stylesheet
  // keeps its single default.
  function placeTip(help) {
    const tip = help.querySelector(".opt-tip");
    if (!tip) return;
    const region = help.closest(".q-scroll");
    const box = region ? region.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    // start from the default: above the row
    tip.style.top = "auto";
    tip.style.bottom = "calc(100% + 8px)";
    const above = tip.getBoundingClientRect();
    const clippedAbove = box.top - above.top; // positive when it pokes past the top
    if (clippedAbove <= 0) return; // it fits above; nothing to do
    // no room above: open downward instead
    tip.style.bottom = "auto";
    tip.style.top = "calc(100% + 8px)";
    const below = tip.getBoundingClientRect();
    const clippedBelow = below.bottom - box.bottom; // positive when it pokes past the bottom
    if (clippedBelow > clippedAbove) {
      // too tall for either side; keep the one that loses less
      tip.style.top = "auto";
      tip.style.bottom = "calc(100% + 8px)";
    }
  }

  function optionList(q, multi) {
    const wrap = el("div", "options");
    const keys = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const defs = (window.SURVEY && window.SURVEY.DEFINITIONS) || {};
    q.options.forEach((opt, i) => {
      const sel = multi ? (answers[q.id] || []).includes(opt) : answers[q.id] === opt;
      const btn = el("button", "opt" + (multi ? " multi" : "") + (sel ? " on" : ""));
      const def = defs[opt] ? tDef(opt, defs[opt]) : null;
      const help = def
        ? ` <span class="opt-help" role="button" tabindex="0" aria-label="${esc(S("Definition:"))} ${esc(def)}"><span class="opt-help-icon" aria-hidden="true">?</span><span class="opt-tip" role="tooltip">${esc(def)}</span></span>`
        : "";
      btn.innerHTML = `<span class="opt-mark"></span><span class="opt-label">${esc(optLabel(q, opt))}${help}</span><span class="opt-key">${keys[i] || ""}</span>`;
      const optSpeak = speakBtn(optLabel(q, opt), lang, "opt-speak", "o/" + opt);
      if (optSpeak) btn.insertBefore(optSpeak, btn.querySelector(".opt-key"));
      if (def) {
        const h = btn.querySelector(".opt-help");
        // pick the side with room before the hover rule reveals the tip
        h.addEventListener("mouseenter", () => placeTip(h));
        h.addEventListener("focus", () => placeTip(h));
        const toggleTip = (e) => { e.stopPropagation(); e.preventDefault(); placeTip(h); h.classList.toggle("tip-open"); };
        h.addEventListener("click", toggleTip);
        h.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") toggleTip(e); });
      }
      btn.onclick = () => {
        if (multi) {
          const cur = new Set(answers[q.id] || []);
          if (q.exclusiveOption && opt === q.exclusiveOption) {
            cur.clear();
            cur.add(opt);
          } else {
            cur.delete(q.exclusiveOption);
            cur.has(opt) ? cur.delete(opt) : cur.add(opt);
          }
          answers[q.id] = [...cur];
          wrap.querySelectorAll(".opt").forEach((o, optionIndex) => {
            o.classList.toggle("on", cur.has(q.options[optionIndex]));
          });
          updateNav(q); saveDraft();
        } else {
          answers[q.id] = opt;
          wrap.querySelectorAll(".opt").forEach((o) => o.classList.remove("on"));
          btn.classList.add("on");
          updateNav(q); saveDraft();
        }
      };
      wrap.appendChild(btn);
    });
    return wrap;
  }

  // The answer block scrolls on its own (see "pinned question layout" in
  // app.css), so a dropdown that opens inside it is clipped by that region:
  // on a short screen most of the list would be invisible and unreachable.
  // Cap the open menu to the room actually left below its trigger, and let the
  // inner list scroll in what remains. Outside the survey (e.g. admin preview)
  // there is no region and this does nothing.
  function fitMenuToRegion(sw, menu) {
    const region = typeof sw.closest === "function" ? sw.closest(".q-scroll") : null;
    // the test DOM has no layout: nothing to measure there
    if (!region || typeof region.getBoundingClientRect !== "function" || typeof menu.getBoundingClientRect !== "function") return;
    menu.style.maxHeight = "";
    const list = menu.querySelector(".custom-select-list");
    if (list) list.style.maxHeight = "";
    // bring the control into view first, so a region that was scrolled leaves
    // the whole menu as much room as it can
    if (typeof sw.scrollIntoView === "function") sw.scrollIntoView({ block: "nearest" });
    const room = Math.round(region.getBoundingClientRect().bottom - menu.getBoundingClientRect().top - 6);
    if (room <= 0) return;
    if (list) {
      // everything in the menu that is not the scrolling list: filter box + padding
      const chrome = Math.max(0, Math.round(menu.getBoundingClientRect().height - list.getBoundingClientRect().height));
      list.style.maxHeight = Math.max(24, room - chrome) + "px";
    }
    menu.style.maxHeight = room + "px";
  }

  // Searchable dropdown for long option lists (e.g. the 516 NOC occupations).
  // Reuses the .custom-select look; adds a filter input and caps rendered rows.
  function picklistControl(q) {
    const field = el("div", "field");
    if (q.label) field.appendChild(el("label", "field-lbl", esc(S(q.label))));
    const sw = el("div", "custom-select");
    const trigger = el("button", "custom-select-trigger");
    trigger.type = "button";
    const placeholder = S(q.placeholder || "Type to search…");
    trigger.innerHTML = `<span>${esc(answers[q.id] ? optLabel(q, answers[q.id]) : placeholder)}</span><span class="custom-select-caret">▾</span>`;
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");

    const menu = el("div", "custom-select-menu has-search");
    menu.setAttribute("role", "listbox");
    const search = el("input", "custom-select-search");
    search.type = "text";
    search.placeholder = placeholder;
    const listWrap = el("div", "custom-select-list");
    menu.appendChild(search);
    menu.appendChild(listWrap);

    const opts = typeof q.options === "function" ? q.options(answers) : q.options;
    const CAP = 50;

    function renderList() {
      listWrap.innerHTML = "";
      const f = search.value.trim().toLowerCase();
      const matches = f ? opts.filter((o) => o.toLowerCase().includes(f) || optLabel(q, o).toLowerCase().includes(f)) : opts;
      matches.slice(0, CAP).forEach((option) => {
        const disp = optLabel(q, option);
        const item = el("button", "custom-select-option" + (answers[q.id] === option ? " on" : ""), `<span class="cso-label">${esc(disp)}</span>`);
        item.type = "button";
        item.setAttribute("role", "option");
        const sp = speakBtn(disp, lang, "cso-speak", "o/" + option);
        if (sp) item.appendChild(sp);
        item.onclick = () => {
          answers[q.id] = option;
          trigger.querySelector("span").textContent = optLabel(q, option);
          sw.classList.remove("open");
          trigger.setAttribute("aria-expanded", "false");
          updateNav(q);
          saveDraft();
          trigger.focus();
        };
        listWrap.appendChild(item);
      });
      if (!matches.length) listWrap.appendChild(el("div", "custom-select-empty", S("No matches")));
      else if (matches.length > CAP) listWrap.appendChild(el("div", "custom-select-empty", `+${matches.length - CAP} ` + S("more — keep typing to narrow")));
    }
    search.oninput = renderList;

    trigger.onclick = () => {
      const open = !sw.classList.contains("open");
      sw.classList.toggle("open", open);
      trigger.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) { renderList(); fitMenuToRegion(sw, menu); setTimeout(() => search.focus(), 0); }
    };
    trigger.onkeydown = (event) => {
      if (event.key === "Escape") { sw.classList.remove("open"); trigger.setAttribute("aria-expanded", "false"); }
    };

    sw.appendChild(trigger);
    sw.appendChild(menu);
    field.appendChild(sw);
    return field;
  }

  function selectControl(q) {
    const field = el("div", "field");
    if (q.label) field.appendChild(el("label", "field-lbl", esc(S(q.label))));
    const sw = el("div", "custom-select");
    const trigger = el("button", "custom-select-trigger");
    trigger.type = "button";
    trigger.innerHTML = `<span>${esc(answers[q.id] ? optLabel(q, answers[q.id]) : S(q.placeholder || "Select one…"))}</span><span class="custom-select-caret">▾</span>`;
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");

    const menu = el("div", "custom-select-menu");
    menu.setAttribute("role", "listbox");
    const opts = typeof q.options === "function" ? q.options(answers) : q.options;
    opts.forEach((option) => {
      const disp = optLabel(q, option);
      const item = el("button", "custom-select-option" + (answers[q.id] === option ? " on" : ""), `<span class="cso-label">${esc(disp)}</span>`);
      item.type = "button";
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", answers[q.id] === option ? "true" : "false");
      const sp = speakBtn(disp, lang, "cso-speak", "o/" + option);
      if (sp) item.appendChild(sp);
      item.onclick = () => {
        answers[q.id] = option;
        trigger.querySelector("span").textContent = optLabel(q, option);
        menu.querySelectorAll(".custom-select-option").forEach((node) => {
          const selected = node === item;
          node.classList.toggle("on", selected);
          node.setAttribute("aria-selected", selected ? "true" : "false");
        });
        sw.classList.remove("open");
        trigger.setAttribute("aria-expanded", "false");
        updateNav(q);
        saveDraft();
        trigger.focus();
      };
      menu.appendChild(item);
    });

    trigger.onclick = () => {
      const open = !sw.classList.contains("open");
      sw.classList.toggle("open", open);
      trigger.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) fitMenuToRegion(sw, menu);
    };
    trigger.onkeydown = (event) => {
      if (event.key === "Escape") {
        sw.classList.remove("open");
        trigger.setAttribute("aria-expanded", "false");
      }
    };

    sw.appendChild(trigger);
    sw.appendChild(menu);
    field.appendChild(sw);
    return field;
  }

  function textControl(q) {
    const field = el("div", "field");
    if (q.label) field.appendChild(el("label", "field-lbl", esc(S(q.label))));
    const inp = el("input", "input");
    inp.type = "text";
    inp.placeholder = q.placeholder ? S(q.placeholder) : "";
    inp.value = answers[q.id] || "";
    inp.oninput = () => { answers[q.id] = inp.value; updateNav(q); saveDraft(); };
    field.appendChild(inp);
    return field;
  }

  function textareaControl(q) {
    const field = el("div", "field");
    field.style.maxWidth = "100%";
    if (q.label) field.appendChild(el("label", "field-lbl", esc(S(q.label))));
    const ta = el("textarea", "input");
    ta.placeholder = q.placeholder ? S(q.placeholder) : "";
    ta.value = answers[q.id] || "";
    ta.oninput = () => {
      answers[q.id] = ta.value;
      updateNav(q);
      saveDraft();
    };
    field.appendChild(ta);
    return field;
  }

  const RATE_PAGE = 5; // skills shown per page
  function skillsOf(q) { return typeof q.skills === "function" ? q.skills(answers) : q.skills; }
  function ratePageCount(q) { return Math.max(1, Math.ceil(skillsOf(q).length / RATE_PAGE)); }
  function pageComplete(q, page) {
    const v = answers[q.id] || {};
    return skillsOf(q).slice(page * RATE_PAGE, page * RATE_PAGE + RATE_PAGE).every(([k]) => v[k] != null);
  }
  function firstUnratedPage(q) {
    const v = answers[q.id] || {};
    const idx = skillsOf(q).findIndex(([k]) => v[k] == null);
    return idx < 0 ? 0 : Math.floor(idx / RATE_PAGE);
  }
  function advanceRatingPage(q) {
    if (ratingStep < ratePageCount(q) - 1) { ratingStep++; renderSurvey(); }
    else advance(q); // last page complete → move to the next survey question
  }

  // Skills shown 5 at a time (same row style). When all 5 on a page are rated it
  // auto-advances to the next 5; a small "1–5/10" range indicator shows the page.
  function ratingControl(q) {
    const v = answers[q.id] || {};
    const list = skillsOf(q);
    if (!list.length) return el("div");
    if (ratingStepQ !== q.id) { ratingStepQ = q.id; ratingStep = firstUnratedPage(q); }
    if (ratingStep > ratePageCount(q) - 1) ratingStep = ratePageCount(q) - 1;
    const page = ratingStep;
    const start = page * RATE_PAGE;
    const slice = list.slice(start, start + RATE_PAGE);

    const wrap = el("div");

    // Skill names and definitions are looked up in the active language. A
    // language whose master lacks a definition shows no tooltip rather than
    // falling back to the English one.
    const skillDefs = (window.SURVEY && window.SURVEY.SKILL_DEFINITIONS) || {};
    const grid = el("div", "grid-rate");
    slice.forEach(([key, name, desc]) => {
      const row = el("div", "rate-row");
      const label = S(name);
      const def = skillDefs[name] ? tDef(name, skillDefs[name]) : null;
      const help = def
        ? ` <span class="opt-help" role="button" tabindex="0" aria-label="${esc(S("Definition:"))} ${esc(def)}"><span class="opt-help-icon" aria-hidden="true">?</span><span class="opt-tip" role="tooltip">${esc(def)}</span></span>`
        : "";
      const nameEl = el("div", "rate-name", (desc ? `${esc(label)}<span>${esc(S(desc))}</span>` : esc(label)) + help);
      // Read the skill name in the respondent's language.
      const skSpeak = speakBtn(label, lang, "opt-speak", "sk/" + name);
      if (skSpeak) nameEl.appendChild(skSpeak);
      if (def) {
        const h = nameEl.querySelector(".opt-help");
        // the rating rows sit in the same clipped region as the options
        h.addEventListener("mouseenter", () => placeTip(h));
        h.addEventListener("focus", () => placeTip(h));
        const toggleTip = (e) => { e.stopPropagation(); e.preventDefault(); placeTip(h); h.classList.toggle("tip-open"); };
        h.addEventListener("click", toggleTip);
        h.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") toggleTip(e); });
      }
      row.appendChild(nameEl);
      const scale = el("div", "rate-scale");
      [1, 2, 3, 4, 5, 0].forEach((n) => {
        const dot = el("button", "rate-dot" + (n === 0 ? " ns" : "") + (v[key] === n ? " on" : ""), String(n));
        if (n === 0) dot.title = S("Not sure");
        dot.onclick = () => {
          const before = pageComplete(q, page);
          answers[q.id] = answers[q.id] || {};
          answers[q.id][key] = n;
          scale.querySelectorAll(".rate-dot").forEach((d) => d.classList.remove("on"));
          dot.classList.add("on");
          saveDraft();
          const b = $("#btn-next"); if (b) b.disabled = mustAnswer(q) && !pageComplete(q, page);
          // Auto-advance to the NEXT page when this page completes. The final page does
          // NOT auto-advance — the user clicks Next, like every other question.
          const lastPage = page >= ratePageCount(q) - 1;
          if (!before && !lastPage && pageComplete(q, page)) setTimeout(() => advanceRatingPage(q), 280);
        };
        scale.appendChild(dot);
      });
      row.appendChild(scale);
      grid.appendChild(row);
    });
    wrap.appendChild(grid);

    // No end-point legend under the rows: the scale is spelled out in full in the
    // question's `help` line above them (v14 D_intro, "1 – I have no experience…0 –
    // Not Sure"), so a "1 · …  5 · …" row below the dots would restate it.
    return wrap;
  }

  function contactControl(q) {
    const c = answers.contact || { optin: false, email: "" };
    answers.contact = c;
    const wrap = el("div");
    const toggle = el("button", "optin" + (c.optin ? " on" : ""));
    toggle.innerHTML = `<span class="opt-mark"></span><span class="optin-text"><b>${esc(S("Yes, enter me in the gift-card draw"))}</b><span>${esc(S("Five $50 local gift cards drawn monthly"))}</span></span>`;
    const field = el("div", "field contact-field");
    field.style.marginTop = "4px";
    field.appendChild(el("label", "field-lbl", S("Email address")));
    const email = el("input", "input");
    email.type = "email";
    email.placeholder = "alice@gmail.com";
    email.value = c.email || "";
    email.disabled = !c.optin;
    email.style.opacity = c.optin ? "1" : "0.5";
    email.oninput = () => { c.email = email.value; updateNav(q); saveDraft(); };
    field.appendChild(email);
    toggle.onclick = () => {
      c.optin = !c.optin;
      toggle.classList.toggle("on");
      email.disabled = !c.optin;
      email.style.opacity = c.optin ? "1" : "0.5";
      if (c.optin) email.focus();
      updateNav(q); saveDraft();
    };
    wrap.appendChild(toggle);
    wrap.appendChild(field);
    return wrap;
  }

  function giftCardControl(q) {
    const wrap = el("div", "gift-card-control");
    wrap.appendChild(optionList(q, false));

    const field = el("div", "field gift-card-email");
    if (answers[q.id] !== "Yes") field.hidden = true;
    field.appendChild(el("label", "field-lbl", S("Email address")));
    const email = el("input", "input");
    email.type = "email";
    email.placeholder = "alice@gmail.com";
    email.value = answers.gift_card_email || "";
    email.oninput = () => {
      answers.gift_card_email = email.value;
      updateNav(q);
      saveDraft();
    };
    field.appendChild(email);
    field.appendChild(el("p", "field-note",
      S("Note: This information will be used only for the prize draw and will not be linked to your survey responses.")));
    wrap.appendChild(field);

    wrap.querySelectorAll(".opt").forEach((button, index) => {
      const option = q.options[index];
      button.addEventListener("click", () => {
        field.hidden = option !== "Yes";
        if (option === "Yes") setTimeout(() => email.focus(), 0);
      });
    });
    return wrap;
  }

  // ── states ─────────────────────────────────────────────────
  function consentDeclinedState() {
    const c = el("div", "state-card card");
    c.innerHTML = `
      <h2>${esc(S("Thank you for starting the survey."))}</h2>
      <p>${esc(S("Unfortunately we cannot proceed without your consent."))}</p>`;
    const actions = el("div", "actions");
    const back = el("button", "btn", "← " + S("Go back"));
    back.onclick = () => { answers.consent = null; currentId = "consent"; saveDraft(); renderSurvey(); };
    const home = el("button", "btn btn-ghost", S("Home"));
    home.onclick = () => go("#/");
    actions.appendChild(back);
    actions.appendChild(home);
    c.appendChild(actions);
    return c;
  }

  function ineligibleState() {
    const c = el("div", "state-card card");
    c.innerHTML = `
      <h2>${esc(S("Thank you for your interest."))}</h2>
      <p>${esc(S("Unfortunately you are not eligible to participate in the survey."))}</p>`;
    const actions = el("div", "actions");
    // Same behaviour as the consent-declined card: clear the answer and return to
    // the question, so a mis-tap is recoverable.
    const back = el("button", "btn", "← " + S("Go back"));
    back.onclick = () => { answers.eligible = null; currentId = "eligible"; saveDraft(); renderSurvey(); };
    const home = el("button", "btn btn-ghost", S("Home"));
    home.onclick = () => go("#/");
    actions.appendChild(back);
    actions.appendChild(home);
    c.appendChild(actions);
    return c;
  }


  function inviteCompletedState() {
    const c = el("div", "state-card card");
    c.innerHTML = `
      <h2>${esc(S("You've already completed this survey"))}</h2>
      <p>${esc(S("Thank you — your response has been recorded. There's no need to fill it out again."))}</p>`;
    return c;
  }

  function submit() {
    const root = $("#survey-root");
    root.innerHTML = "";
    const saving = el("div", "state-card card");
    saving.innerHTML = `<h2>${esc(S("Saving your response…"))}</h2><p>${esc(S("One moment."))}</p>`;
    root.appendChild(saving);

    // stamp() includes the question still on screen, so the payload carries the
    // time spent on every question including the last one.
    fetch("/api/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        respondent_id: respondentId,
        answers,
        captcha_token: captchaToken,
        timings: timing.stamp(),
      }),
    })
      .then((r) => { if (!r.ok) throw new Error("save_failed"); return r.json(); })
      .then(() => {
        sRemove(SS_DRAFT);
        // lock the personal link so it can't be retaken
        if (inviteToken) { inviteCompleted = true; sRemove(INVITE_KEY); }
        answers = {}; currentId = QUESTIONS[0].id; respondentId = null;
        captchaToken = null; turnstileWidgetId = null;
        timing.reset(); // a new attempt starts with no accumulated question time
        root.innerHTML = "";
        const done = el("div", "state-card card");
        done.innerHTML = `
          <span class="champion-trophy">${TROPHY_SVG}</span>
          <h2>${esc(S("You're a Survey Champion"))}</h2>
          <p>${esc(S("Thank you for your time and response. You made a great contribution to the development of the community."))}</p>`;
        const actions = el("div", "actions");
        const b1 = el("button", "btn", S("Back to home"));
        b1.onclick = () => go("#/");
        actions.appendChild(b1);
        done.appendChild(actions);
        root.appendChild(done);
      })
      .catch(() => {
        root.innerHTML = "";
        const err = el("div", "state-card card");
        err.innerHTML = `
          <h2>${esc(S("We couldn't save your response"))}</h2>
          <p>${esc(S("Something went wrong reaching the server. Your answers are still saved on this device — please try again."))}</p>`;
        const actions = el("div", "actions");
        const retry = el("button", "btn", S("Try again"));
        retry.onclick = () => renderSurvey(); // back to the final page for a fresh CAPTCHA
        actions.appendChild(retry);
        err.appendChild(actions);
        root.appendChild(err);
      });
  }

  // ── admin (data from the API) ──────────────────────────────
  async function renderAdmin() {
    const root = $("#admin-root");
    root.innerHTML = "";
    document.querySelector(".admin-header-actions")?.remove();
    if (!adminAuthed || !adminRole) {
      // restore an existing session (httpOnly cookie) if present
      try { const me = await fetch("/api/me").then((r) => r.json()); if (me.authed) { adminAuthed = true; adminRole = me.role || "super"; } } catch (e) {}
      if (!adminAuthed) { root.appendChild(gateCard()); return; }
    }
    const isSuper = adminRole === "super";

    let stats = null;
    if (isSuper) { try { stats = await fetch("/api/stats").then((r) => (r.ok ? r.json() : null)); } catch (e) { stats = null; } }
    const completed = stats ? stats.completed : 0;
    const started = stats ? stats.started : 0;
    const optins = stats ? stats.optins : 0;
    const completion = started ? Math.round((completed / started) * 100) : 0;

    const shell = el("div", "admin-shell");

    // ── left rail (sidebar) ─────────────────────────────────
    const rail = el("aside", "admin-rail");

    if (isSuper) {
    const exp = el("div", "export-menu");
    const expBtn = el("button", "rail-btn rail-btn-primary", `<span class="export-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M8 2.5v7"/><path d="M4.8 7.2 8 10.4l3.2-3.2"/><path d="M4 13.5h8"/></svg></span><span class="export-label">Export</span><span class="export-caret" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="m5 6.5 3 3 3-3"/></svg></span>`);
    expBtn.disabled = completed === 0;
    const menu = el("div", "export-menu-list");
    const EXPORT_ICONS = {
      xlsx: '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="3" y="3" width="14" height="14" rx="2.5" stroke="currentColor" stroke-width="1.5"/><path d="M3 8.2h14M3 12.4h14M8 8.2v8.3M12.5 8.2v8.3" stroke="currentColor" stroke-width="1.1"/></svg>',
      csv: '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5.4 2.7h5.2L15 6.9V16.3a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3.7a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M10.4 2.7v4.4H15" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M7.6 11.2h4.8M7.6 13.6h4.8" stroke="currentColor" stroke-width="1.1"/></svg>',
      zip: '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="4" y="4.5" width="12" height="11" rx="1.8" stroke="currentColor" stroke-width="1.5"/><path d="M10 4.5v11" stroke="currentColor" stroke-width="1.1"/><path d="M10 6.7h1.7M10 9.1h1.7M10 11.5h1.7" stroke="currentColor" stroke-width="1.2"/></svg>',
    };
    [
      [".xlsx", "/api/export.xlsx", "xlsx"],
      [".csv", "/api/export.csv", "csv"],
      [".zip", "/api/export.zip", "zip"],
    ].forEach(([label, url, key]) => {
      const item = el("button", "export-menu-item", EXPORT_ICONS[key] + `<span>${esc(label)}</span>`);
      item.onclick = () => { exp.classList.remove("open"); window.location.href = url; };
      menu.appendChild(item);
    });
    expBtn.onclick = (e) => {
      e.stopPropagation();
      const open = exp.classList.toggle("open");
      if (open) {
        const close = (ev) => { if (!exp.contains(ev.target)) { exp.classList.remove("open"); document.removeEventListener("click", close); } };
        setTimeout(() => document.addEventListener("click", close), 0);
      }
    };
    exp.appendChild(expBtn);
    exp.appendChild(menu);
    rail.appendChild(exp);
    }

    rail.appendChild(el("div", "rail-spacer"));

    const foot = el("div", "rail-foot");
    const outBtn = el("button", "rail-btn rail-btn-ghost", "Log out");
    outBtn.onclick = async () => { try { await fetch("/api/logout", { method: "POST" }); } catch (e) {} adminAuthed = false; adminRole = null; renderAdmin(); };
    foot.appendChild(outBtn);
    rail.appendChild(foot);

    // The rail is the dashboard's left panel: mount it as the first column of the
    // admin shell, with the content column beside it.
    shell.appendChild(rail);

    // ── content ─────────────────────────────────────────────
    const content = el("div", "admin-content");
    if (!isSuper) {
      // Invite-only admin: focused page with just the invitations card.
      content.classList.add("invite-admin-content");
      const inviteCard = await invitesSection();
      inviteCard.classList.add("invite-card-focused");
      content.appendChild(inviteCard);
    } else {
      const statsRow = el("div", "admin-stats");
      if (!stats) {
        statsRow.appendChild(stat("Database", "offline", "could not reach the server"));
      } else {
        statsRow.appendChild(stat("Total responses", completed, "complete submissions"));
        statsRow.appendChild(stat("Surveys started", started, "incl. in progress"));
        statsRow.appendChild(stat("Completion rate", completion + "%", completed + " / " + started, completion >= 60));
        statsRow.appendChild(stat("Gift-card opt-ins", optins, completed ? Math.round((optins / completed) * 100) + "% of responses" : "—"));
      }
      content.appendChild(statsRow);
      if (stats) {
        // Dashboard analytics: only the Homepage-variant breakdown and the Email
        // invitation panel are shown, centred under the four stat cards. The other
        // cards (Homepage & Channel Tracking, By channel, By community source,
        // Motivation card) are hidden from the UI only -- their data and API are
        // untouched. Re-add the relevant appendChild lines to show any of them:
        //   analytics.appendChild(variantChannelCard(stats.variantChannels || []));
        //   analytics.appendChild(channelCard(stats.channels || [], stats.drawEntries));
        //   analytics.appendChild(sourceCard(stats.sources || []));
        //   analytics.appendChild(motivationCard(stats.motivation));
        const analytics = el("div", "admin-analytics-center");
        analytics.appendChild(variantCard(stats.variants || []));
        analytics.appendChild(await invitesSection());
        content.appendChild(analytics);
      } else {
        content.appendChild(await invitesSection());
      }
    }

    shell.appendChild(content);
    root.appendChild(shell);
  }

  // Started & completed per homepage variant, split by channel (invite vs public).
  function variantChannelCard(rows) {
    const card = chartCard("Homepage & Channel Tracking", "invite vs public", true);
    if (!rows || !rows.length) { card.appendChild(emptyChart()); return card; }
    const tbl = el("div", "variant-table");
    tbl.appendChild(parse(`<div class="variant-row vc-row variant-head"><span>Variant</span><span>Channel</span><span>Started</span><span>Completed</span><span>Completion</span></div>`));
    rows.forEach((r) => {
      const conv = r.started ? Math.round((r.completed / r.started) * 100) : 0;
      tbl.appendChild(parse(`<div class="variant-row vc-row"><span class="variant-id">${esc(r.variant)}</span><span>${r.channel === "invite" ? "Email invite" : "Public"}</span><span>${r.started}</span><span>${r.completed}</span><span>${conv}%</span></div>`));
    });
    card.appendChild(tbl);
    return card;
  }

  // Invite vs public funnel + deduped draw entries.
  function channelCard(channels, drawEntries) {
    const card = chartCard("By channel", "invite vs public");
    const tbl = el("div", "variant-table");
    tbl.appendChild(parse(`<div class="variant-row chan-row variant-head"><span>Channel</span><span>Started</span><span>Completed</span></div>`));
    channels.forEach((c) => {
      tbl.appendChild(parse(`<div class="variant-row chan-row"><span class="variant-id">${c.channel === "invite" ? "Email invite" : "Public"}</span><span>${c.started}</span><span>${c.completed}</span></div>`));
    });
    card.appendChild(tbl);
    if (drawEntries != null) card.appendChild(el("div", "rail-meta", `Gift-card draw entries (unique emails): ${drawEntries}`));
    return card;
  }

  // Responses by community source (QR ?src= tags), started/completed + completion.
  function sourceCard(sources) {
    const card = chartCard("By community source", "QR links (?src=)");
    if (!sources || !sources.length) { card.appendChild(el("div", "rail-meta", "No source-tagged responses yet.")); return card; }
    const tbl = el("div", "variant-table");
    tbl.appendChild(parse(`<div class="variant-row chan-row variant-head"><span>Source</span><span>Started</span><span>Completed</span></div>`));
    sources.forEach((s) => {
      const conv = s.started ? Math.round((s.completed / s.started) * 100) : 0;
      tbl.appendChild(parse(`<div class="variant-row chan-row"><span class="variant-id">${esc(s.source)}</span><span>${s.started}</span><span>${s.completed} (${conv}%)</span></div>`));
    });
    card.appendChild(tbl);
    return card;
  }

  // Motivation-card experiment (HP2 arm): one signal per respondent.
  //  0 = never shown · 1 = shown once & continued · 2 = shown twice & continued · -1 = shown but did not move forward
  function motivationCard(m) {
    const card = chartCard("Motivation card (HP2 arm)", "one signal per respondent");
    m = m || { neverShown: 0, continued1: 0, continued2: 0, dropped: 0 };
    const total = m.neverShown + m.continued1 + m.continued2 + m.dropped;
    if (!total) { card.appendChild(el("div", "rail-meta", "No HP2 responses yet.")); return card; }
    const row = (label, n) => tbl.appendChild(parse(`<div class="variant-row chan-row"><span class="variant-id">${label}</span><span>${n}</span><span></span></div>`));
    const tbl = el("div", "variant-table");
    tbl.appendChild(parse(`<div class="variant-row chan-row variant-head"><span>Signal</span><span>Respondents</span><span></span></div>`));
    row("Never shown (0)", m.neverShown);
    row("Shown once → continued (1)", m.continued1);
    row("Shown twice → continued (2)", m.continued2);
    row("Shown → did not continue (-1)", m.dropped);
    card.appendChild(tbl);
    const shown = m.continued1 + m.continued2 + m.dropped;
    const continued = m.continued1 + m.continued2;
    const rate = shown ? Math.round((continued / shown) * 100) : 0;
    card.appendChild(el("div", "rail-meta", `Of respondents shown the card, ${rate}% continued (${continued}/${shown}).`));
    return card;
  }

  // Email invitations: generate personal links, track completion, export non-completers.
  async function invitesSection() {
    const card = el("div", "chart-card invite-card");
    card.appendChild(parse(`<div class="chart-head"><h4>Email invitations</h4><span class="chart-sub">personal links · completion tracking</span></div>`));

    const form = el("div", "invite-form");
    const ta = el("textarea", "input invite-emails");
    ta.placeholder = "Paste emails";
    const addBtn = el("button", "btn btn-sm", "Generate links");
    form.appendChild(ta);
    form.appendChild(addBtn);
    card.appendChild(form);

    const listWrap = el("div", "invite-list-wrap");
    card.appendChild(listWrap);

    async function refresh() {
      let data = { invites: [] };
      try { data = await fetch("/api/invites").then((r) => (r.ok ? r.json() : { invites: [] })); } catch (e) {}
      renderInviteList(listWrap, data.invites || []);
    }
    addBtn.onclick = async () => {
      const emails = ta.value.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
      if (!emails.length) return;
      addBtn.disabled = true; addBtn.textContent = "Generating…";
      try { await fetch("/api/invites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ emails }) }); } catch (e) {}
      ta.value = ""; addBtn.disabled = false; addBtn.textContent = "Generate links";
      refresh();
    };
    await refresh();
    return card;
  }

  // Fully mask invite emails in the dashboard list. The real address is only used
  // by the Send/Remind actions and is never displayed.
  function maskEmail(e) {
    if (!e) return "—";
    return "••••••••••••••••";
  }

  function renderInviteList(container, invites) {
    container.innerHTML = "";
    if (!invites.length) { return; }
    const base = location.origin;
    const done = invites.filter((i) => i.completed).length;

    const head = el("div", "invite-summary");
    head.appendChild(el("span", null, `${done} of ${invites.length} completed`));
    container.appendChild(head);

    // Open a pre-filled Gmail compose window (no desktop mail app needed).
    const gmail = (to, subject, body) =>
      window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, "_blank", "noopener");

    const tbl = el("div", "invite-table");
    tbl.appendChild(parse(`<div class="invite-row invite-head"><span>Email</span><span>Status</span><span>Actions</span></div>`));
    const body = el("div", "invite-table-body");
    const statusIcon = {
      "not-started": '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><path d="M5.3 8h5.4"/></svg>',
      started: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><path d="M8 4.7v3.6l2.5 1.5"/></svg>',
      completed: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><path d="M5.2 8.1l1.8 1.8 3.7-4"/></svg>',
    };
    invites.forEach((i) => {
      const statusKind = i.completed ? "completed" : i.started ? "started" : "not-started";
      const statusLabel = i.completed ? "Completed" : i.started ? "Started" : "Not started";
      const status = i.completed ? "✅ Completed" : i.started ? "🟡 Started" : "⚪ Not started";
      const link = `${base}/?t=${i.token}`;
      const full = i.email || "";
      const row = el("div", "invite-row");

      row.appendChild(el("span", "invite-email", esc(maskEmail(full))));        // masked, no reveal
      row.appendChild(el("span", `invite-status is-${statusKind}`, `<span class="invite-status-icon">${statusIcon[statusKind]}</span><span>${statusLabel}</span>`));

      const cell = el("span", "invite-link");
      if (!i.completed && full) {
        // Send = first invitation
        const send = el("button", "btn-copy", "Send");
        send.title = "Open a pre-filled invitation email in Gmail";
        send.onclick = () => gmail(full, "You're invited: Sault Newcomer Skills Survey",
          `Hi,\n\nYou're invited to take part in the Sault Newcomer Skills Survey. It takes about 10 minutes:\n${link}\n\nThank you!`);
        cell.appendChild(send);
        // Remind = follow-up reminder
        const remind = el("button", "btn-copy btn-copy-ghost", "Remind");
        remind.title = "Open a pre-filled reminder email in Gmail";
        remind.onclick = () => gmail(full, "Reminder: Sault Newcomer Skills Survey",
          `Hi,\n\nA friendly reminder to complete the Sault Newcomer Skills Survey. It takes about 10 minutes:\n${link}\n\nThank you!`);
        cell.appendChild(remind);
      }
      row.appendChild(cell);
      body.appendChild(row);
    });
    tbl.appendChild(body);
    container.appendChild(tbl);
  }

  // Homepage A/B/C funnel: views → started → completed per variant.
  function variantCard(variants) {
    const card = chartCard("Homepage variants (HP1 / HP2)", "views · started · completed", true);
    // Only show the currently active variants (HP1, HP2). Legacy variants such as
    // HP3 still exist in old rows but are no longer in use, so they are hidden from
    // this card; their historical data stays in the DB and the exports.
    const active = Object.keys((window.SURVEY && window.SURVEY.HOME_VARIANTS) || {});
    const list = (variants || []).filter((v) => active.includes(v.variant));
    if (!list.length) {
      card.appendChild(el("div", "chart-empty", "No homepage views recorded yet."));
      return card;
    }
    const tbl = el("div", "variant-table");
    tbl.appendChild(parse(
      `<div class="variant-row variant-head"><span>Variant</span><span>Views</span><span>Started</span><span>Completed</span><span>Conv.</span></div>`
    ));
    list.forEach((v) => {
      const conv = v.views ? Math.round((v.completed / v.views) * 100) : 0;
      tbl.appendChild(parse(
        `<div class="variant-row"><span class="variant-id">${esc(v.variant)}</span><span>${v.views}</span><span>${v.started}</span><span>${v.completed}</span><span>${conv}%</span></div>`
      ));
    });
    card.appendChild(tbl);
    return card;
  }

  // ── dashboard analytics (no libraries) ─────────────────────
  function adminCharts(series) {
    const grid = el("div", "admin-grid");
    grid.appendChild(trendCard(series));
    return grid;
  }

  function chartCard(title, sub, wide) {
    const card = el("div", "chart-card" + (wide ? " chart-wide" : ""));
    card.appendChild(parse(`<div class="chart-head"><h4>${esc(title)}</h4><span class="chart-sub">${esc(sub)}</span></div>`));
    return card;
  }
  function emptyChart() { return el("div", "chart-empty", "No responses yet — this fills in as people complete the survey."); }
  const fmtDay = (d) => d.toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });

  function trendCard(series) {
    const card = chartCard("Responses over time", "last 14 days", true);
    const days = 14;
    const map = {};
    (series || []).forEach((r) => { map[r.d] = r.c; });
    const now = new Date();
    const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const labels = [], counts = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(base - i * 86400000);
      labels.push(d);
      counts.push(map[d.toISOString().slice(0, 10)] || 0);
    }
    if (counts.reduce((a, b) => a + b, 0) === 0) { card.appendChild(emptyChart()); return card; }

    const W = 600, H = 150, pad = 6, n = counts.length, max = Math.max(...counts, 1);
    const x = (i) => pad + i * (W - 2 * pad) / (n - 1);
    const y = (v) => H - pad - v * (H - 2 * pad) / max;
    const pts = counts.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    const line = "M" + pts.join(" L");
    const area = `M${x(0)},${H - pad} L` + pts.join(" L") + ` L${x(n - 1)},${H - pad} Z`;
    card.appendChild(parse(`
      <svg class="area-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        <path class="area-fill" d="${area}"></path>
        <path class="area-line" d="${line}"></path>
      </svg>`));
    card.appendChild(parse(`<div class="area-axis"><span>${fmtDay(labels[0])}</span><span>peak ${max}/day</span><span>${fmtDay(labels[n - 1])}</span></div>`));
    return card;
  }

  function barsCard(title, sub, entries, max, fmtVal) {
    const card = chartCard(title, sub);
    if (!entries.length) { card.appendChild(emptyChart()); return card; }
    const bars = el("div", "bars");
    entries.forEach(([label, val]) => {
      const pct = max ? Math.max(2, (val / max) * 100) : 0;
      const row = el("div", "bar-row");
      row.innerHTML = `<span class="bar-label" title="${esc(label)}">${esc(label)}</span><span class="bar-track"><span class="bar-fill" style="width:${pct}%"></span></span><span class="bar-val">${esc(fmtVal(val))}</span>`;
      bars.appendChild(row);
    });
    card.appendChild(bars);
    return card;
  }

  function skillsCard(subs) {
    const withSkills = subs.filter((s) => s.skills);
    const entries = SKILLS.map(([key, name]) => {
      const vals = withSkills.map((s) => s.skills[key]).filter((v) => typeof v === "number");
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      return [name, avg];
    });
    return barsCard("Average self-rated skills", "scale 1–5", withSkills.length ? entries : [], 5, (v) => v.toFixed(1));
  }

  function barriersCard(subs) {
    const counts = {};
    subs.forEach((s) => (s.employment_barriers || []).forEach((b) => { counts[b] = (counts[b] || 0) + 1; }));
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6);
    return barsCard("Top employment barriers", "most selected", entries, entries.length ? entries[0][1] : 0, (v) => String(v));
  }

  // ── collaborators (local, this-device only) ────────────────
  function getCollaborators() { try { return JSON.parse(sGet(SS_COLLAB) || "[]"); } catch (e) { return []; } }
  function saveCollaborators(list) { sSet(SS_COLLAB, JSON.stringify(list)); }

  function collaboratorSection() {
    const card = el("div", "collab");
    const form = el("div", "collab-form");
    const input = el("input", "input");
    input.type = "email";
    input.placeholder = "name@example.com";
    input.autocomplete = "off";
    const add = el("button", "btn btn-add", "Add");
    const err = el("div", "collab-err");
    const list = el("div", "collab-list");

    function renderList() {
      list.innerHTML = "";
      const cur = getCollaborators();
      if (!cur.length) { list.appendChild(el("div", "collab-empty", "No collaborators yet.")); return; }
      cur.forEach((email, i) => {
        const row = el("div", "collab-item");
        row.innerHTML = `<span class="collab-avatar">${esc(email[0].toUpperCase())}</span><span class="collab-email">${esc(email)}</span>`;
        const x = el("button", "collab-remove", "×");
        x.title = "Remove";
        x.onclick = () => { const arr = getCollaborators(); arr.splice(i, 1); saveCollaborators(arr); renderList(); };
        row.appendChild(x);
        list.appendChild(row);
      });
    }
    const tryAdd = () => {
      const v = input.value.trim().toLowerCase();
      if (!isEmail(v)) { err.textContent = "Enter a valid email address."; return; }
      const arr = getCollaborators();
      if (arr.includes(v)) { err.textContent = "Already added."; return; }
      arr.push(v); saveCollaborators(arr); input.value = ""; err.textContent = ""; renderList(); input.focus();
    };
    add.onclick = tryAdd;
    input.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); tryAdd(); } };
    input.oninput = () => { if (err.textContent) err.textContent = ""; };

    form.appendChild(input);
    form.appendChild(add);
    card.appendChild(form);
    card.appendChild(err);
    card.appendChild(list);
    renderList();
    return card;
  }

  function stat(lbl, val, sub, good) {
    const s = el("div", "astat");
    s.innerHTML = `<div class="astat-lbl">${esc(lbl)}</div><div class="astat-val">${esc(val)}</div><div class="astat-sub${good ? " g" : ""}">${esc(sub)}</div>`;
    return s;
  }

  function gateCard() {
    const c = el("div", "gate card");
    c.innerHTML = `
      <h4>Console access</h4>
      <p>Enter the access passcode to view responses and export data. For admins and collaborators only.</p>
      <div class="field"><label class="field-lbl">Passcode</label><input class="input" id="gate-pass" type="password" placeholder="••••••••" autocomplete="off"></div>
      <div class="gate-err" id="gate-err"></div>`;
    const btn = el("button", "btn", "Unlock");
    const tryAuth = async () => {
      const v = $("#gate-pass", c).value;
      $("#gate-err", c).textContent = "";
      btn.disabled = true;
      try {
        const r = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ passcode: v }),
        });
        if (r.ok) { const j = await r.json().catch(() => ({})); adminAuthed = true; adminRole = j.role || "super"; renderAdmin(); return; }
        $("#gate-err", c).textContent = r.status === 500 ? "Server auth not configured." : "Incorrect passcode.";
      } catch (e) {
        $("#gate-err", c).textContent = "Could not reach the server.";
      }
      btn.disabled = false;
    };
    btn.onclick = tryAuth;
    c.appendChild(btn);
    setTimeout(() => { const i = $("#gate-pass", c); if (i) { i.focus(); i.onkeydown = (e) => { if (e.key === "Enter") tryAuth(); }; } }, 30);
    return c;
  }

  // ── CSV ────────────────────────────────────────────────────
  function csvColumns() {
    const base = ["id", "submitted_at"];
    const qcols = [];
    QUESTIONS.forEach((q) => {
      if (q.type === "rating") q.skills.forEach(([k, name]) => qcols.push("skill_" + k));
      else qcols.push(q.id);
    });
    qcols.push("gift_card_email");
    return base.concat(qcols);
  }
  function columnCount() { return csvColumns().length; }

  function cell(v) {
    if (v == null) return "";
    let s = Array.isArray(v) ? v.join("; ") : String(v);
    if (/[",\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function exportCSV() {
    // CSV is generated server-side (joins all 6 tables) and downloaded directly.
    window.location.href = "/api/export.csv";
  }

  function parse(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; }

  // ── keyboard navigation ────────────────────────────────────
  function surveyKey(e) {
    if (infoCard) return; // an open card owns the keyboard
    if (!$("#view-survey").classList.contains("active")) return;
    if (e.altKey || e.ctrlKey || e.metaKey) {
      // allow Cmd/Ctrl+Enter to submit from within a textarea
      if (!(e.key === "Enter" && (e.metaKey || e.ctrlKey))) return;
    }
    const list = visibleList();
    const q = list[posOf(currentId)];
    if (!q) return;
    const tag = (e.target.tagName || "").toLowerCase();
    const typing = tag === "textarea" || tag === "input";

    if (e.key === "Enter") {
      if (tag === "textarea" && !(e.metaKey || e.ctrlKey)) return; // let textareas take newlines
      const nextBtn = $("#btn-next");
      if (nextBtn && !nextBtn.disabled) { e.preventDefault(); nextBtn.click(); }
      return;
    }
    if (typing) return; // never hijack while the user is typing

    // letter keys A–H select options for choice-style questions
    if ((q.type === "single" || q.type === "multi" || q.type === "eligibility") && /^[a-z]$/i.test(e.key)) {
      const idx = e.key.toUpperCase().charCodeAt(0) - 65;
      const opts = $("#survey-root").querySelectorAll(".opt");
      if (opts[idx]) { e.preventDefault(); opts[idx].click(); }
    }
  }

  // ── wire up ────────────────────────────────────────────────
  window.addEventListener("hashchange", route);
  document.addEventListener("keydown", surveyKey);
  // "Survey Information Letter" / "Consent Information" in the consent question
  // open their in-page cards instead of navigating to the external Google Docs.
  document.addEventListener("click", (e) => {
    const trigger = e.target.closest && e.target.closest("[data-info-card]");
    if (!trigger) return;
    e.preventDefault();
    openInfoCard(trigger.getAttribute("data-info-card"));
  });
  document.addEventListener("DOMContentLoaded", async () => {
    restoreLanguage();
    applyHomeVariant();
    // Bind the header controls before anything that can await: a failed
    // invite fetch must not leave the language button dead.
    const langBtn = $("#lang-btn");
    if (langBtn) langBtn.onclick = toggleLangMenu;
    $("#start-btn").onclick = startSurvey;
    captureSource();
    await captureInvite();
    document.querySelectorAll("[data-start-survey]").forEach((n) => n.onclick = startSurvey);
    document.querySelectorAll("[data-go]").forEach((n) => n.onclick = () => go(n.getAttribute("data-go")));
    route();
  });
})();
