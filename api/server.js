// ============================================================================
// Sault Newcomer Skills Survey — API + static host
// Serves the front-end and writes each submission into the 6-table schema.
// ============================================================================
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

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
const ADMIN_PASSCODE = process.env.ADMIN_PASSCODE || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours
const COOKIE = "sault_admin";

const sign = (v) => crypto.createHmac("sha256", SESSION_SECRET).update(v).digest("base64url");
const makeToken = () => { const exp = String(Date.now() + SESSION_TTL_MS); return exp + "." + sign(exp); };
function validToken(tok) {
  if (!tok || !SESSION_SECRET) return false;
  const i = tok.indexOf(".");
  if (i < 0) return false;
  const exp = tok.slice(0, i), sig = tok.slice(i + 1);
  let ok = false;
  try { ok = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign(exp))); } catch (e) { ok = false; }
  return ok && Number(exp) > Date.now();
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
  if (validToken(parseCookies(req)[COOKIE])) return next();
  res.status(401).json({ error: "unauthorized" });
}

app.post("/api/login", (req, res) => {
  if (!ADMIN_PASSCODE || !SESSION_SECRET) return res.status(500).json({ error: "auth_not_configured" });
  const pass = (req.body && req.body.passcode) || "";
  if (safeEqual(pass, ADMIN_PASSCODE)) { setSession(req, res, makeToken()); return res.json({ ok: true }); }
  res.status(401).json({ error: "bad_passcode" });
});
app.post("/api/logout", (_req, res) => { clearSession(res); res.json({ ok: true }); });
app.get("/api/me", (req, res) => res.json({ authed: validToken(parseCookies(req)[COOKIE]) }));

// ── helpers ────────────────────────────────────────────────────────────────
const yn = (v) => (v === "Yes" ? true : v === "No" ? false : null);
const consent = (v) => (v === "I agree" ? true : v === "I disagree" ? false : null);
const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const txt = (v) => (v == null || v === "" ? null : String(v));
const rating = (v) => (typeof v === "number" && v >= 1 && v <= 5 ? v : null);

// ── API ────────────────────────────────────────────────────────────────────

// Create a respondent row when the survey is started (tracks "started").
app.post("/api/start", async (_req, res) => {
  try {
    const r = await pool.query("INSERT INTO respondents DEFAULT VALUES RETURNING id");
    res.json({ id: r.rows[0].id });
  } catch (e) {
    console.error("start", e);
    res.status(500).json({ error: "start_failed" });
  }
});

// Save a complete submission into respondents + the five section tables.
app.post("/api/submissions", async (req, res) => {
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
               gift_card_draw_opt_in=$6, gift_card_email=$7, completed_at=now()
         WHERE id=$1 RETURNING id`,
        [id, consent(a.consent), yn(a.eligible), txt(a.moved_from), txt(a.province), yn(a.gift_card_draw), txt(a.gift_card_email)]
      );
      if (u.rowCount === 0) id = null; // stale id → fall through to insert
    }
    if (!id) {
      const r = await client.query(
        `INSERT INTO respondents
           (consent_agreed, moved_after_dec_2021, moved_from, province_moved_from, gift_card_draw_opt_in, gift_card_email, completed_at)
         VALUES ($1,$2,$3,$4,$5,$6,now()) RETURNING id`,
        [consent(a.consent), yn(a.eligible), txt(a.moved_from), txt(a.province), yn(a.gift_card_draw), txt(a.gift_card_email)]
      );
      id = r.rows[0].id;
    }

    // Section A — demographics
    await client.query(
      `INSERT INTO section_a_demographics
         (respondent_id, gender, age_group, identity_groups, non_permanent_resident_category)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (respondent_id) DO UPDATE SET
         gender=EXCLUDED.gender, age_group=EXCLUDED.age_group,
         identity_groups=EXCLUDED.identity_groups,
         non_permanent_resident_category=EXCLUDED.non_permanent_resident_category`,
      [id, txt(a.gender), txt(a.age_group), arr(a.identity_groups), txt(a.non_permanent_category)]
    );

    // Section B — education
    await client.query(
      `INSERT INTO section_b_education
         (respondent_id, most_recent_credential, program_name, completed_location,
          institution_name, completion_year, is_highest_level)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (respondent_id) DO UPDATE SET
         most_recent_credential=EXCLUDED.most_recent_credential,
         program_name=EXCLUDED.program_name, completed_location=EXCLUDED.completed_location,
         institution_name=EXCLUDED.institution_name, completion_year=EXCLUDED.completion_year,
         is_highest_level=EXCLUDED.is_highest_level`,
      [id, txt(a.recent_credential), txt(a.program_name), txt(a.program_location),
       txt(a.institution_name), txt(a.program_completion_year), yn(a.highest_education)]
    );

    // Section C — employment
    await client.query(
      `INSERT INTO section_c_employment
         (respondent_id, employed_before_moving, recent_job_title_before_moving,
          main_duties_before_moving, current_employment_status, annual_income_range,
          current_job_title, current_occupation_sector, current_occupation_group,
          months_to_find_first_job, job_search_helpers, current_job_same_as_intended)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (respondent_id) DO UPDATE SET
         employed_before_moving=EXCLUDED.employed_before_moving,
         recent_job_title_before_moving=EXCLUDED.recent_job_title_before_moving,
         main_duties_before_moving=EXCLUDED.main_duties_before_moving,
         current_employment_status=EXCLUDED.current_employment_status,
         annual_income_range=EXCLUDED.annual_income_range,
         current_job_title=EXCLUDED.current_job_title,
         current_occupation_sector=EXCLUDED.current_occupation_sector,
         current_occupation_group=EXCLUDED.current_occupation_group,
         months_to_find_first_job=EXCLUDED.months_to_find_first_job,
         job_search_helpers=EXCLUDED.job_search_helpers,
         current_job_same_as_intended=EXCLUDED.current_job_same_as_intended`,
      [id, yn(a.employed_before), txt(a.previous_job_title), txt(a.previous_job_duties),
       txt(a.employment_status), txt(a.individual_income), txt(a.current_job_title),
       txt(a.occupation_sector), txt(a.occupation_group), txt(a.first_job_search_time),
       arr(a.job_search_help), yn(a.intended_job)]
    );

    // Section D — skills
    await client.query(
      `INSERT INTO section_d_skills
         (respondent_id, critical_thinking, problem_solving, systems_analysis,
          oral_comprehension, oral_expression, learning_strategies, quality_control_testing,
          decision_making, writing, local_job_opportunity_knowledge, local_training_opportunity_knowledge)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (respondent_id) DO UPDATE SET
         critical_thinking=EXCLUDED.critical_thinking, problem_solving=EXCLUDED.problem_solving,
         systems_analysis=EXCLUDED.systems_analysis, oral_comprehension=EXCLUDED.oral_comprehension,
         oral_expression=EXCLUDED.oral_expression, learning_strategies=EXCLUDED.learning_strategies,
         quality_control_testing=EXCLUDED.quality_control_testing, decision_making=EXCLUDED.decision_making,
         writing=EXCLUDED.writing,
         local_job_opportunity_knowledge=EXCLUDED.local_job_opportunity_knowledge,
         local_training_opportunity_knowledge=EXCLUDED.local_training_opportunity_knowledge`,
      [id, rating(sk.critical_thinking), rating(sk.problem_solving), rating(sk.systems_analysis),
       rating(sk.oral_comprehension), rating(sk.oral_expression), rating(sk.learning_strategies),
       rating(sk.quality_control), rating(sk.decision_making), rating(sk.writing),
       txt(a.local_job_knowledge), txt(a.local_training_knowledge)]
    );

    // Section E — barriers & challenges
    await client.query(
      `INSERT INTO section_e_barriers_challenges
         (respondent_id, barriers_to_finding_job, barriers_other, support_needed, support_other,
          challenges_applying_jobs, challenges_other, tried_employment_support_service)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (respondent_id) DO UPDATE SET
         barriers_to_finding_job=EXCLUDED.barriers_to_finding_job, barriers_other=EXCLUDED.barriers_other,
         support_needed=EXCLUDED.support_needed, support_other=EXCLUDED.support_other,
         challenges_applying_jobs=EXCLUDED.challenges_applying_jobs, challenges_other=EXCLUDED.challenges_other,
         tried_employment_support_service=EXCLUDED.tried_employment_support_service`,
      [id, arr(a.employment_barriers), txt(a.barriers_other), arr(a.helpful_support), txt(a.support_other),
       arr(a.application_challenges), txt(a.challenges_other), yn(a.accessed_support_services)]
    );

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
app.get("/api/stats", requireAuth, async (_req, res) => {
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
    res.json({ started, completed, optins, series });
  } catch (e) {
    console.error("stats", e);
    res.status(500).json({ error: "stats_failed" });
  }
});

// CSV export — one row per completed respondent, all sections joined. (admin/collaborators only)
app.get("/api/export.csv", requireAuth, async (_req, res) => {
  try {
    const q = await pool.query(`
      SELECT r.id, r.created_at, r.completed_at, r.consent_agreed, r.moved_after_dec_2021, r.moved_from,
             r.province_moved_from, r.gift_card_draw_opt_in, r.gift_card_email,
             a.gender, a.age_group, a.identity_groups, a.non_permanent_resident_category,
             b.most_recent_credential, b.program_name, b.completed_location, b.institution_name,
             b.completion_year, b.is_highest_level,
             c.employed_before_moving, c.recent_job_title_before_moving, c.main_duties_before_moving,
             c.current_employment_status, c.annual_income_range, c.current_job_title,
             c.current_occupation_sector, c.current_occupation_group, c.months_to_find_first_job,
             c.job_search_helpers, c.current_job_same_as_intended,
             d.critical_thinking, d.problem_solving, d.systems_analysis, d.oral_comprehension,
             d.oral_expression, d.learning_strategies, d.quality_control_testing, d.decision_making,
             d.writing, d.local_job_opportunity_knowledge, d.local_training_opportunity_knowledge,
             e.barriers_to_finding_job, e.barriers_other, e.support_needed, e.support_other,
             e.challenges_applying_jobs, e.challenges_other, e.tried_employment_support_service
        FROM respondents r
        LEFT JOIN section_a_demographics a ON a.respondent_id = r.id
        LEFT JOIN section_b_education b ON b.respondent_id = r.id
        LEFT JOIN section_c_employment c ON c.respondent_id = r.id
        LEFT JOIN section_d_skills d ON d.respondent_id = r.id
        LEFT JOIN section_e_barriers_challenges e ON e.respondent_id = r.id
       WHERE r.completed_at IS NOT NULL
       ORDER BY r.completed_at`);

    const cols = q.fields.map((f) => f.name);
    const cell = (v) => {
      if (v == null) return "";
      let s = Array.isArray(v) ? v.join("; ") : v instanceof Date ? v.toISOString() : String(v);
      if (/[",\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
      return s;
    };
    const rows = [cols.join(",")];
    for (const row of q.rows) rows.push(cols.map((c) => cell(row[c])).join(","));
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
app.use(express.static(PUBLIC_DIR, { dotfiles: "ignore" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sault survey API + site on http://localhost:${PORT}`));
