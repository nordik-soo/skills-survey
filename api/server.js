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
               country_moved_from=$6, gift_card_draw_opt_in=$7, gift_card_email=$8, completed_at=now()
         WHERE id=$1 RETURNING id`,
        [id, consent(a.consent), yn(a.eligible), txt(a.moved_from), txt(a.province), txt(a.country_moved_from), yn(a.gift_card_draw), txt(a.gift_card_email)]
      );
      if (u.rowCount === 0) id = null; // stale id → fall through to insert
    }
    if (!id) {
      const r = await client.query(
        `INSERT INTO respondents
           (consent_agreed, moved_after_dec_2021, moved_from, province_moved_from, country_moved_from, gift_card_draw_opt_in, gift_card_email, completed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,now()) RETURNING id`,
        [consent(a.consent), yn(a.eligible), txt(a.moved_from), txt(a.province), txt(a.country_moved_from), yn(a.gift_card_draw), txt(a.gift_card_email)]
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
          institution_name, completion_year, is_highest_level,
          highest_level_credential, highest_level_program_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (respondent_id) DO UPDATE SET
         most_recent_credential=EXCLUDED.most_recent_credential,
         program_name=EXCLUDED.program_name, completed_location=EXCLUDED.completed_location,
         institution_name=EXCLUDED.institution_name, completion_year=EXCLUDED.completion_year,
         is_highest_level=EXCLUDED.is_highest_level,
         highest_level_credential=EXCLUDED.highest_level_credential,
         highest_level_program_name=EXCLUDED.highest_level_program_name`,
      [id, txt(a.recent_credential), txt(a.program_name), txt(a.program_location),
       txt(a.institution_name), txt(a.program_completion_year), yn(a.highest_education),
       txt(a.highest_credential), txt(a.highest_program_name)]
    );

    // Section C — employment
    await client.query(
      `INSERT INTO section_c_employment
         (respondent_id, employed_before_moving, recent_job_title_before_moving,
          main_duties_before_moving, current_employment_status, annual_income_range,
          current_job_title, current_occupation_sector, current_occupation_group,
          months_to_find_first_job, job_search_helpers, job_search_helpers_other,
          current_job_same_as_intended, intended_job_title,
          part_time_reasons, part_time_reasons_other,
          months_unemployed, unemployment_reasons, unemployment_reasons_other,
          unemployed_intended_job_title, unemployed_occupation_sector, unemployed_occupation_group,
          not_looking_reasons, not_looking_reasons_other,
          planned_occupation_sector, planned_occupation_group, planned_intended_job_title)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
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
         job_search_helpers_other=EXCLUDED.job_search_helpers_other,
         current_job_same_as_intended=EXCLUDED.current_job_same_as_intended,
         intended_job_title=EXCLUDED.intended_job_title,
         part_time_reasons=EXCLUDED.part_time_reasons,
         part_time_reasons_other=EXCLUDED.part_time_reasons_other,
         months_unemployed=EXCLUDED.months_unemployed,
         unemployment_reasons=EXCLUDED.unemployment_reasons,
         unemployment_reasons_other=EXCLUDED.unemployment_reasons_other,
         unemployed_intended_job_title=EXCLUDED.unemployed_intended_job_title,
         unemployed_occupation_sector=EXCLUDED.unemployed_occupation_sector,
         unemployed_occupation_group=EXCLUDED.unemployed_occupation_group,
         not_looking_reasons=EXCLUDED.not_looking_reasons,
         not_looking_reasons_other=EXCLUDED.not_looking_reasons_other,
         planned_occupation_sector=EXCLUDED.planned_occupation_sector,
         planned_occupation_group=EXCLUDED.planned_occupation_group,
         planned_intended_job_title=EXCLUDED.planned_intended_job_title`,
      [id, yn(a.employed_before), txt(a.previous_job_title), txt(a.previous_job_duties),
       txt(a.employment_status), txt(a.individual_income), txt(a.current_job_title),
       txt(a.occupation_sector), txt(a.occupation_group), txt(a.months_to_find_first_job),
       arr(a.job_search_help), txt(a.job_search_other),
       yn(a.intended_job), txt(a.intended_job_title),
       arr(a.part_time_reasons), txt(a.part_time_reasons_other),
       txt(a.months_unemployed), arr(a.unemployment_reasons), txt(a.unemployment_reasons_other),
       txt(a.unemployed_intended_job), txt(a.unemployed_sector), txt(a.unemployed_group),
       arr(a.not_looking_reasons), txt(a.not_looking_other),
       txt(a.planned_sector), txt(a.planned_group), txt(a.planned_intended_job)]
    );

    // Section D — skills (dynamic per occupation group → JSONB { "Skill": 1-5 })
    const skJson = sk && Object.keys(sk).length ? JSON.stringify(sk) : null;
    await client.query(
      `INSERT INTO section_d_skills
         (respondent_id, skill_ratings, local_job_opportunity_knowledge, local_training_opportunity_knowledge)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (respondent_id) DO UPDATE SET
         skill_ratings=EXCLUDED.skill_ratings,
         local_job_opportunity_knowledge=EXCLUDED.local_job_opportunity_knowledge,
         local_training_opportunity_knowledge=EXCLUDED.local_training_opportunity_knowledge`,
      [id, skJson, txt(a.local_job_knowledge), txt(a.local_training_knowledge)]
    );

    // Section E — barriers & challenges
    await client.query(
      `INSERT INTO section_e_barriers_challenges
         (respondent_id, barriers_to_finding_job, barriers_other, support_needed, support_other,
          challenges_applying_jobs, challenges_other, tried_employment_support_service,
          service_access_challenges, service_access_other)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (respondent_id) DO UPDATE SET
         barriers_to_finding_job=EXCLUDED.barriers_to_finding_job, barriers_other=EXCLUDED.barriers_other,
         support_needed=EXCLUDED.support_needed, support_other=EXCLUDED.support_other,
         challenges_applying_jobs=EXCLUDED.challenges_applying_jobs, challenges_other=EXCLUDED.challenges_other,
         tried_employment_support_service=EXCLUDED.tried_employment_support_service,
         service_access_challenges=EXCLUDED.service_access_challenges,
         service_access_other=EXCLUDED.service_access_other`,
      [id, arr(a.employment_barriers), txt(a.barriers_other), arr(a.helpful_support), txt(a.support_other),
       arr(a.application_challenges), txt(a.challenges_other), yn(a.accessed_support_services),
       arr(a.service_access_challenges), txt(a.service_access_other)]
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

// ── per-table exports (6 tables, not merged) ────────────────────────────────
// Each table for completed respondents only, in completion order.
const EXPORT_TABLES = [
  ["respondents", "SELECT r.* FROM respondents r WHERE r.completed_at IS NOT NULL ORDER BY r.completed_at"],
  ["section_a_demographics", "SELECT t.* FROM section_a_demographics t JOIN respondents r ON r.id=t.respondent_id WHERE r.completed_at IS NOT NULL ORDER BY r.completed_at"],
  ["section_b_education", "SELECT t.* FROM section_b_education t JOIN respondents r ON r.id=t.respondent_id WHERE r.completed_at IS NOT NULL ORDER BY r.completed_at"],
  ["section_c_employment", "SELECT t.* FROM section_c_employment t JOIN respondents r ON r.id=t.respondent_id WHERE r.completed_at IS NOT NULL ORDER BY r.completed_at"],
  ["section_d_skills", "SELECT t.* FROM section_d_skills t JOIN respondents r ON r.id=t.respondent_id WHERE r.completed_at IS NOT NULL ORDER BY r.completed_at"],
  ["section_e_barriers_challenges", "SELECT t.* FROM section_e_barriers_challenges t JOIN respondents r ON r.id=t.respondent_id WHERE r.completed_at IS NOT NULL ORDER BY r.completed_at"],
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
app.get("/api/export.zip", requireAuth, async (_req, res) => {
  try {
    const zip = new JSZip();
    for (const [name, sql] of EXPORT_TABLES) {
      const q = await pool.query(sql);
      const cols = q.fields.map((f) => f.name);
      const rows = [cols.join(",")];
      for (const row of q.rows) rows.push(cols.map((c) => csvCell(row[c])).join(","));
      zip.file(`${name}.csv`, "﻿" + rows.join("\r\n"));
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
app.get("/api/export.xlsx", requireAuth, async (_req, res) => {
  try {
    const wb = new ExcelJS.Workbook();
    const sheetName = { respondents: "respondents", section_a_demographics: "A_demographics",
      section_b_education: "B_education", section_c_employment: "C_employment",
      section_d_skills: "D_skills", section_e_barriers_challenges: "E_barriers" };
    for (const [name, sql] of EXPORT_TABLES) {
      const q = await pool.query(sql);
      const ws = wb.addWorksheet(sheetName[name] || name.slice(0, 31));
      const cols = q.fields.map((f) => f.name);
      ws.addRow(cols);
      for (const row of q.rows) ws.addRow(cols.map((c) => xlsxCell(row[c])));
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
app.get("/api/export.csv", requireAuth, async (_req, res) => {
  try {
    const q = await pool.query(`
      SELECT r.id, r.created_at, r.completed_at, r.consent_agreed, r.moved_after_dec_2021, r.moved_from,
             r.province_moved_from, r.country_moved_from, r.gift_card_draw_opt_in, r.gift_card_email,
             a.gender, a.age_group, a.identity_groups, a.immigration_category,
             a.non_permanent_resident_category, a.non_permanent_resident_other,
             b.most_recent_credential, b.program_name, b.completed_location, b.institution_name,
             b.completion_year, b.is_highest_level, b.highest_level_credential, b.highest_level_program_name,
             c.employed_before_moving, c.recent_job_title_before_moving, c.main_duties_before_moving,
             c.current_employment_status, c.annual_income_range, c.current_job_title,
             c.current_occupation_sector, c.current_occupation_group, c.months_to_find_first_job,
             c.job_search_helpers, c.job_search_helpers_other, c.current_job_same_as_intended, c.intended_job_title,
             c.part_time_reasons, c.part_time_reasons_other,
             c.months_unemployed, c.unemployment_reasons, c.unemployment_reasons_other,
             c.unemployed_intended_job_title, c.unemployed_occupation_sector, c.unemployed_occupation_group,
             c.not_looking_reasons, c.not_looking_reasons_other,
             c.planned_occupation_sector, c.planned_occupation_group, c.planned_intended_job_title,
             d.skill_ratings, d.local_job_opportunity_knowledge, d.local_training_opportunity_knowledge,
             e.barriers_to_finding_job, e.barriers_other, e.support_needed, e.support_other,
             e.challenges_applying_jobs, e.challenges_other, e.tried_employment_support_service,
             e.service_access_challenges, e.service_access_other
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
      let s = Array.isArray(v) ? v.join("; ")
            : v instanceof Date ? v.toISOString()
            : typeof v === "object" ? JSON.stringify(v)
            : String(v);
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
`;

async function initSchema() {
  try { await pool.query(SCHEMA_SQL); console.log("schema ready"); }
  catch (e) { console.error("schema init failed:", e.message); }
}

const PORT = process.env.PORT || 3000;
initSchema().finally(() =>
  app.listen(PORT, () => console.log(`Sault survey API + site on http://localhost:${PORT}`))
);
