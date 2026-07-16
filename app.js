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
  let homeVariant = null;  // which homepage variant (HP1/HP2/HP3) this visitor saw
  let inviteToken = null;  // personal-link token (channel = invite) if present
  let inviteCompleted = false; // this invite link already has a completed response
  const INVITE_KEY = "sault_invite_token";
  let ratingStep = 0;      // current skill index within a rating question (one-at-a-time)
  let ratingStepQ = null;  // which rating question ratingStep currently applies to

  // Cloudflare Turnstile (bot check on the final submit). Site key is public.
  // Production keys don't work on localhost, so use Cloudflare's always-pass
  // TEST key there; the real key runs on every real (allowlisted) domain.
  const TURNSTILE_SITE_KEY =
    /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)
      ? "1x00000000000000000000AA"
      : "0x4AAAAAADunx3DOaWKiJx9_";
  let captchaToken = null;      // token from a solved Turnstile challenge
  let turnstileWidgetId = null; // rendered widget id (for reset/remove)

  // restore draft
  try {
    const d = JSON.parse(localStorage.getItem(SS_DRAFT) || "null");
    if (d && d.answers) { answers = d.answers; currentId = d.currentId || currentId; respondentId = d.respondentId || null; }
  } catch (e) {}

  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // Trophy goal marker (original SVG): cup + two handles + stem + base. Colored via currentColor.
  const TROPHY_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4h10v4.5a5 5 0 0 1-10 0V4Z"/><path d="M7 5.5H5a2 2 0 0 0 2 2"/><path d="M17 5.5h2a2 2 0 0 1-2 2"/><path d="M12 13.5V17"/><path d="M8.5 20h7l-1-3h-5Z"/></svg>';

  function saveDraft() { localStorage.setItem(SS_DRAFT, JSON.stringify({ answers, currentId, respondentId })); }
  function getSubmissions() { try { return JSON.parse(localStorage.getItem(SS_KEY) || "[]"); } catch (e) { return []; } }
  function getStarts() { return parseInt(localStorage.getItem(SS_STARTS) || "0", 10); }

  // ── visible question flow (branching) ──────────────────────
  function visibleList() { return QUESTIONS.filter((q) => !q.visible || q.visible(answers)); }
  function posOf(id) { const l = visibleList(); const i = l.findIndex((q) => q.id === id); return i < 0 ? 0 : i; }

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
    if (body && Array.isArray(v.body)) {
      body.innerHTML = "";
      v.body.forEach((para) => body.appendChild(el("p", "home-body-p", esc(para))));
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
    let id = localStorage.getItem(KEY);
    if (!ids.includes(id)) {
      id = ids[Math.floor(Math.random() * ids.length)];
      localStorage.setItem(KEY, id);
    }
    homeVariant = id;
    renderHomeBody(variants[id]);
    // Count one view per browser, on its OWN key (independent of the sticky variant
    // assignment) — so a browser that already has a variant still logs its first view.
    const VIEW_KEY = "sault_home_viewed";
    if (!localStorage.getItem(VIEW_KEY)) {
      localStorage.setItem(VIEW_KEY, id);
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
    if (urlT) localStorage.setItem(INVITE_KEY, urlT);
    inviteToken = localStorage.getItem(INVITE_KEY) || null;
    if (!inviteToken) { inviteCompleted = false; return; }
    try {
      const s = await fetch("/api/invite?t=" + encodeURIComponent(inviteToken)).then((r) => r.json());
      if (!s.valid) { localStorage.removeItem(INVITE_KEY); inviteToken = null; inviteCompleted = false; }
      else inviteCompleted = !!s.completed;
    } catch (e) {}
  }

  function startSurvey() {
    if (inviteCompleted) { go("#/survey"); return; } // renders the "already completed" notice
    // Already have an in-progress response in this browser → continue where they left
    // off (keep answers + position, and don't create another "started" row).
    if (respondentId) { go("#/survey"); return; }
    answers = {}; currentId = QUESTIONS[0].id; saveDraft();
    go("#/survey");
    fetch("/api/start", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variant: homeVariant, token: inviteToken }),
    })
      .then((r) => r.json())
      .then((d) => { if (d && d.id) { respondentId = d.id; saveDraft(); } })
      .catch(() => {});
  }

  // ── i18n display helpers (Phase 2) ─────────────────────────
  // These translate only what the respondent SEES. Stored values stay canonical
  // English, so branching / lookups / exports are unaffected. Missing keys fall
  // back to English.
  function langCode() { return window.I18N ? window.I18N.code(answers.language) : "en"; }
  function tQ(key, english) { return window.I18N ? window.I18N.q(key, english, langCode()) : english; }
  function tHelp(id, english) { return window.I18N ? window.I18N.help(id, english, langCode()) : english; }
  function tDef(term, english) { return window.I18N ? window.I18N.def(term, english, langCode()) : english; }
  // Fixed UI / screen string, keyed by its English source text. `code` is optional
  // — the completion screen renders after answers reset, so it passes the code in.
  function S(text, code) { return window.I18N ? window.I18N.ui(text, code || langCode()) : text; }
  // Option display label: the language question shows native names (Français,
  // العربية…); every other question shows the translated option (English fallback).
  function optLabel(q, v) {
    if (q && q.id === "language" && window.I18N) return window.I18N.native(v);
    return window.I18N ? window.I18N.o(v, langCode()) : v;
  }

  // Right-to-left languages (Arabic, Urdu) need the survey laid out mirrored.
  // Scoped to the survey view so the home page and admin stay left-to-right.
  function applyDir() {
    const view = $("#view-survey");
    if (!view) return;
    const rtl = !!(window.I18N && window.I18N.isRTL(langCode()));
    view.setAttribute("dir", rtl ? "rtl" : "ltr");
    view.classList.toggle("rtl", rtl);
  }

  // ── survey rendering ───────────────────────────────────────
  function renderSurvey() {
    const root = $("#survey-root");
    root.innerHTML = "";
    applyDir();

    // a personal-invite link that's already been completed cannot be retaken
    if (inviteCompleted) { root.appendChild(inviteCompletedState()); return; }

    // consent / ineligible gates
    if (answers.consent === "I disagree") { root.appendChild(consentDeclinedState()); return; }
    if (answers.eligible === "No") { root.appendChild(ineligibleState()); return; }

    const list = visibleList();
    const pos = posOf(currentId);
    const q = list[pos];
    if (!q) { go("#/"); return; }
    if (q.type !== "rating") ratingStepQ = null; // recompute step fresh on re-entry

    // Compact respondent progress
    const total = list.length;
    const progress = Math.round(((pos + 1) / total) * 100);
    const prog = el("div", "progress-card");
    prog.innerHTML = `
      <div class="progress-top">
        <span class="progress-count">${pos + 1} / ${total}</span>
      </div>
      <div class="progress-bar-row">
        <div class="progress-track" aria-label="${progress}${esc(S("% complete"))}">
          <span style="width:${progress}%"></span>
        </div>
        <span class="progress-trophy${progress >= 100 ? " done" : ""}" title="${esc(S("Finish to become a Survey Champion"))}">${TROPHY_SVG}</span>
      </div>`;
    root.appendChild(prog);

    // question block
    const block = el("div", "q-block");
    const qEnglish = typeof q.text === "function" ? q.text(answers) : q.text;
    const qKey = typeof q.textKey === "function" ? q.textKey(answers) : q.id;
    block.appendChild(el("h2", "q-text", esc(tQ(qKey, qEnglish))));
    if (q.help) block.appendChild(el("p", "q-help", esc(tHelp(q.id, q.help))));
    // channel-aware privacy note on the consent step (draft wording — confirm with REB)
    if (q.id === "consent") {
      block.appendChild(el("p", "consent-privacy", inviteToken
        ? S("You opened a personal invitation link, so your completion may be recorded for reminder purposes. Your responses are kept confidential and analyzed in de-identified form.")
        : S("Your responses are anonymous.")));
    }
    block.appendChild(renderControl(q));
    root.appendChild(block);

    // nav
    if (pos === total - 1) {
      // Final page: no arrows — a CAPTCHA gate plus an explicit Submit button.
      root.appendChild(renderSubmitNav(q));
    } else {
      const nav = el("div", "q-nav");
      const back = el("button", "btn btn-nav-arrow", "←");
      back.setAttribute("aria-label", S("Previous question"));
      back.title = S("Previous question");
      back.disabled = pos === 0;
      back.onclick = () => { const l = visibleList(); const p = posOf(currentId); if (p > 0) { currentId = l[p - 1].id; saveDraft(); renderSurvey(); } };
      const next = el("button", "btn btn-nav-arrow", "→");
      next.setAttribute("aria-label", S("Next question"));
      next.title = S("Next question");
      next.id = "btn-next";
      next.disabled = !isAnswered(q);
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
        next.disabled = !pageComplete(q, page);
        next.onclick = () => advanceRatingPage(q);
        next.title = page < pages - 1 ? S("Next 5 skills") : S("Next question");
      }
      nav.appendChild(back);
      nav.appendChild(el("span", "q-nav-spacer"));
      nav.appendChild(next);
      root.appendChild(nav);
    }
  }

  // Final page: subtle Back link, Turnstile CAPTCHA, and a Submit button that
  // stays disabled until the page is answered AND the CAPTCHA is solved.
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
    submitBtn.disabled = !(isAnswered(q) && captchaToken);
    submitBtn.onclick = () => { if (!submitBtn.disabled) submit(); };
    wrap.appendChild(submitBtn);

    captchaToken = null; // fresh challenge whenever this page (re)renders
    requestAnimationFrame(() => mountTurnstile(capBox, () => updateNav(q)));
    return wrap;
  }

  function updateNav(q) {
    const b = $("#btn-next"); if (b) b.disabled = !isAnswered(q);
    const s = $("#btn-submit"); if (s) s.disabled = !(isAnswered(q) && captchaToken);
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
    if (!isAnswered(q)) return;
    if (q.id === "consent" && answers.consent === "I disagree") { saveDraft(); renderSurvey(); return; }
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
      if (def) {
        const h = btn.querySelector(".opt-help");
        const toggleTip = (e) => { e.stopPropagation(); e.preventDefault(); h.classList.toggle("tip-open"); };
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
        const item = el("button", "custom-select-option" + (answers[q.id] === option ? " on" : ""), esc(optLabel(q, option)));
        item.type = "button";
        item.setAttribute("role", "option");
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
      if (open) { renderList(); setTimeout(() => search.focus(), 0); }
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
      const item = el("button", "custom-select-option" + (answers[q.id] === option ? " on" : ""), esc(optLabel(q, option)));
      item.type = "button";
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", answers[q.id] === option ? "true" : "false");
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
    const top = el("div", "rate-one-top");
    top.appendChild(el("span", "rate-count", `${start + 1}–${Math.min(start + RATE_PAGE, list.length)}/${list.length}`));
    wrap.appendChild(top);

    const grid = el("div", "grid-rate");
    slice.forEach(([key, name, desc]) => {
      const row = el("div", "rate-row");
      row.appendChild(el("div", "rate-name", desc ? `${esc(name)}<span>${esc(desc)}</span>` : esc(name)));
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
          const b = $("#btn-next"); if (b) b.disabled = !pageComplete(q, page);
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

    const legend = q.legend || ["1 · not confident", "5 · very confident"];
    wrap.appendChild(el("div", "rate-legend", `<span>${esc(S(legend[0]))}</span><span>${esc(S(legend[1]))}</span>`));
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
      <h2>${esc(S("Consent is required to continue"))}</h2>
      <p>${esc(S("To take part, you must be at least 18 years old and agree to participate. If you'd like to continue, you can go back and change your answer."))}</p>`;
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
    const home = el("button", "btn", S("Go home"));
    home.onclick = () => go("#/");
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

    fetch("/api/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ respondent_id: respondentId, answers, captcha_token: captchaToken }),
    })
      .then((r) => { if (!r.ok) throw new Error("save_failed"); return r.json(); })
      .then(() => {
        const finishCode = langCode(); // capture before answers reset, so the thank-you screen still translates
        localStorage.removeItem(SS_DRAFT);
        // lock the personal link so it can't be retaken
        if (inviteToken) { inviteCompleted = true; localStorage.removeItem(INVITE_KEY); }
        answers = {}; currentId = QUESTIONS[0].id; respondentId = null;
        captchaToken = null; turnstileWidgetId = null;
        root.innerHTML = "";
        const done = el("div", "state-card card");
        done.innerHTML = `
          <span class="champion-trophy">${TROPHY_SVG}</span>
          <h2>${esc(S("You're a Survey Champion", finishCode))}</h2>
          <p>${esc(S("Thank you for your time and response. You made a great contribution to the development of the community.", finishCode))}</p>`;
        const actions = el("div", "actions");
        const b1 = el("button", "btn", S("Back to home", finishCode));
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
    rail.classList.add("admin-header-actions");

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

    const adminLink = document.querySelector('.topbar-link[data-go="#/admin"]');
    if (adminLink) adminLink.before(rail);

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
        // top: started & completed by homepage × channel (replaces the trend line chart)
        const analytics = el("div", "admin-analytics-split");
        const main = el("div", "admin-analytics-stack");
        main.appendChild(variantChannelCard(stats.variantChannels || []));
        main.appendChild(channelCard(stats.channels || [], stats.drawEntries));
        analytics.appendChild(main);
        const side = el("div", "admin-analytics-stack");
        side.appendChild(variantCard(stats.variants || []));
        side.appendChild(await invitesSection());
        analytics.appendChild(side);
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
    const card = chartCard("Homepage variants (A / B / C)", "views · started · completed", true);
    if (!variants || !variants.length) {
      card.appendChild(el("div", "chart-empty", "No homepage views recorded yet."));
      return card;
    }
    const tbl = el("div", "variant-table");
    tbl.appendChild(parse(
      `<div class="variant-row variant-head"><span>Variant</span><span>Views</span><span>Started</span><span>Completed</span><span>Conv.</span></div>`
    ));
    variants.forEach((v) => {
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
  function getCollaborators() { try { return JSON.parse(localStorage.getItem(SS_COLLAB) || "[]"); } catch (e) { return []; } }
  function saveCollaborators(list) { localStorage.setItem(SS_COLLAB, JSON.stringify(list)); }

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
  document.addEventListener("DOMContentLoaded", async () => {
    applyHomeVariant();
    await captureInvite();
    $("#start-btn").onclick = startSurvey;
    document.querySelectorAll("[data-start-survey]").forEach((n) => n.onclick = startSurvey);
    document.querySelectorAll("[data-go]").forEach((n) => n.onclick = () => go(n.getAttribute("data-go")));
    route();
  });
})();
