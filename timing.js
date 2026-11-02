/* ── Per-question timing tracker ────────────────────────────────────────────
   Measures how long each question stays on screen, for the per-question
   completion times stored in question_timings. Pure and DOM-free so it can be
   unit-tested: app.js owns the wiring (which question is rendered, when a draft
   or the submission is sent) and this owns the arithmetic.

   Rules:
   - `enter(id)` starts the clock. Re-entering the same question (a rating
     sub-page re-render) keeps the running interval, so it is not reset.
   - Leaving a question adds the interval to its total. Coming back to it later
     adds again, so a total is "time spent on this question", not one visit.
   - `snapshot()` is the finalized totals; `stamp()` is those plus the interval
     still running. Callers that persist or send a payload use `stamp()`, so
     nothing measured is ever dropped, and nothing is counted twice.
   - Nothing ticks while a question is off screen, and an open interval is not
     persisted, so time away from the tab or across a reload is never counted.
   - Clock jumps (system clock changes, device sleep) can never produce a
     negative or absurd value: every interval is clamped to 0 … 24h. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.NordikTiming = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const MAX_MS = 24 * 60 * 60 * 1000;

  function clampMs(value) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(MAX_MS, n);
  }

  function createTracker(options) {
    const now = (options && options.now) || (() => Date.now());
    let current = null;   // question on screen, or null
    let since = null;     // when it appeared (epoch ms), null when not running
    let totals = {};      // finalized ms per question id

    // Milliseconds on the question that is on screen right now, uncounted.
    function running() {
      if (current == null || since === null) return 0;
      return clampMs(now() - since);
    }

    // Close the running interval into its question's total.
    function flush() {
      if (current == null) return;
      const id = current;
      const elapsed = running();
      current = null;
      since = null;
      totals[id] = clampMs((totals[id] || 0) + elapsed);
    }

    return {
      enter(id) {
        if (typeof id !== "string" || !id) return;
        if (id === current) return;      // same question re-rendered → keep timing
        flush();
        current = id;
        since = now();
      },
      add(id, ms) {
        if (typeof id !== "string" || !id) return;
        totals[id] = clampMs((totals[id] || 0) + clampMs(ms));
      },
      snapshot() {
        const out = {};
        for (const id of Object.keys(totals)) out[id] = clampMs(totals[id]);
        return out;
      },
      // Finalized totals plus the question currently on screen, closed at the
      // moment of the call. What a draft or a submission should carry.
      stamp() {
        const out = this.snapshot();
        if (current != null) out[current] = clampMs((totals[current] || 0) + running());
        return out;
      },
      restore(saved) {
        totals = {};
        if (!saved || typeof saved !== "object") return;
        for (const id of Object.keys(saved)) {
          const v = saved[id];
          if (typeof v === "number" && Number.isFinite(v) && v >= 0) totals[id] = clampMs(v);
        }
      },
      reset() {
        current = null;
        since = null;
        totals = {};
      },
      currentQuestion() { return current; },
    };
  }

  return { createTracker, clampMs, MAX_MS };
});
