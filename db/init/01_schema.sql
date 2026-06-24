-- ============================================================================
-- Sault Newcomer Skills Survey 2026 — PostgreSQL schema
-- 6 tables: respondents + one row per section (A–E), keyed by respondent_id.
-- This file runs automatically the first time the Postgres container starts
-- (it lives in /docker-entrypoint-initdb.d).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Table 1: Respondents and Eligibility ───────────────────────────────────
CREATE TABLE respondents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    consent_agreed BOOLEAN,

    moved_after_dec_2021 BOOLEAN,
    moved_from TEXT,
    province_moved_from TEXT,
    country_moved_from TEXT,

    gift_card_draw_opt_in BOOLEAN,
    gift_card_email TEXT,

    home_variant TEXT,   -- which homepage A/B/C variant this respondent saw (HP1/HP2/HP3)

    -- Entry channel: 'invite' (personal emailed link, tracked) or 'public' (open, anonymous).
    channel TEXT,
    invite_token TEXT,   -- the personal-link token, when channel = 'invite'

    created_at TIMESTAMPTZ DEFAULT now(),
    completed_at TIMESTAMPTZ
);
-- UNIQUE so an invite token maps to at most one respondent (race-safe with the
-- ON CONFLICT upsert in /api/start). Multiple NULLs allowed → public rows are fine.
CREATE UNIQUE INDEX idx_respondents_invite_token ON respondents (invite_token);

-- Personal invitation links emailed to specific respondents. Each token is a unique
-- single link; completion status is derived by joining respondents on invite_token.
-- Keep this list access-controlled — it maps a token to a person (pseudonymous).
CREATE TABLE invites (
    id SERIAL PRIMARY KEY,
    token TEXT UNIQUE NOT NULL,
    email TEXT,
    label TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Homepage A/B/C impressions — one row per visitor first shown a variant, so we
-- can measure how many people SAW each variant (not just who started/finished).
CREATE TABLE home_impressions (
    id SERIAL PRIMARY KEY,
    variant TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Table 2: Respondent Demographic Profile ────────────────────────────────
CREATE TABLE section_a_demographics (
    id SERIAL PRIMARY KEY,
    respondent_id UUID NOT NULL REFERENCES respondents(id) ON DELETE CASCADE UNIQUE,

    gender TEXT,
    age_group TEXT,
    identity_groups TEXT[],
    immigration_category TEXT,
    non_permanent_resident_category TEXT,
    non_permanent_resident_other TEXT
);

-- ── Table 3: Educational Background ─────────────────────────────────────────
CREATE TABLE section_b_education (
    id SERIAL PRIMARY KEY,
    respondent_id UUID NOT NULL REFERENCES respondents(id) ON DELETE CASCADE UNIQUE,

    most_recent_credential TEXT,
    program_name TEXT,
    completed_location TEXT,
    institution_name TEXT,
    completion_year TEXT,
    is_highest_level BOOLEAN,
    highest_level_credential TEXT,
    highest_level_program_name TEXT
);

-- ── Table 4: Employment and Job Search Profile ─────────────────────────────
CREATE TABLE section_c_employment (
    id SERIAL PRIMARY KEY,
    respondent_id UUID NOT NULL REFERENCES respondents(id) ON DELETE CASCADE UNIQUE,

    employed_before_moving BOOLEAN,
    recent_job_title_before_moving TEXT,
    main_duties_before_moving TEXT,

    current_employment_status TEXT,
    annual_income_range TEXT,
    current_job_title TEXT,

    current_occupation_sector TEXT,
    current_occupation_group TEXT,

    months_to_find_first_job TEXT,
    job_search_helpers TEXT[],
    job_search_helpers_other TEXT,
    current_job_same_as_intended BOOLEAN,
    intended_job_title TEXT,

    -- part-time / casual employment reasons
    part_time_reasons TEXT[],
    part_time_reasons_other TEXT,

    -- unemployed & looking for work
    months_unemployed TEXT,
    unemployment_reasons TEXT[],
    unemployment_reasons_other TEXT,
    unemployed_intended_job_title TEXT,
    unemployed_occupation_sector TEXT,
    unemployed_occupation_group TEXT,

    -- not looking for work
    not_looking_reasons TEXT[],
    not_looking_reasons_other TEXT,

    -- student / recent graduate (planned)
    planned_occupation_sector TEXT,
    planned_occupation_group TEXT,
    planned_intended_job_title TEXT
);

-- ── Table 5: Self-Rated Skills and Local Opportunity Awareness ─────────────
CREATE TABLE section_d_skills (
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

    -- Skills are specific to the respondent's occupation group (NOC), so the set
    -- varies per respondent. Stored as { "Skill name": rating(1-5), ... }.
    -- (The fixed columns above are legacy from the earlier fixed-skill version.)
    skill_ratings JSONB,

    local_job_opportunity_knowledge TEXT,
    local_training_opportunity_knowledge TEXT
);

-- ── Table 6: Employment Barriers, Challenges, and Support Needs ─────────────
CREATE TABLE section_e_barriers_challenges (
    id SERIAL PRIMARY KEY,
    respondent_id UUID NOT NULL REFERENCES respondents(id) ON DELETE CASCADE UNIQUE,

    barriers_to_finding_job TEXT[],
    barriers_other TEXT,

    support_needed TEXT[],
    support_other TEXT,

    challenges_applying_jobs TEXT[],
    challenges_other TEXT,

    tried_employment_support_service BOOLEAN,
    service_access_challenges TEXT[],
    service_access_other TEXT
);

-- ── Helpful index for the admin "responses over time" chart ────────────────
CREATE INDEX idx_respondents_created_at ON respondents (created_at);
