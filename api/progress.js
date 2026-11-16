// ============================================================================
// Partial-response saves (/api/progress).
//
// Answers used to reach Postgres only when the respondent pressed Submit
// (/api/submissions), so an attempt abandoned halfway left a respondents row
// with nothing in it. The client now posts its whole answer snapshot after
// every Next and every skills page; that write leaves completed_at NULL, which
// is exactly what the derived `submitted` column reads ("No" = partial).
//
// This module holds the decision of whether a progress payload is worth
// storing at all, so the route stays a thin wrapper and the rules can be
// tested without a database.
// ============================================================================
"use strict";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The two answers that end the survey early. Neither may be written as progress:
// storing answers from someone who declined consent (or is ineligible) is a
// consent problem, not a data-completeness win.
const CONSENT_NO = "No, I do not confirm";
const ELIGIBLE_NO = "No";

function isUuid(v) {
  return typeof v === "string" && UUID_RE.test(v.trim());
}

// True when the snapshot holds at least one answer. An attempt that has only
// had its Start recorded (or whose answers were all cleared) is not progress.
function hasAnswer(answers) {
  if (!answers || typeof answers !== "object") return false;
  for (const v of Object.values(answers)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string") { if (v.trim() !== "") return true; continue; }
    if (Array.isArray(v)) { if (v.length) return true; continue; }
    if (typeof v === "object") { if (hasAnswer(v)) return true; continue; }
    return true; // number / boolean
  }
  return false;
}

// Decide what a POST /api/progress payload should do.
//   { save: true,  id, answers }
//   { save: false, status, reason }
// status 400 is a malformed respondent id; every other refusal is a normal
// "nothing to store" answer, so the client is not pushed to retry it.
function progressDecision(body) {
  const b = body && typeof body === "object" ? body : {};
  if (!isUuid(b.respondent_id)) {
    return { save: false, status: 400, reason: "bad_respondent" };
  }
  const id = String(b.respondent_id).trim().toLowerCase();
  const answers = b.answers;
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    return { save: false, status: 200, reason: "no_answers" };
  }
  if (answers.consent === CONSENT_NO) return { save: false, status: 200, reason: "consent_declined" };
  if (answers.eligible === ELIGIBLE_NO) return { save: false, status: 200, reason: "ineligible" };
  if (!hasAnswer(answers)) return { save: false, status: 200, reason: "no_answers" };
  return { save: true, id, answers };
}

module.exports = { progressDecision, hasAnswer, isUuid, UUID_RE, CONSENT_NO, ELIGIBLE_NO };
