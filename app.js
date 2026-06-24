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
  let respondentId = null; // server-side respondent row id for this attempt
  let homeVariant = null;  // which homepage variant (HP1/HP2/HP3) this visitor saw
  let inviteToken = null;  // personal-link token (channel = invite) if present
  let inviteCompleted = false; // this invite link already has a completed response
  const INVITE_KEY = "sault_invite_token";
  let ratingStep = 0;      // current skill index within a rating question (one-at-a-time)
  let ratingStepQ = null;  // which rating question ratingStep currently applies to
  let halfwayShown = false; // halfway "Survey Champion" acknowledgment shown once per attempt

  // restore draft
  try {
    const d = JSON.parse(localStorage.getItem(SS_DRAFT) || "null");
    if (d && d.answers) { answers = d.answers; currentId = d.currentId || currentId; respondentId = d.respondentId || null; halfwayShown = !!d.halfwayShown; }
  } catch (e) {}

  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // Trophy goal marker (original SVG): cup + two handles + stem + base. Colored via currentColor.
  const TROPHY_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4h10v4.5a5 5 0 0 1-10 0V4Z"/><path d="M7 5.5H5a2 2 0 0 0 2 2"/><path d="M17 5.5h2a2 2 0 0 1-2 2"/><path d="M12 13.5V17"/><path d="M8.5 20h7l-1-3h-5Z"/></svg>';

  function saveDraft() { localStorage.setItem(SS_DRAFT, JSON.stringify({ answers, currentId, respondentId, halfwayShown })); }
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
    answers = {}; currentId = QUESTIONS[0].id; halfwayShown = false; saveDraft();
    go("#/survey");
    fetch("/api/start", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variant: homeVariant, token: inviteToken }),
    })
      .then((r) => r.json())
      .then((d) => { if (d && d.id) { respondentId = d.id; saveDraft(); } })
      .catch(() => {});
  }

  // ── survey rendering ───────────────────────────────────────
  function renderSurvey() {
    const root = $("#survey-root");
    root.innerHTML = "";

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
        <div class="progress-track" aria-label="${progress}% complete">
          <span style="width:${progress}%"></span>
        </div>
        <span class="progress-trophy${progress >= 100 ? " done" : ""}" title="Finish to become a Survey Champion">${TROPHY_SVG}</span>
      </div>`;
    root.appendChild(prog);

    // One-time "Survey Champion · Halfway there" acknowledgment when crossing 50%.
    if (progress >= 50 && progress < 100 && !halfwayShown) {
      halfwayShown = true; saveDraft();
      showChampionToast();
    }

    // question block
    const block = el("div", "q-block");
    block.appendChild(el("h2", "q-text", esc(q.text)));
    if (q.help) block.appendChild(el("p", "q-help", esc(q.help)));
    // channel-aware privacy note on the consent step (draft wording — confirm with REB)
    if (q.id === "consent") {
      block.appendChild(el("p", "consent-privacy", inviteToken
        ? "You opened a personal invitation link, so your completion may be recorded for reminder purposes. Your responses are kept confidential and analyzed in de-identified form."
        : "Your responses are anonymous."));
    }
    block.appendChild(renderControl(q));
    root.appendChild(block);

    // nav
    const nav = el("div", "q-nav");
    const back = el("button", "btn btn-nav-arrow", "←");
    back.setAttribute("aria-label", "Previous question");
    back.title = "Previous question";
    back.disabled = pos === 0;
    back.onclick = () => { const l = visibleList(); const p = posOf(currentId); if (p > 0) { currentId = l[p - 1].id; saveDraft(); renderSurvey(); } };
    const next = el("button", "btn btn-nav-arrow", "→");
    next.setAttribute("aria-label", pos === total - 1 ? "Submit survey" : "Next question");
    next.title = pos === total - 1 ? "Submit survey" : "Next question";
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
      next.title = page < pages - 1 ? "Next 5 skills" : (pos === total - 1 ? "Submit survey" : "Next question");
    }
    nav.appendChild(back);
    nav.appendChild(el("span", "q-nav-spacer"));
    nav.appendChild(next);
    root.appendChild(nav);
  }

  function updateNav(q) { const b = $("#btn-next"); if (b) b.disabled = !isAnswered(q); }

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
      const def = defs[opt];
      const help = def
        ? ` <span class="opt-help" role="button" tabindex="0" aria-label="Definition: ${esc(def)}"><span class="opt-help-icon" aria-hidden="true">?</span><span class="opt-tip" role="tooltip">${esc(def)}</span></span>`
        : "";
      btn.innerHTML = `<span class="opt-mark"></span><span class="opt-label">${esc(opt)}${help}</span><span class="opt-key">${keys[i] || ""}</span>`;
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

  function selectControl(q) {
    const field = el("div", "field");
    if (q.label) field.appendChild(el("label", "field-lbl", esc(q.label)));
    const sw = el("div", "custom-select");
    const trigger = el("button", "custom-select-trigger");
    trigger.type = "button";
    trigger.innerHTML = `<span>${esc(answers[q.id] || q.placeholder || "Select one…")}</span><span class="custom-select-caret">▾</span>`;
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");

    const menu = el("div", "custom-select-menu");
    menu.setAttribute("role", "listbox");
    const opts = typeof q.options === "function" ? q.options(answers) : q.options;
    opts.forEach((option) => {
      const item = el("button", "custom-select-option" + (answers[q.id] === option ? " on" : ""), esc(option));
      item.type = "button";
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", answers[q.id] === option ? "true" : "false");
      item.onclick = () => {
        answers[q.id] = option;
        trigger.querySelector("span").textContent = option;
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
    if (q.label) field.appendChild(el("label", "field-lbl", esc(q.label)));
    const inp = el("input", "input");
    inp.type = "text";
    inp.placeholder = q.placeholder || "";
    inp.value = answers[q.id] || "";
    inp.oninput = () => { answers[q.id] = inp.value; updateNav(q); saveDraft(); };
    field.appendChild(inp);
    return field;
  }

  function textareaControl(q) {
    const field = el("div", "field");
    field.style.maxWidth = "100%";
    if (q.label) field.appendChild(el("label", "field-lbl", esc(q.label)));
    const ta = el("textarea", "input");
    ta.placeholder = q.placeholder || "";
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
        if (n === 0) dot.title = "Not sure";
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
    wrap.appendChild(el("div", "rate-legend", `<span>${esc(legend[0])}</span><span>${esc(legend[1])}</span>`));
    return wrap;
  }

  function contactControl(q) {
    const c = answers.contact || { optin: false, email: "" };
    answers.contact = c;
    const wrap = el("div");
    const toggle = el("button", "optin" + (c.optin ? " on" : ""));
    toggle.innerHTML = `<span class="opt-mark"></span><span class="optin-text"><b>Yes, enter me in the gift-card draw</b><span>Five $50 local gift cards drawn monthly</span></span>`;
    const field = el("div", "field contact-field");
    field.style.marginTop = "4px";
    field.appendChild(el("label", "field-lbl", "Email address"));
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
    field.appendChild(el("label", "field-lbl", "Email address"));
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
      <h2>Consent is required to continue</h2>
      <p>To take part, you must be at least 18 years old and agree to participate. If you'd like to continue, you can go back and change your answer.</p>`;
    const actions = el("div", "actions");
    const back = el("button", "btn", "← Go back");
    back.onclick = () => { currentId = "consent"; saveDraft(); renderSurvey(); };
    const home = el("button", "btn btn-ghost", "Home");
    home.onclick = () => go("#/");
    actions.appendChild(back);
    actions.appendChild(home);
    c.appendChild(actions);
    return c;
  }

  function ineligibleState() {
    const c = el("div", "state-card card");
    c.innerHTML = `
      <h2>Thank you for your time and response</h2>
      <p>You made a great contribution to the development of the community</p>`;
    const actions = el("div", "actions");
    const home = el("button", "btn", "Go home");
    home.onclick = () => go("#/");
    actions.appendChild(home);
    c.appendChild(actions);
    return c;
  }

  // One-time halfway acknowledgment: colorful trophy moment, auto-dismissed.
  function showChampionToast() {
    const backdrop = el("div", "champion-backdrop");
    const t = el("div", "champion-toast");
    const celebrationTrophy = '<svg viewBox="0 0 64 64" aria-hidden="true"><path fill="#f7c948" d="M20 8h24v10c0 8.8-5.4 15.6-12 15.6S20 26.8 20 18V8Z"/><path fill="#f0b429" d="M24 12h16v6.5c0 6.4-3.5 11.1-8 11.1s-8-4.7-8-11.1V12Z"/><path fill="#d99a12" d="M18.8 13H10v5.2c0 8 5.4 13.8 13 14.7l1.2-5.3c-5.5-.5-9.2-4.2-9.2-9.4V18h4.4l-.6-5Z"/><path fill="#d99a12" d="M45.2 13H54v5.2c0 8-5.4 13.8-13 14.7l-1.2-5.3c5.5-.5 9.2-4.2 9.2-9.4V18h-4.4l.6-5Z"/><path fill="#c58a10" d="M29 33h6v10h-6z"/><path fill="#f7c948" d="M23 43h18l3 9H20l3-9Z"/><path fill="#d99a12" d="M17 52h30v5H17z"/><path fill="#fff3bf" d="M25 11h7c-3.6 2.3-5.4 6.1-5.4 11.4 0 2.1.3 4 .9 5.6-3-2.2-4.5-5.5-4.5-9.9V11Z"/></svg>';
    t.innerHTML = `<span class="champion-toast-trophy">${celebrationTrophy}</span><div class="champion-toast-text"><b>Halfway there</b><span>Thank you for sharing your experience.</span></div>`;
    document.body.appendChild(backdrop);
    document.body.appendChild(t);
    requestAnimationFrame(() => { backdrop.classList.add("show"); t.classList.add("show"); });
    setTimeout(() => {
      t.classList.remove("show");
      backdrop.classList.remove("show");
      setTimeout(() => { t.remove(); backdrop.remove(); }, 420);
    }, 120000);
  }

  function inviteCompletedState() {
    const c = el("div", "state-card card");
    c.innerHTML = `
      <h2>You've already completed this survey</h2>
      <p>Thank you — your response has been recorded. There's no need to fill it out again.</p>`;
    return c;
  }

  function submit() {
    const root = $("#survey-root");
    root.innerHTML = "";
    const saving = el("div", "state-card card");
    saving.innerHTML = `<h2>Saving your response…</h2><p>One moment.</p>`;
    root.appendChild(saving);

    fetch("/api/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ respondent_id: respondentId, answers }),
    })
      .then((r) => { if (!r.ok) throw new Error("save_failed"); return r.json(); })
      .then(() => {
        localStorage.removeItem(SS_DRAFT);
        // lock the personal link so it can't be retaken
        if (inviteToken) { inviteCompleted = true; localStorage.removeItem(INVITE_KEY); }
        answers = {}; currentId = QUESTIONS[0].id; respondentId = null; halfwayShown = false;
        root.innerHTML = "";
        const done = el("div", "state-card card");
        done.innerHTML = `
          <span class="champion-trophy">${TROPHY_SVG}</span>
          <h2>You're a Survey Champion</h2>
          <p>Thank you for your time and response. You made a great contribution to the development of the community.</p>`;
        const actions = el("div", "actions");
        const b1 = el("button", "btn", "Back to home");
        b1.onclick = () => go("#/");
        actions.appendChild(b1);
        done.appendChild(actions);
        root.appendChild(done);
      })
      .catch(() => {
        root.innerHTML = "";
        const err = el("div", "state-card card");
        err.innerHTML = `
          <h2>We couldn't save your response</h2>
          <p>Something went wrong reaching the server. Your answers are still saved on this device — please try again.</p>`;
        const actions = el("div", "actions");
        const retry = el("button", "btn", "Try again");
        retry.onclick = () => submit();
        actions.appendChild(retry);
        err.appendChild(actions);
        root.appendChild(err);
      });
  }

  // ── admin (data from the API) ──────────────────────────────
  async function renderAdmin() {
    const root = $("#admin-root");
    root.innerHTML = "";
    if (!adminAuthed) {
      // restore an existing session (httpOnly cookie) if present
      try { if ((await fetch("/api/me").then((r) => r.json())).authed) adminAuthed = true; } catch (e) {}
      if (!adminAuthed) { root.appendChild(gateCard()); return; }
    }

    let stats = null;
    try { stats = await fetch("/api/stats").then((r) => (r.ok ? r.json() : null)); } catch (e) { stats = null; }
    const completed = stats ? stats.completed : 0;
    const started = stats ? stats.started : 0;
    const optins = stats ? stats.optins : 0;
    const completion = started ? Math.round((completed / started) * 100) : 0;

    const shell = el("div", "admin-shell");

    // ── left rail (sidebar) ─────────────────────────────────
    const rail = el("aside", "admin-rail");

    const exp = el("div", "export-menu");
    const expBtn = el("button", "rail-btn rail-btn-primary", `<span aria-hidden="true">↓</span> Export <span class="export-caret" aria-hidden="true">▾</span>`);
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

    rail.appendChild(el("div", "rail-spacer"));

    const foot = el("div", "rail-foot");
    const outBtn = el("button", "rail-btn rail-btn-ghost", "Log out");
    outBtn.onclick = async () => { try { await fetch("/api/logout", { method: "POST" }); } catch (e) {} adminAuthed = false; renderAdmin(); };
    foot.appendChild(outBtn);
    rail.appendChild(foot);

    shell.appendChild(rail);

    // ── content ─────────────────────────────────────────────
    const content = el("div", "admin-content");
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

  function renderInviteList(container, invites) {
    container.innerHTML = "";
    if (!invites.length) {
      return;
    }
    const base = location.origin;
    const done = invites.filter((i) => i.completed).length;
    const head = el("div", "invite-summary");
    head.appendChild(el("span", null, `${done} of ${invites.length} completed`));
    const exp = el("button", "btn btn-sm btn-ghost", "Export non-completers");
    exp.onclick = () => {
      const rows = [["email", "link"]];
      invites.filter((i) => !i.completed).forEach((i) => rows.push([i.email || "", `${base}/?t=${i.token}`]));
      const csv = rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c)).join(",")).join("\r\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
      a.download = "non-completers.csv"; a.click();
    };
    head.appendChild(exp);
    container.appendChild(head);

    const tbl = el("div", "invite-table");
    tbl.appendChild(parse(`<div class="invite-row invite-head"><span>Email</span><span>Status</span><span>Link</span></div>`));
    const body = el("div", "invite-table-body");
    invites.forEach((i) => {
      const status = i.completed ? "✅ Completed" : i.started ? "🟡 Started" : "⚪ Not started";
      const link = `${base}/?t=${i.token}`;
      const row = el("div", "invite-row");
      row.appendChild(el("span", "invite-email", esc(i.email || "—")));
      row.appendChild(el("span", "invite-status" + (i.completed ? " done" : ""), status));
      const cell = el("span", "invite-link");
      const copy = el("button", "btn-copy", "Copy link");
      copy.onclick = () => navigator.clipboard.writeText(link).then(() => { copy.textContent = "Copied!"; setTimeout(() => (copy.textContent = "Copy link"), 1200); });
      cell.appendChild(copy);
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
        if (r.ok) { adminAuthed = true; renderAdmin(); return; }
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
