// ============================================================================
// Sault Newcomer Skills Survey — API + static host
// Serves the front-end and writes each submission into the 6-table schema.
// ============================================================================
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");
const ExcelJS = require("exceljs");
const JSZip = require("jszip");

const app = express();
app.set("trust proxy", 1); // honor X-Forwarded-Proto behind Railway/Render/Fly proxies
app.use(express.json({ limit: "1mb" }));

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgresql://sault:sault_dev_password@db:5432/sault_survey",
});

const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(__dirname, "public");

// ── auth (server-validated passcode → signed httpOnly session cookie) ───────
const ADMIN_PASSCODE = process.env.ADMIN_PASSCODE || "";               // super admin (full dashboard)
const INVITE_ADMIN_PASSCODE = process.env.INVITE_ADMIN_PASSCODE || ""; // invite-only admin
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours
const COOKIE = "sault_admin";

const sign = (v) => crypto.createHmac("sha256", SESSION_SECRET).update(v).digest("base64url");
const makeToken = (role) => { const exp = String(Date.now() + SESSION_TTL_MS); const payload = exp + "." + role; return payload + "." + sign(payload); };
// Returns the session role ("super" | "invite") or null if missing/invalid/expired.
function tokenRole(tok) {
  if (!tok || !SESSION_SECRET) return null;
  const parts = tok.split(".");
  if (parts.length !== 3) return null;
  const [exp, role, sig] = parts;
  let ok = false;
  try { ok = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign(exp + "." + role))); } catch (e) { ok = false; }
  if (!ok || !(Number(exp) > Date.now())) return null;
  return role === "super" || role === "invite" ? role : null;
}
function safeEqual(a, b) {
  const ab = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
const isHttps = (req) => req.secure || (req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
function setSession(req, res, tok) {
  const parts = [`${COOKIE}=${tok}`, "HttpOnly", "Path=/", "SameSite=Lax", `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`];
  if (isHttps(req)) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}
function clearSession(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}
function requireAuth(req, res, next) {
  const role = tokenRole(parseCookies(req)[COOKIE]);
  if (!role) return res.status(401).json({ error: "unauthorized" });
  req.adminRole = role;
  next();
}
function requireSuperAdmin(req, res, next) {
  const role = tokenRole(parseCookies(req)[COOKIE]);
  if (!role) return res.status(401).json({ error: "unauthorized" });
  if (role !== "super") return res.status(403).json({ error: "forbidden" });
  req.adminRole = role;
  next();
}

app.post("/api/login", (req, res) => {
  if (!ADMIN_PASSCODE || !SESSION_SECRET) return res.status(500).json({ error: "auth_not_configured" });
  const pass = (req.body && req.body.passcode) || "";
  if (safeEqual(pass, ADMIN_PASSCODE)) { setSession(req, res, makeToken("super")); return res.json({ ok: true, role: "super" }); }
  if (INVITE_ADMIN_PASSCODE && safeEqual(pass, INVITE_ADMIN_PASSCODE)) { setSession(req, res, makeToken("invite")); return res.json({ ok: true, role: "invite" }); }
  res.status(401).json({ error: "bad_passcode" });
});
app.post("/api/logout", (_req, res) => { clearSession(res); res.json({ ok: true }); });
app.get("/api/me", (req, res) => { const role = tokenRole(parseCookies(req)[COOKIE]); res.json({ authed: !!role, role: role || null }); });

// ── helpers ────────────────────────────────────────────────────────────────
const yn = (v) => (v === "Yes" ? true : v === "No" ? false : null);
const consent = (v) => (v === "I agree" ? true : v === "I disagree" ? false : null);
const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const txt = (v) => (v == null || v === "" ? null : String(v));
const rating = (v) => (typeof v === "number" && v >= 1 && v <= 5 ? v : null);

// ── API ────────────────────────────────────────────────────────────────────

// Create a respondent row when the survey is started (tracks "started").
const HOME_VARIANTS = ["HP1", "HP2", "HP3"];
const variant = (v) => (HOME_VARIANTS.includes(v) ? v : null);

// Count one homepage impression (which A/B/C variant a visitor saw).
app.post("/api/home-view", async (req, res) => {
  try {
    const v = variant(req.body && req.body.variant);
    if (!v) return res.status(400).json({ error: "bad_variant" });
    await pool.query("INSERT INTO home_impressions (variant) VALUES ($1)", [v]);
    res.json({ ok: true });
  } catch (e) {
    console.error("home-view", e);
    res.status(500).json({ error: "view_failed" });
  }
});

app.post("/api/start", async (req, res) => {
  try {
    const v = variant(req.body && req.body.variant);
    const tok = (req.body && req.body.token) || null;
    if (tok) {
      const inv = await pool.query("SELECT 1 FROM invites WHERE token = $1", [tok]);
      if (inv.rowCount) {
        // One respondent per invite token, race-safe: rely on the UNIQUE index on
        // invite_token. Concurrent re-clicks → only one row inserted; the rest fall
        // through to ON CONFLICT DO NOTHING and reuse the existing row.
        const r = await pool.query(
          `INSERT INTO respondents (home_variant, channel, invite_token)
             VALUES ($1,'invite',$2)
             ON CONFLICT (invite_token) DO NOTHING RETURNING id`,
          [v, tok]
        );
        if (r.rowCount) return res.json({ id: r.rows[0].id, channel: "invite" });
        const ex = await pool.query("SELECT id FROM respondents WHERE invite_token = $1", [tok]);
        return res.json({ id: ex.rows[0].id, channel: "invite" });
      }
    }
    const r = await pool.query(
      "INSERT INTO respondents (home_variant, channel) VALUES ($1,'public') RETURNING id", [v]
    );
    res.json({ id: r.rows[0].id, channel: "public" });
  } catch (e) {
    console.error("start", e);
    res.status(500).json({ error: "start_failed" });
  }
});

// Public: check a personal link's token — is it valid, and already completed?
app.get("/api/invite", async (req, res) => {
  try {
    const tok = req.query.t;
    if (!tok) return res.json({ valid: false });
    const inv = await pool.query("SELECT 1 FROM invites WHERE token = $1", [tok]);
    if (!inv.rowCount) return res.json({ valid: false });
    const done = await pool.query(
      "SELECT 1 FROM respondents WHERE invite_token = $1 AND completed_at IS NOT NULL LIMIT 1", [tok]
    );
    res.json({ valid: true, completed: done.rowCount > 0 });
  } catch (e) {
    console.error("invite", e);
    res.status(500).json({ error: "invite_failed" });
  }
});

// Admin: list invites with derived status (not_started / started / completed).
app.get("/api/invites", requireAuth, async (_req, res) => {
  try {
    const rows = (await pool.query(`
      SELECT i.token, i.email, i.label, i.created_at,
             EXISTS (SELECT 1 FROM respondents r WHERE r.invite_token = i.token) AS started,
             EXISTS (SELECT 1 FROM respondents r WHERE r.invite_token = i.token AND r.completed_at IS NOT NULL) AS completed,
             (SELECT max(r.completed_at) FROM respondents r WHERE r.invite_token = i.token) AS completed_at
        FROM invites i
       ORDER BY i.created_at, i.email`)).rows;
    res.json({ invites: rows });
  } catch (e) {
    console.error("invites", e);
    res.status(500).json({ error: "invites_failed" });
  }
});

// Admin: create invites (one unique token per email) and return their tokens.
app.post("/api/invites", requireAuth, async (req, res) => {
  try {
    const emails = (req.body && req.body.emails) || [];
    const created = [];
    for (const raw of emails) {
      const email = String(raw || "").trim();
      if (!email) continue;
      const token = crypto.randomBytes(9).toString("base64url");
      await pool.query("INSERT INTO invites (token, email) VALUES ($1,$2)", [token, email]);
      created.push({ token, email });
    }
    res.json({ created });
  } catch (e) {
    console.error("invites_create", e);
    res.status(500).json({ error: "invites_create_failed" });
  }
});

// Save a complete submission into respondents + the five section tables.
const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET || "";
// Server-side CAPTCHA check so a bot can't skip the widget and POST directly.
async function verifyTurnstile(token, ip) {
  if (!TURNSTILE_SECRET) return true; // not configured (e.g. local dev) → don't block
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret: TURNSTILE_SECRET, response: String(token) });
    if (ip) body.append("remoteip", ip);
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const j = await r.json();
    return !!j.success;
  } catch (e) { return false; }
}

app.post("/api/submissions", async (req, res) => {
  const captchaOk = await verifyTurnstile(
    req.body && req.body.captcha_token,
    (req.headers["cf-connecting-ip"] || "").toString() || (req.socket && req.socket.remoteAddress) || ""
  );
  if (!captchaOk) return res.status(400).json({ error: "captcha_failed" });
  const a = (req.body && req.body.answers) || {};
  const sk = a.skills || {};
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let id = req.body && req.body.respondent_id;
    if (id) {
      const u = await client.query(
        `UPDATE respondents
           SET consent_agreed=$2, moved_after_dec_2021=$3, moved_from=$4, province_moved_from=$5,
               country_moved_from=$6, gift_card_draw_opt_in=$7, gift_card_email=$8,
               language_preference=$9, completed_at=now()
         WHERE id=$1 RETURNING id`,
        [id, consent(a.consent), yn(a.eligible), txt(a.moved_from), txt(a.province), txt(a.country_moved_from), yn(a.gift_card_draw), txt(a.gift_card_email), txt(a.language)]
      );
      if (u.rowCount === 0) id = null; // stale id → fall through to insert
    }
    if (!id) {
      const r = await client.query(
        `INSERT INTO respondents
           (consent_agreed, moved_after_dec_2021, moved_from, province_moved_from, country_moved_from, gift_card_draw_opt_in, gift_card_email, language_preference, completed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now()) RETURNING id`,
        [consent(a.consent), yn(a.eligible), txt(a.moved_from), txt(a.province), txt(a.country_moved_from), yn(a.gift_card_draw), txt(a.gift_card_email), txt(a.language)]
      );
      id = r.rows[0].id;
    }

    // Section A — demographics
    await client.query(
      `INSERT INTO section_a_demographics
         (respondent_id, gender, age_group, identity_groups, immigration_category,
          non_permanent_resident_category, non_permanent_resident_other)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (respondent_id) DO UPDATE SET
         gender=EXCLUDED.gender, age_group=EXCLUDED.age_group,
         identity_groups=EXCLUDED.identity_groups,
         immigration_category=EXCLUDED.immigration_category,
         non_permanent_resident_category=EXCLUDED.non_permanent_resident_category,
         non_permanent_resident_other=EXCLUDED.non_permanent_resident_other`,
      [id, txt(a.gender), txt(a.age_group), arr(a.identity_groups), txt(a.immigration_category),
       txt(a.non_permanent_category), txt(a.non_permanent_other)]
    );

    // Section B — education
    await client.query(
      `INSERT INTO section_b_education
         (respondent_id, most_recent_credential, program_name, completed_location,
          is_highest_level, highest_level_credential, highest_level_program_name,
          current_program, current_program_name,
          program_name_other, highest_level_program_name_other, current_program_name_other)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (respondent_id) DO UPDATE SET
         most_recent_credential=EXCLUDED.most_recent_credential,
         program_name=EXCLUDED.program_name, completed_location=EXCLUDED.completed_location,
         is_highest_level=EXCLUDED.is_highest_level,
         highest_level_credential=EXCLUDED.highest_level_credential,
         highest_level_program_name=EXCLUDED.highest_level_program_name,
         current_program=EXCLUDED.current_program,
         current_program_name=EXCLUDED.current_program_name,
         program_name_other=EXCLUDED.program_name_other,
         highest_level_program_name_other=EXCLUDED.highest_level_program_name_other,
         current_program_name_other=EXCLUDED.current_program_name_other`,
      [id, txt(a.recent_credential), txt(a.program_name), txt(a.program_location),
       yn(a.highest_education), txt(a.highest_credential), txt(a.highest_program_name),
       txt(a.current_program), txt(a.current_program_name),
       txt(a.program_name_other), txt(a.highest_program_name_other), txt(a.current_program_name_other)]
    );

    // Section C — employment (v5 branched structure)
    await client.query(
      `INSERT INTO section_c_employment
         (respondent_id, employed_before_canada, recent_job_title_before_moving,
          home_employed_before, home_country_job_title,
          current_employment_status, current_job_title,
          current_job_same_as_intended, intended_job_title,
          job_search_helpers, job_search_helpers_other,
          work_barrier_gate, work_barriers, work_barriers_other, work_support, work_support_other,
          unemployed_intended_job_title, unemployed_barrier_gate,
          unemployment_reasons, unemployment_reasons_other,
          not_looking_reasons, not_looking_reasons_other,
          student_working, student_current_job_title, student_job_relevant,
          student_job_help, student_job_help_other,
          student_barrier_gate, student_barriers, student_barriers_other,
          student_support, student_support_other, planned_intended_job_title)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33)
       ON CONFLICT (respondent_id) DO UPDATE SET
         employed_before_canada=EXCLUDED.employed_before_canada,
         recent_job_title_before_moving=EXCLUDED.recent_job_title_before_moving,
         home_employed_before=EXCLUDED.home_employed_before,
         home_country_job_title=EXCLUDED.home_country_job_title,
         current_employment_status=EXCLUDED.current_employment_status,
         current_job_title=EXCLUDED.current_job_title,
         current_job_same_as_intended=EXCLUDED.current_job_same_as_intended,
         intended_job_title=EXCLUDED.intended_job_title,
         job_search_helpers=EXCLUDED.job_search_helpers,
         job_search_helpers_other=EXCLUDED.job_search_helpers_other,
         work_barrier_gate=EXCLUDED.work_barrier_gate,
         work_barriers=EXCLUDED.work_barriers, work_barriers_other=EXCLUDED.work_barriers_other,
         work_support=EXCLUDED.work_support, work_support_other=EXCLUDED.work_support_other,
         unemployed_intended_job_title=EXCLUDED.unemployed_intended_job_title,
         unemployed_barrier_gate=EXCLUDED.unemployed_barrier_gate,
         unemployment_reasons=EXCLUDED.unemployment_reasons,
         unemployment_reasons_other=EXCLUDED.unemployment_reasons_other,
         not_looking_reasons=EXCLUDED.not_looking_reasons,
         not_looking_reasons_other=EXCLUDED.not_looking_reasons_other,
         student_working=EXCLUDED.student_working,
         student_current_job_title=EXCLUDED.student_current_job_title,
         student_job_relevant=EXCLUDED.student_job_relevant,
         student_job_help=EXCLUDED.student_job_help,
         student_job_help_other=EXCLUDED.student_job_help_other,
         student_barrier_gate=EXCLUDED.student_barrier_gate,
         student_barriers=EXCLUDED.student_barriers, student_barriers_other=EXCLUDED.student_barriers_other,
         student_support=EXCLUDED.student_support, student_support_other=EXCLUDED.student_support_other,
         planned_intended_job_title=EXCLUDED.planned_intended_job_title`,
      [id, txt(a.employed_before), txt(a.previous_job_title),
       txt(a.home_emp_before), txt(a.home_country_job),
       txt(a.employment_status), txt(a.current_job_title),
       yn(a.intended_job), txt(a.intended_job_title),
       arr(a.job_search_help), txt(a.job_search_other),
       txt(a.work_barrier_gate), arr(a.work_barriers), txt(a.work_barriers_other), arr(a.work_support), txt(a.work_support_other),
       txt(a.unemployed_intended_job), txt(a.unemployed_barrier_gate),
       arr(a.unemployment_reasons), txt(a.unemployment_reasons_other),
       arr(a.not_looking_reasons), txt(a.not_looking_other),
       txt(a.student_working), txt(a.student_current_job), txt(a.student_job_relevant),
       arr(a.student_job_help), txt(a.student_job_help_other),
       txt(a.student_barrier_gate), arr(a.student_barriers), txt(a.student_barriers_other),
       arr(a.student_support), txt(a.student_support_other), txt(a.planned_intended_job)]
    );

    // Section D — skills (per-occupation OaSIS/NOC7 skills → JSONB { "Skill": 0-5 })
    const skJson = sk && Object.keys(sk).length ? JSON.stringify(sk) : null;
    await client.query(
      `INSERT INTO section_d_skills (respondent_id, skill_ratings)
       VALUES ($1,$2)
       ON CONFLICT (respondent_id) DO UPDATE SET skill_ratings=EXCLUDED.skill_ratings`,
      [id, skJson]
    );

    // (v5 has no flat Section E — barriers/support are stored per-branch in section_c above.)

    await client.query("COMMIT");
    res.json({ id });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("submit", e);
    res.status(500).json({ error: "submit_failed" });
  } finally {
    client.release();
  }
});

// Dashboard stats + 14-day daily series. (admin/collaborators only)
app.get("/api/stats", requireSuperAdmin, async (_req, res) => {
  try {
    const started = (await pool.query("SELECT count(*)::int c FROM respondents")).rows[0].c;
    const completed = (await pool.query(
      "SELECT count(*)::int c FROM respondents WHERE completed_at IS NOT NULL"
    )).rows[0].c;
    const optins = (await pool.query(
      "SELECT count(*)::int c FROM respondents WHERE completed_at IS NOT NULL AND gift_card_draw_opt_in IS TRUE"
    )).rows[0].c;
    const series = (await pool.query(
      `SELECT to_char(date_trunc('day', completed_at), 'YYYY-MM-DD') AS d, count(*)::int AS c
         FROM respondents
        WHERE completed_at IS NOT NULL AND completed_at > now() - interval '14 days'
        GROUP BY 1 ORDER BY 1`
    )).rows;
    // Homepage A/B/C funnel: views (impressions) → started → completed per variant.
    const views = (await pool.query(
      "SELECT variant, count(*)::int c FROM home_impressions GROUP BY variant"
    )).rows;
    const starts = (await pool.query(
      "SELECT home_variant v, count(*)::int started, count(*) FILTER (WHERE completed_at IS NOT NULL)::int completed FROM respondents WHERE home_variant IS NOT NULL GROUP BY home_variant"
    )).rows;
    const variants = HOME_VARIANTS.map((id) => {
      const vw = views.find((x) => x.variant === id);
      const st = starts.find((x) => x.v === id);
      return { variant: id, views: vw ? vw.c : 0, started: st ? st.started : 0, completed: st ? st.completed : 0 };
    });
    // Channel breakdown: invite vs public (started / completed).
    const chRows = (await pool.query(`
      SELECT coalesce(channel, 'public') ch,
             count(*)::int started,
             count(*) FILTER (WHERE completed_at IS NOT NULL)::int completed
        FROM respondents GROUP BY 1`)).rows;
    const channels = ["invite", "public"].map((ch) => {
      const r = chRows.find((x) => x.ch === ch);
      return { channel: ch, started: r ? r.started : 0, completed: r ? r.completed : 0 };
    });
    const invitesTotal = (await pool.query("SELECT count(*)::int c FROM invites")).rows[0].c;
    // Started & completed per homepage variant × channel (invite vs public).
    const vcRows = (await pool.query(`
      SELECT home_variant v, coalesce(channel, 'public') ch,
             count(*)::int started,
             count(*) FILTER (WHERE completed_at IS NOT NULL)::int completed
        FROM respondents WHERE home_variant IS NOT NULL
       GROUP BY 1, 2`)).rows;
    const variantChannels = [];
    HOME_VARIANTS.forEach((v) => ["invite", "public"].forEach((ch) => {
      const r = vcRows.find((x) => x.v === v && x.ch === ch);
      variantChannels.push({ variant: v, channel: ch, started: r ? r.started : 0, completed: r ? r.completed : 0 });
    }));
    // Gift-card draw entries deduped by email across both channels.
    const drawEntries = (await pool.query(
      "SELECT count(DISTINCT lower(gift_card_email))::int c FROM respondents WHERE completed_at IS NOT NULL AND gift_card_draw_opt_in IS TRUE AND gift_card_email IS NOT NULL AND gift_card_email <> ''"
    )).rows[0].c;
    res.json({ started, completed, optins, series, variants, variantChannels, channels, invitesTotal, drawEntries });
  } catch (e) {
    console.error("stats", e);
    res.status(500).json({ error: "stats_failed" });
  }
});

// ── v5 export translation layer ─────────────────────────────────────────────
// App columns are clean/readable; research exports use exact v5 field names.
// Columns not listed keep their own name (id, timestamps, channel, etc.).
const V5_FIELD_MAP = {
  language_preference: "language",
  consent_agreed: "cons", moved_after_dec_2021: "E1", moved_from: "E3",
  province_moved_from: "E3_b", country_moved_from: "E3_a", gift_card_draw_opt_in: "draw", gift_card_email: "email",
  gender: "A1", age_group: "A2", identity_groups: "A4", immigration_category: "A4_a",
  non_permanent_resident_category: "A4_b", non_permanent_resident_other: "A4_b_i",
  most_recent_credential: "B5", program_name: "B7", completed_location: "B8", is_highest_level: "B6",
  highest_level_credential: "B6_a", highest_level_program_name: "B6_a_i",
  current_program: "B6_b", current_program_name: "B6_b_i",
  program_name_other: "B7_other", highest_level_program_name_other: "B6_a_i_other",
  current_program_name_other: "B6_b_i_other",
  employed_before_canada: "C1_prev_emp", recent_job_title_before_moving: "C1_1_job_title",
  home_employed_before: "C1_3_duties", home_country_job_title: "C1_homeemp",
  current_employment_status: "C2_current", current_job_title: "C4_job_title",
  current_job_same_as_intended: "C8_match", intended_job_title: "C8_a_intended",
  job_search_helpers: "C7_help", job_search_helpers_other: "C7_other",
  work_barriers: "C_barrier_yes", work_barriers_other: "C_barrier_other",
  work_support: "C_support", work_support_other: "C_support_other",
  unemployed_intended_job_title: "C12_intended", unemployed_barrier_gate: "C_barrier_unm",
  unemployment_reasons: "C11_reason", unemployment_reasons_other: "C11_other",
  not_looking_reasons: "C14_reason", not_looking_reasons_other: "C14_other",
  student_working: "C_stu_working", student_current_job_title: "S4_job_title",
  student_job_relevant: "S8_match", student_job_help: "S7_help", student_job_help_other: "S7_other",
  student_barrier_gate: "S_barrier_a", student_barriers: "S_barrier_yes", student_barriers_other: "S_barrier_other",
  student_support: "S_support", student_support_other: "S_support_other",
  planned_intended_job_title: "S8_a_intended", skill_ratings: "D_skills",
};
const S_CASUAL = "Employed casual (less than 10 hours/week)", S_PART = "Employed part time (10-30 hours/week)";
const S_FULL = "Employed full time (30+ hours/week)", S_SELF = "Self-employed";
// Reconstruct v5's five mutually-exclusive working barrier gates from the single
// stored gate + (status × current_job_same_as_intended). Lossless.
function expandBarrierGates(row) {
  const g = row.work_barrier_gate, st = row.current_employment_status, it = row.current_job_same_as_intended;
  const o = { C_barrier_a: null, C_barrier_b: null, C_barrier_c: null, C_barrier_d: null, C_barrier_e: null };
  if (g == null || st == null) return o;
  const cp = st === S_CASUAL || st === S_PART;
  if (cp && it === true) o.C_barrier_a = g;
  else if (st === S_FULL && it === false) o.C_barrier_b = g;
  else if (cp && it === false) o.C_barrier_c = g;
  else if (st === S_SELF && it === true) o.C_barrier_d = g;
  else if (st === S_SELF && it === false) o.C_barrier_e = g;
  return o;
}
const GATE_COLS = ["C_barrier_a", "C_barrier_b", "C_barrier_c", "C_barrier_d", "C_barrier_e"];
// Occupation (picklist) columns store the readable label; exports also emit a
// derived <v5name>_oasis7 code column (e.g. "2123100") for exact v5.1 parity.
const OCC_FIELDS = new Set([
  "recent_job_title_before_moving", "home_country_job_title", "current_job_title",
  "intended_job_title", "unemployed_intended_job_title", "student_current_job_title",
  "planned_intended_job_title",
]);
const oasis7FromLabel = (v) => (v == null ? null : (String(v).split(" - ")[0].replace(/\D/g, "") || null));
// Turn a raw section row (or the joined row) into v5-named header + values.
// hasC=true injects the expanded gate columns and drops the raw work_barrier_gate.
// Each occupation column is followed by its derived <name>_oasis7 code column.
function toV5(cols, rows, hasC) {
  const keep = cols.filter((c) => !(hasC && c === "work_barrier_gate"));
  const outCols = [];
  for (const c of keep) {
    const name = V5_FIELD_MAP[c] || c;
    outCols.push({ src: c, name });
    if (OCC_FIELDS.has(c)) outCols.push({ src: c, name: name + "_oasis7", oasis7: true });
  }
  const header = outCols.map((o) => o.name).concat(hasC ? GATE_COLS : []);
  const outRows = rows.map((row) => {
    const vals = outCols.map((o) => (o.oasis7 ? oasis7FromLabel(row[o.src]) : row[o.src]));
    if (hasC) { const g = expandBarrierGates(row); return vals.concat(GATE_COLS.map((k) => g[k])); }
    return vals;
  });
  return { header, rows: outRows };
}

// ── per-table exports (5 tables — v5 dropped the flat Section E) ─────────────
// Each table for completed respondents only, in completion order.
const EXPORT_TABLES = [
  ["respondents", "SELECT r.* FROM respondents r WHERE r.completed_at IS NOT NULL ORDER BY r.completed_at"],
  ["section_a_demographics", "SELECT t.* FROM section_a_demographics t JOIN respondents r ON r.id=t.respondent_id WHERE r.completed_at IS NOT NULL ORDER BY r.completed_at"],
  ["section_b_education", "SELECT t.* FROM section_b_education t JOIN respondents r ON r.id=t.respondent_id WHERE r.completed_at IS NOT NULL ORDER BY r.completed_at"],
  ["section_c_employment", "SELECT t.* FROM section_c_employment t JOIN respondents r ON r.id=t.respondent_id WHERE r.completed_at IS NOT NULL ORDER BY r.completed_at"],
  ["section_d_skills", "SELECT t.respondent_id, t.skill_ratings FROM section_d_skills t JOIN respondents r ON r.id=t.respondent_id WHERE r.completed_at IS NOT NULL ORDER BY r.completed_at"],
];

const csvCell = (v) => {
  if (v == null) return "";
  let s = Array.isArray(v) ? v.join("; ")
        : v instanceof Date ? v.toISOString()
        : typeof v === "object" ? JSON.stringify(v)
        : String(v);
  if (/[",\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
};
const xlsxCell = (v) =>
  v == null ? null
  : Array.isArray(v) ? v.join("; ")
  : v instanceof Date ? v
  : typeof v === "object" ? JSON.stringify(v)
  : v;
const stamp = () => new Date().toISOString().slice(0, 10);

// ZIP of 6 CSVs (one file per table)
app.get("/api/export.zip", requireSuperAdmin, async (_req, res) => {
  try {
    const zip = new JSZip();
    for (const [name, sql] of EXPORT_TABLES) {
      const q = await pool.query(sql);
      const { header, rows } = toV5(q.fields.map((f) => f.name), q.rows, name === "section_c_employment");
      const lines = [header.join(",")];
      for (const r of rows) lines.push(r.map(csvCell).join(","));
      zip.file(`${name}.csv`, "﻿" + lines.join("\r\n"));
    }
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="sault-survey_tables_${stamp()}.zip"`);
    res.send(buf);
  } catch (e) {
    console.error("export.zip", e);
    res.status(500).send("export_failed");
  }
});

// Multi-sheet workbook (one sheet per table)
app.get("/api/export.xlsx", requireSuperAdmin, async (_req, res) => {
  try {
    const wb = new ExcelJS.Workbook();
    const sheetName = { respondents: "respondents", section_a_demographics: "A_demographics",
      section_b_education: "B_education", section_c_employment: "C_employment",
      section_d_skills: "D_skills" };
    for (const [name, sql] of EXPORT_TABLES) {
      const q = await pool.query(sql);
      const ws = wb.addWorksheet(sheetName[name] || name.slice(0, 31));
      const { header, rows } = toV5(q.fields.map((f) => f.name), q.rows, name === "section_c_employment");
      ws.addRow(header);
      for (const r of rows) ws.addRow(r.map(xlsxCell));
      ws.getRow(1).font = { bold: true };
    }
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="sault-survey_${stamp()}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error("export.xlsx", e);
    res.status(500).send("export_failed");
  }
});

// CSV export — one row per completed respondent, all sections joined. (admin/collaborators only)
app.get("/api/export.csv", requireSuperAdmin, async (_req, res) => {
  try {
    const q = await pool.query(`
      SELECT r.id, r.created_at, r.completed_at, r.language_preference, r.consent_agreed, r.moved_after_dec_2021, r.moved_from,
             r.province_moved_from, r.country_moved_from, r.gift_card_draw_opt_in, r.gift_card_email,
             a.gender, a.age_group, a.identity_groups, a.immigration_category,
             a.non_permanent_resident_category, a.non_permanent_resident_other,
             b.most_recent_credential, b.program_name, b.completed_location, b.is_highest_level,
             b.highest_level_credential, b.highest_level_program_name, b.current_program, b.current_program_name,
             b.program_name_other, b.highest_level_program_name_other, b.current_program_name_other,
             c.employed_before_canada, c.recent_job_title_before_moving, c.home_employed_before, c.home_country_job_title,
             c.current_employment_status, c.current_job_title, c.current_job_same_as_intended, c.intended_job_title,
             c.job_search_helpers, c.job_search_helpers_other,
             c.work_barrier_gate, c.work_barriers, c.work_barriers_other, c.work_support, c.work_support_other,
             c.unemployed_intended_job_title, c.unemployed_barrier_gate, c.unemployment_reasons, c.unemployment_reasons_other,
             c.not_looking_reasons, c.not_looking_reasons_other,
             c.student_working, c.student_current_job_title, c.student_job_relevant, c.student_job_help, c.student_job_help_other,
             c.student_barrier_gate, c.student_barriers, c.student_barriers_other, c.student_support, c.student_support_other,
             c.planned_intended_job_title, d.skill_ratings
        FROM respondents r
        LEFT JOIN section_a_demographics a ON a.respondent_id = r.id
        LEFT JOIN section_b_education b ON b.respondent_id = r.id
        LEFT JOIN section_c_employment c ON c.respondent_id = r.id
        LEFT JOIN section_d_skills d ON d.respondent_id = r.id
       WHERE r.completed_at IS NOT NULL
       ORDER BY r.completed_at`);

    const { header, rows: outRows } = toV5(q.fields.map((f) => f.name), q.rows, true);
    const cell = (v) => {
      if (v == null) return "";
      let s = Array.isArray(v) ? v.join("; ")
            : v instanceof Date ? v.toISOString()
            : typeof v === "object" ? JSON.stringify(v)
            : String(v);
      if (/[",\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
      return s;
    };
    const rows = [header.join(",")];
    for (const r of outRows) rows.push(r.map(cell).join(","));
    const csv = "﻿" + rows.join("\r\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="sault-survey_${new Date().toISOString().slice(0, 10)}.csv"`
    );
    res.send(csv);
  } catch (e) {
    console.error("export", e);
    res.status(500).send("export_failed");
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ── static front-end (same origin, no CORS needed) ──────────────────────────
// No-store so respondents/admins always get the latest HTML/CSS/JS (no stale cache).
app.use(express.static(PUBLIC_DIR, {
  dotfiles: "ignore",
  etag: false,
  lastModified: false,
  setHeaders: (res) => res.setHeader("Cache-Control", "no-store, must-revalidate"),
}));

// Idempotent schema — created on startup so a fresh database (e.g. Railway) is
// ready without running any SQL by hand. Safe to run every boot (IF NOT EXISTS).
const SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS respondents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consent_agreed BOOLEAN,
  moved_after_dec_2021 BOOLEAN,
  moved_from TEXT, province_moved_from TEXT, country_moved_from TEXT,
  gift_card_draw_opt_in BOOLEAN, gift_card_email TEXT,
  home_variant TEXT, channel TEXT, invite_token TEXT,
  created_at TIMESTAMPTZ DEFAULT now(), completed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_respondents_invite_token ON respondents (invite_token);
CREATE INDEX IF NOT EXISTS idx_respondents_created_at ON respondents (created_at);
CREATE TABLE IF NOT EXISTS invites (
  id SERIAL PRIMARY KEY, token TEXT UNIQUE NOT NULL, email TEXT, label TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS home_impressions (
  id SERIAL PRIMARY KEY, variant TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS section_a_demographics (
  id SERIAL PRIMARY KEY,
  respondent_id UUID NOT NULL REFERENCES respondents(id) ON DELETE CASCADE UNIQUE,
  gender TEXT, age_group TEXT, identity_groups TEXT[], immigration_category TEXT,
  non_permanent_resident_category TEXT, non_permanent_resident_other TEXT
);
CREATE TABLE IF NOT EXISTS section_b_education (
  id SERIAL PRIMARY KEY,
  respondent_id UUID NOT NULL REFERENCES respondents(id) ON DELETE CASCADE UNIQUE,
  most_recent_credential TEXT, program_name TEXT, completed_location TEXT,
  institution_name TEXT, completion_year TEXT, is_highest_level BOOLEAN,
  highest_level_credential TEXT, highest_level_program_name TEXT
);
CREATE TABLE IF NOT EXISTS section_c_employment (
  id SERIAL PRIMARY KEY,
  respondent_id UUID NOT NULL REFERENCES respondents(id) ON DELETE CASCADE UNIQUE,
  employed_before_moving BOOLEAN, recent_job_title_before_moving TEXT, main_duties_before_moving TEXT,
  current_employment_status TEXT, annual_income_range TEXT, current_job_title TEXT,
  current_occupation_sector TEXT, current_occupation_group TEXT,
  months_to_find_first_job TEXT, job_search_helpers TEXT[], job_search_helpers_other TEXT,
  current_job_same_as_intended BOOLEAN, intended_job_title TEXT,
  part_time_reasons TEXT[], part_time_reasons_other TEXT,
  months_unemployed TEXT, unemployment_reasons TEXT[], unemployment_reasons_other TEXT,
  unemployed_intended_job_title TEXT, unemployed_occupation_sector TEXT, unemployed_occupation_group TEXT,
  not_looking_reasons TEXT[], not_looking_reasons_other TEXT,
  planned_occupation_sector TEXT, planned_occupation_group TEXT, planned_intended_job_title TEXT
);
CREATE TABLE IF NOT EXISTS section_d_skills (
  id SERIAL PRIMARY KEY,
  respondent_id UUID NOT NULL REFERENCES respondents(id) ON DELETE CASCADE UNIQUE,
  critical_thinking INT CHECK (critical_thinking BETWEEN 1 AND 5),
  problem_solving INT CHECK (problem_solving BETWEEN 1 AND 5),
  systems_analysis INT CHECK (systems_analysis BETWEEN 1 AND 5),
  oral_comprehension INT CHECK (oral_comprehension BETWEEN 1 AND 5),
  oral_expression INT CHECK (oral_expression BETWEEN 1 AND 5),
  learning_strategies INT CHECK (learning_strategies BETWEEN 1 AND 5),
  quality_control_testing INT CHECK (quality_control_testing BETWEEN 1 AND 5),
  decision_making INT CHECK (decision_making BETWEEN 1 AND 5),
  writing INT CHECK (writing BETWEEN 1 AND 5),
  skill_ratings JSONB,
  local_job_opportunity_knowledge TEXT, local_training_opportunity_knowledge TEXT
);
CREATE TABLE IF NOT EXISTS section_e_barriers_challenges (
  id SERIAL PRIMARY KEY,
  respondent_id UUID NOT NULL REFERENCES respondents(id) ON DELETE CASCADE UNIQUE,
  barriers_to_finding_job TEXT[], barriers_other TEXT,
  support_needed TEXT[], support_other TEXT,
  challenges_applying_jobs TEXT[], challenges_other TEXT,
  tried_employment_support_service BOOLEAN, service_access_challenges TEXT[], service_access_other TEXT
);
-- v8 migration: language preference (Phase 1 — records preferred language only).
ALTER TABLE respondents ADD COLUMN IF NOT EXISTS language_preference TEXT;
-- v5 migration: new columns (idempotent). Old columns are left in place unused.
ALTER TABLE section_b_education ADD COLUMN IF NOT EXISTS current_program TEXT;
ALTER TABLE section_b_education ADD COLUMN IF NOT EXISTS current_program_name TEXT;
ALTER TABLE section_b_education ADD COLUMN IF NOT EXISTS program_name_other TEXT;
ALTER TABLE section_b_education ADD COLUMN IF NOT EXISTS highest_level_program_name_other TEXT;
ALTER TABLE section_b_education ADD COLUMN IF NOT EXISTS current_program_name_other TEXT;
ALTER TABLE section_c_employment ADD COLUMN IF NOT EXISTS employed_before_canada TEXT;
ALTER TABLE section_c_employment ADD COLUMN IF NOT EXISTS home_employed_before TEXT;
ALTER TABLE section_c_employment ADD COLUMN IF NOT EXISTS home_country_job_title TEXT;
ALTER TABLE section_c_employment ADD COLUMN IF NOT EXISTS work_barrier_gate TEXT;
ALTER TABLE section_c_employment ADD COLUMN IF NOT EXISTS work_barriers TEXT[];
ALTER TABLE section_c_employment ADD COLUMN IF NOT EXISTS work_barriers_other TEXT;
ALTER TABLE section_c_employment ADD COLUMN IF NOT EXISTS work_support TEXT[];
ALTER TABLE section_c_employment ADD COLUMN IF NOT EXISTS work_support_other TEXT;
ALTER TABLE section_c_employment ADD COLUMN IF NOT EXISTS unemployed_barrier_gate TEXT;
ALTER TABLE section_c_employment ADD COLUMN IF NOT EXISTS student_working TEXT;
ALTER TABLE section_c_employment ADD COLUMN IF NOT EXISTS student_current_job_title TEXT;
ALTER TABLE section_c_employment ADD COLUMN IF NOT EXISTS student_job_relevant TEXT;
ALTER TABLE section_c_employment ADD COLUMN IF NOT EXISTS student_job_help TEXT[];
ALTER TABLE section_c_employment ADD COLUMN IF NOT EXISTS student_job_help_other TEXT;
ALTER TABLE section_c_employment ADD COLUMN IF NOT EXISTS student_barrier_gate TEXT;
ALTER TABLE section_c_employment ADD COLUMN IF NOT EXISTS student_barriers TEXT[];
ALTER TABLE section_c_employment ADD COLUMN IF NOT EXISTS student_barriers_other TEXT;
ALTER TABLE section_c_employment ADD COLUMN IF NOT EXISTS student_support TEXT[];
ALTER TABLE section_c_employment ADD COLUMN IF NOT EXISTS student_support_other TEXT;
`;

async function initSchema() {
  try { await pool.query(SCHEMA_SQL); console.log("schema ready"); }
  catch (e) { console.error("schema init failed:", e.message); }
}

const PORT = process.env.PORT || 3000;
initSchema().finally(() =>
  app.listen(PORT, () => console.log(`Sault survey API + site on http://localhost:${PORT}`))
);
