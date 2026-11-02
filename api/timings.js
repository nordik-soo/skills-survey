/* ── Per-question timing — payload normalisation ────────────────────────────
   The browser measures how long each question stayed on screen and sends that
   map along with the submission. Nothing the client sends is trusted here:
   question ids must look like question ids, durations must be plausible
   integers, and duplicates collapse so one question can never be stored twice
   (the primary key would reject it anyway, but silently dropping beats a
   failed insert on a submission that is otherwise fine).

   Pure module: no database, no express — so the rules can be unit-tested. */

const MAX_QUESTIONS = 200;                     // survey has ~77; leaves headroom
const MAX_MS = 24 * 60 * 60 * 1000;            // one day per question, then clamped
const ID_RE = /^[a-z0-9_]{1,64}$/i;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;    // client clock older than a week → ignore
const MAX_SKEW_MS = 60 * 60 * 1000;            // client clock up to an hour fast → keep

// Accepts the map form { question_id: ms } and the array form
// [{ id, ms, at }] or [[id, ms]]. Anything else yields no rows.
function pairs(input) {
  if (!input || typeof input !== "object") return [];
  if (Array.isArray(input)) {
    const out = [];
    for (const item of input) {
      if (Array.isArray(item) && item.length >= 2) out.push([item[0], item[1], null]);
      else if (item && typeof item === "object" && item.id != null) out.push([item.id, item.ms, item.at]);
    }
    return out;
  }
  return Object.keys(input).map((k) => [k, input[k], null]);
}

// A duration the survey can actually produce: 0 … 24h, rounded to whole ms.
// Only a real number counts — null, "" and "soon" mean "not measured", and
// coercing them to 0 would invent an instant answer that never happened.
function duration(value) {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value) || value < 0) return null;  // negative = implausible, drop it
  return Math.min(MAX_MS, Math.round(value));
}

// Answer time from the client, when it is a sane epoch ms value; otherwise the
// server clock. Keeping the client value preserves "when" per question; falling
// back keeps the row rather than losing it over a skewed clock.
function answerTime(value, now) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return new Date(now);
  if (n < now - MAX_AGE_MS || n > now + MAX_SKEW_MS) return new Date(now);
  return new Date(n);
}

function normalizeTimings(input, now = Date.now()) {
  const seen = new Map();                          // question_id → last valid row
  for (const [rawId, rawMs, rawAt] of pairs(input)) {
    const id = typeof rawId === "string" ? rawId.trim() : "";
    if (!ID_RE.test(id)) continue;                 // not a question id → skip
    const ms = duration(rawMs);
    if (ms === null) continue;
    const answered = answerTime(rawAt, now);
    seen.set(id, {
      question_id: id,
      ms,
      answered_at: answered,
      shown_at: new Date(answered.getTime() - ms),
    });
    if (seen.size >= MAX_QUESTIONS) break;         // cap a hostile payload
  }
  return [...seen.values()];
}

module.exports = { normalizeTimings, MAX_MS, MAX_QUESTIONS, MAX_AGE_MS, MAX_SKEW_MS };
