-- ============================================================================
-- respondents.submitted — added after the survey had already been deployed.
--
-- A fresh database gets this column from 01_schema.sql; this file exists so an
-- existing database (local volume, Railway) can be brought up to date with one
-- command and without touching any stored row:
--
--     psql "$DATABASE_URL" -f db/init/02_submitted_column.sql
--
-- Existing respondents need no backfill: `submitted` is generated from
-- completed_at, so rows that were submitted already read 'Yes' and partial rows
-- read 'No'. IF NOT EXISTS makes it safe to run more than once, and on a fresh
-- volume (where 01 already created it) it is a no-op.
-- ============================================================================

ALTER TABLE respondents ADD COLUMN IF NOT EXISTS submitted TEXT
  GENERATED ALWAYS AS (CASE WHEN completed_at IS NULL THEN 'No' ELSE 'Yes' END) STORED;

-- Reading partial attempts: the rows /api/progress has written so far.
SELECT count(*) AS not_submitted FROM respondents WHERE submitted = 'No';
