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

  // restore draft
  try {
    const d = JSON.parse(localStorage.getItem(SS_DRAFT) || "null");
    if (d && d.answers) { answers = d.answers; currentId = d.currentId || currentId; respondentId = d.respondentId || null; }
  } catch (e) {}

  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

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
    if (q.type === "rating") return v && q.skills.every(([k]) => v[k]);
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
  function startSurvey() {
    answers = {}; currentId = QUESTIONS[0].id; respondentId = null; saveDraft();
    go("#/survey");
    // create a respondent row so "started" is tracked (best-effort)
    fetch("/api/start", { method: "POST" })
      .then((r) => r.json())
      .then((d) => { if (d && d.id) { respondentId = d.id; saveDraft(); } })
      .catch(() => {});
  }

  // ── survey rendering ───────────────────────────────────────
  function renderSurvey() {
    const root = $("#survey-root");
    root.innerHTML = "";

    // consent / ineligible gates
    if (answers.consent === "I disagree") { root.appendChild(consentDeclinedState()); return; }
    if (answers.eligible === "No") { root.appendChild(ineligibleState()); return; }

    const list = visibleList();
    const pos = posOf(currentId);
    const q = list[pos];
    if (!q) { go("#/"); return; }

    // Compact respondent progress
    const total = list.length;
    const progress = Math.round(((pos + 1) / total) * 100);
    const prog = el("div", "progress-card");
    prog.innerHTML = `
      <div class="progress-top">
        <span class="progress-count">${pos + 1} / ${total}</span>
      </div>
      <div class="progress-track" aria-label="${progress}% complete">
        <span style="width:${progress}%"></span>
      </div>`;
    root.appendChild(prog);

    // question block
    const block = el("div", "q-block");
    block.appendChild(el("h2", "q-text", esc(q.text)));
    if (q.help) block.appendChild(el("p", "q-help", esc(q.help)));
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
    if (q.type === "textarea") return textareaControl(q);
    if (q.type === "rating") return ratingControl(q);
    if (q.type === "contact") return contactControl(q);
    return el("div");
  }

  function optionList(q, multi) {
    const wrap = el("div", "options");
    const keys = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    q.options.forEach((opt, i) => {
      const sel = multi ? (answers[q.id] || []).includes(opt) : answers[q.id] === opt;
      const btn = el("button", "opt" + (multi ? " multi" : "") + (sel ? " on" : ""));
      btn.innerHTML = `<span class="opt-mark"></span><span class="opt-label">${esc(opt)}</span><span class="opt-key">${keys[i] || ""}</span>`;
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
    q.options.forEach((option) => {
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

  function ratingControl(q) {
    const v = answers[q.id] || {};
    const grid = el("div", "grid-rate");
    q.skills.forEach(([key, name, desc]) => {
      const row = el("div", "rate-row");
      row.appendChild(el("div", "rate-name", desc ? `${esc(name)}<span>${esc(desc)}</span>` : esc(name)));
      const scale = el("div", "rate-scale");
      for (let n = 1; n <= 5; n++) {
        const dot = el("button", "rate-dot" + (v[key] === n ? " on" : ""), String(n));
        dot.onclick = () => {
          answers[q.id] = answers[q.id] || {};
          answers[q.id][key] = n;
          scale.querySelectorAll(".rate-dot").forEach((d) => d.classList.remove("on"));
          dot.classList.add("on");
          updateNav(q); saveDraft();
        };
        scale.appendChild(dot);
      }
      row.appendChild(scale);
      grid.appendChild(row);
    });
    const wrap = el("div");
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
        answers = {}; currentId = QUESTIONS[0].id; respondentId = null;
        root.innerHTML = "";
        const done = el("div", "state-card card");
        done.innerHTML = `
          <h2>Thank you for your time and response</h2>
          <p>You made a great contribution to the development of the community.</p>`;
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

    const expBtn = el("button", "rail-btn rail-btn-primary", `<span aria-hidden="true">↓</span> Export`);
    expBtn.disabled = completed === 0;
    expBtn.onclick = exportCSV;
    rail.appendChild(expBtn);
    rail.appendChild(el("div", "rail-meta", `${completed} responses · CSV`));

    rail.appendChild(parse(`<div class="rail-section-label">Collaborators</div>`));
    rail.appendChild(collaboratorSection());

    rail.appendChild(el("div", "rail-spacer"));

    const foot = el("div", "rail-foot");
    const outBtn = el("button", "rail-btn rail-btn-ghost", "Log out");
    outBtn.onclick = async () => { try { await fetch("/api/logout", { method: "POST" }); } catch (e) {} adminAuthed = false; renderAdmin(); };
    foot.appendChild(outBtn);
    rail.appendChild(foot);

    shell.appendChild(rail);

    // ── content ─────────────────────────────────────────────
    const content = el("div", "admin-content");
    content.appendChild(parse(`<div class="admin-head"><h2>Survey responses</h2></div>`));

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
    content.appendChild(adminCharts(stats ? stats.series : []));

    shell.appendChild(content);
    root.appendChild(shell);
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
  document.addEventListener("DOMContentLoaded", () => {
    $("#start-btn").onclick = startSurvey;
    document.querySelectorAll("[data-start-survey]").forEach((n) => n.onclick = startSurvey);
    document.querySelectorAll("[data-go]").forEach((n) => n.onclick = () => go(n.getAttribute("data-go")));
    route();
  });
})();
