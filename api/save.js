// ============================================================================
// Writing one respondent's answer snapshot into the schema.
//
// This is the partial-save path: /api/progress stores whatever the respondent
// has answered so far, as they move forward, and deliberately leaves the row
// partial (completed_at NULL — which is what the derived respondents.submitted
// column reads as "No"). The submitted response (/api/submissions in
// server.js) writes the same answer columns plus completed_at; the two column
// lists are pinned to each other by tests/test_progress_save.js so they cannot
// drift apart.
//
// The section writes are the ones both paths use, and they can replace
// (EXCLUDED.*) instead of merging because both paths receive the client's whole
// answer snapshot, not a diff: `answers` always carries every question answered
// so far, including the earlier rating pages of the skills question.
// ============================================================================
"use strict";

const { isUuid } = require("./progress");

const yn = (v) => (v === "Yes" ? true : v === "No" ? false : null);
const consent = (v) => (v === "Yes, I confirm" ? true : v === "No, I do not confirm" ? false : null);
const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const txt = (v) => (v == null || v === "" ? null : String(v));

// respondents: the answers that live on the respondent row itself (consent,
// eligibility, where they moved from, gift card) — without completed_at, so the
// row stays partial. `completed_at IS NULL` in the WHERE makes a late save
// harmless: a stale tab, a queued request or a replay can never modify a response
// that has already been submitted. Returns the number of rows updated: 0 means
// the id is unknown, not an id at all, or the response is already submitted.
async function writeProgressAnswers(client, id, a, opts = {}) {
  if (!isUuid(String(id || ""))) return 0; // a malformed id must not 500 the request
  const answers = a || {};
  const set = [
    "consent_agreed=$2",
    "moved_after_dec_2021=$3",
    "moved_from=$4",
    "province_moved_from=$5",
    "country_moved_from=$6",
    "gift_card_draw_opt_in=$7",
    "gift_card_email=$8",
    // A payload with no language keeps the stored choice; the variant keeps the
    // assignment this respondent's start call gave them.
    "language_preference=COALESCE($9, language_preference)",
    "home_variant=COALESCE(home_variant, $10)",
  ];
  const r = await client.query(
    `UPDATE respondents SET ${set.join(", ")} WHERE id=$1 AND completed_at IS NULL RETURNING id`,
    [
      id,
      consent(answers.consent),
      yn(answers.eligible),
      txt(answers.moved_from),
      txt(answers.province),
      txt(answers.country_moved_from),
      yn(answers.gift_card_draw),
      txt(answers.gift_card_email),
      opts.lang || null,
      opts.variant || null,
    ]
  );
  return r.rowCount;
}

// Sections A–E, one row per respondent each (ON CONFLICT … DO UPDATE), so a
// re-save, a Back-then-Next or a resend overwrites that row instead of
// duplicating it.
async function writeSections(client, id, a) {
  const answers = a || {};

  // Section A — demographics
  await client.query(
    `INSERT INTO section_a_demographics
       (respondent_id, gender, age_group, identity_groups, immigration_category,
        non_permanent_resident_category, non_permanent_resident_other,
        permanent_resident_category, reason_to_move, reason_to_move_other)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (respondent_id) DO UPDATE SET
       gender=EXCLUDED.gender, age_group=EXCLUDED.age_group,
       identity_groups=EXCLUDED.identity_groups,
       immigration_category=EXCLUDED.immigration_category,
       non_permanent_resident_category=EXCLUDED.non_permanent_resident_category,
       non_permanent_resident_other=EXCLUDED.non_permanent_resident_other,
       permanent_resident_category=EXCLUDED.permanent_resident_category,
       reason_to_move=EXCLUDED.reason_to_move,
       reason_to_move_other=EXCLUDED.reason_to_move_other`,
    [id, txt(answers.gender), txt(answers.age_group), arr(answers.identity_groups), txt(answers.immigration_category),
     txt(answers.non_permanent_category), txt(answers.non_permanent_other),
     txt(answers.permanent_category), arr(answers.reason), txt(answers.reason_other)]
  );

  // Section B — education
  await client.query(
    `INSERT INTO section_b_education
       (respondent_id, most_recent_credential, program_name, completed_location,
        is_highest_level, highest_level_credential, highest_level_program_name,
        current_program, current_program_name,
        program_name_other, highest_level_program_name_other, current_program_name_other,
        highest_completed_location)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
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
       current_program_name_other=EXCLUDED.current_program_name_other,
       highest_completed_location=EXCLUDED.highest_completed_location`,
    [id, txt(answers.recent_credential), txt(answers.program_name), txt(answers.program_location),
     yn(answers.highest_education), txt(answers.highest_credential), txt(answers.highest_program_name),
     txt(answers.current_program), txt(answers.current_program_name),
     txt(answers.program_name_other), txt(answers.highest_program_name_other), txt(answers.current_program_name_other),
     txt(answers.highest_completed_location)]
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
        student_support, student_support_other, planned_intended_job_title,
        unemployed_support, not_looking_expect_look, not_looking_intended_job_title,
        not_looking_barrier_gate, not_looking_barriers, not_looking_barriers_other,
        not_looking_support, not_looking_support_other,
        skill_match, work_confidence, student_skill_match, student_confidence)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45)
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
       planned_intended_job_title=EXCLUDED.planned_intended_job_title,
       unemployed_support=EXCLUDED.unemployed_support,
       not_looking_expect_look=EXCLUDED.not_looking_expect_look,
       not_looking_intended_job_title=EXCLUDED.not_looking_intended_job_title,
       not_looking_barrier_gate=EXCLUDED.not_looking_barrier_gate,
       not_looking_barriers=EXCLUDED.not_looking_barriers,
       not_looking_barriers_other=EXCLUDED.not_looking_barriers_other,
       not_looking_support=EXCLUDED.not_looking_support,
       not_looking_support_other=EXCLUDED.not_looking_support_other,
       skill_match=EXCLUDED.skill_match, work_confidence=EXCLUDED.work_confidence,
       student_skill_match=EXCLUDED.student_skill_match,
       student_confidence=EXCLUDED.student_confidence`,
    [id, txt(answers.employed_before), txt(answers.previous_job_title),
     txt(answers.home_emp_before), txt(answers.home_country_job),
     txt(answers.employment_status), txt(answers.current_job_title),
     yn(answers.intended_job), txt(answers.intended_job_title),
     arr(answers.job_search_help), txt(answers.job_search_other),
     txt(answers.work_barrier_gate), arr(answers.work_barriers), txt(answers.work_barriers_other), arr(answers.work_support), txt(answers.work_support_other),
     txt(answers.unemployed_intended_job), txt(answers.unemployed_barrier_gate),
     arr(answers.unemployment_reasons), txt(answers.unemployment_reasons_other),
     arr(answers.not_looking_reasons), txt(answers.not_looking_other),
     txt(answers.student_working), txt(answers.student_current_job), txt(answers.student_job_relevant),
     arr(answers.student_job_help), txt(answers.student_job_help_other),
     txt(answers.student_barrier_gate), arr(answers.student_barriers), txt(answers.student_barriers_other),
     arr(answers.student_support), txt(answers.student_support_other), txt(answers.planned_intended_job),
     arr(answers.unemployed_support), txt(answers.not_looking_expect_look), txt(answers.not_looking_intended_job),
     txt(answers.not_looking_barrier_gate), arr(answers.not_looking_barriers), txt(answers.not_looking_barriers_other),
     arr(answers.not_looking_support), txt(answers.not_looking_support_other),
     txt(answers.skill_match), txt(answers.work_confidence),
     txt(answers.student_skill_match), txt(answers.student_confidence)]
  );

  // Section D — skills (per-occupation OaSIS/NOC7 skills → JSONB { "Skill": 0-5 }).
  // The snapshot carries every page rated so far, so the newest one replaces the
  // stored map: merging would keep the skills of an occupation group the
  // respondent has since changed away from.
  const sk = answers.skills || {};
  const skJson = sk && Object.keys(sk).length ? JSON.stringify(sk) : null;
  await client.query(
    `INSERT INTO section_d_skills (respondent_id, skill_ratings)
     VALUES ($1,$2)
     ON CONFLICT (respondent_id) DO UPDATE SET skill_ratings=EXCLUDED.skill_ratings`,
    [id, skJson]
  );

  // Section E — retention (v12; own table like A–D)
  await client.query(
    `INSERT INTO section_e_retention
       (respondent_id, retain_5_years, leave_factors, leave_factors_other, recommend_survey)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (respondent_id) DO UPDATE SET
       retain_5_years=EXCLUDED.retain_5_years,
       leave_factors=EXCLUDED.leave_factors,
       leave_factors_other=EXCLUDED.leave_factors_other,
       recommend_survey=EXCLUDED.recommend_survey`,
    [id, txt(answers.retain_5_years), arr(answers.leave_factors), txt(answers.leave_factors_other), txt(answers.recommend_survey)]
  );
}

// One partial snapshot → the respondent row plus all five section rows. 0 means
// the id is stale, in which case no section row is written either.
async function saveProgressSnapshot(client, id, a, opts = {}) {
  const n = await writeProgressAnswers(client, id, a, opts);
  if (!n) return 0;
  await writeSections(client, id, a);
  return n;
}

// Per-question timing for an attempt that is still being answered — one row per
// question, so a partial response has times too, exactly like a submitted one.
// The client's stamp is cumulative and the write upserts on
// (respondent_id, question_id), so re-saving a question updates its row instead
// of adding a second one and a re-save can never double count.
//
// Guarded by a savepoint: a timing complaint must never roll back answers that
// are otherwise fine, and an error inside a transaction poisons it, so the
// rollback to the savepoint is what keeps COMMIT valid. Returns the number of
// timings written, 0 when there was nothing to write or the write failed.
async function writeTimings(client, id, timings) {
  if (!Array.isArray(timings) || !timings.length) return 0;
  await client.query("SAVEPOINT question_timings_progress");
  try {
    for (const t of timings) {
      await client.query(
        `INSERT INTO question_timings (respondent_id, question_id, ms, shown_at, answered_at)
           VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (respondent_id, question_id) DO UPDATE SET
           ms = EXCLUDED.ms,
           shown_at = EXCLUDED.shown_at,
           answered_at = EXCLUDED.answered_at`,
        [id, t.question_id, t.ms, t.shown_at, t.answered_at]
      );
    }
    await client.query("RELEASE SAVEPOINT question_timings_progress");
  } catch (e) {
    await client.query("ROLLBACK TO SAVEPOINT question_timings_progress");
    console.error("progress question_timings", e.message);
    return 0;
  }
  return timings.length;
}

module.exports = { writeProgressAnswers, writeSections, saveProgressSnapshot, writeTimings, yn, consent, arr, txt };
