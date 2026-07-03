/*
 * rules.js — Business rules + helpers (PURE logic, no I/O). Namespace: window.PTORules
 *
 * Responsibility (per PTO_CENTRAL_ARCHITECTURE.md §10):
 *   PTO business rules live in code (not buried in form field IDs — a core
 *   failure of the old system, §1). Pure functions only — NO Graph, NO DOM —
 *   so they are trivially testable.
 *
 *     - formatDateOnly(date)               -> "YYYY-MM-DD"
 *     - todayDateOnly()                    -> today's "YYYY-MM-DD"
 *     - addDays(date, days)                -> Date
 *     - calculateNoticeDays(start, submit) -> whole days of advance notice
 *     - isShortNotice(noticeDays)          -> noticeDays < MIN_NOTICE_DAYS (rule 1)
 *     - generateRequestKey()               -> "PTO-YYYYMMDD-HHMMSS-XXXX" (non-sequential)
 *     - getInitialStatus(ptoType)          -> "Auto-Approved" (Sick) | "Pending"
 *     - buildAuditLine(action, actor, det) -> "[ISO] action by actor — details"
 *
 * OPEN DECISION (§13 Q8): calendar-day vs business-day for the 7-day notice.
 * We use CALENDAR days for now.
 *
 * Dependency direction (§7): rules.js → config.js only (read-only constant).
 */

window.PTORules = (function () {
  "use strict";

  // Minimum advance-notice days before a request is "short notice" (rule 1).
  // Read from config if present (future-proof); default to 7 per architecture.
  var MIN_NOTICE_DAYS =
    window.PTOConfig && typeof PTOConfig.minNoticeDays === "number" ? PTOConfig.minNoticeDays : 7;

  var MS_PER_DAY = 24 * 60 * 60 * 1000;

  function pad2(n) { return String(n).padStart(2, "0"); }

  /** Coerce a Date | "YYYY-MM-DD" | ISO string into a Date (local). */
  function toDate(value) {
    if (value instanceof Date) return value;
    if (typeof value === "string") {
      // Date-only "YYYY-MM-DD" -> construct at LOCAL midnight to avoid TZ shifts.
      var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
      if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return new Date(value);
    }
    return new Date(value);
  }

  /** Local midnight for a date (strips time-of-day). */
  function atMidnight(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  /** Format a date as "YYYY-MM-DD" (local). */
  function formatDateOnly(date) {
    var d = toDate(date);
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  /** Today as "YYYY-MM-DD" (local). */
  function todayDateOnly() {
    return formatDateOnly(new Date());
  }

  /** Return a new Date = date + days. Does not mutate the input. */
  function addDays(date, days) {
    var d = toDate(date);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + Number(days), d.getHours(), d.getMinutes(), d.getSeconds());
  }

  /**
   * Whole CALENDAR days of advance notice between submittedAt and startDate.
   * Both normalized to local midnight so partial days don't skew the count.
   * (e.g. submit today, start tomorrow => 1.)
   */
  function calculateNoticeDays(startDate, submittedAt) {
    var start = atMidnight(toDate(startDate));
    var submitted = atMidnight(toDate(submittedAt || new Date()));
    return Math.round((start - submitted) / MS_PER_DAY);
  }

  /** True when notice is below the minimum (rule 1). */
  function isShortNotice(noticeDays) {
    return Number(noticeDays) < MIN_NOTICE_DAYS;
  }

  /**
   * Non-sequential, collision-resistant request key for the Title column.
   * Format: PTO-YYYYMMDD-HHMMSS-XXXX  (XXXX = 4 random base36 chars, upper).
   * Non-sequential avoids the race/guessability of a server-side counter.
   */
  function generateRequestKey() {
    var d = new Date();
    var datePart = "" + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate());
    var timePart = "" + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
    var rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    while (rand.length < 4) rand += "0";
    return "PTO-" + datePart + "-" + timePart + "-" + rand;
  }

  /**
   * Initial Status for a new request.
   *   Sick                 => "Auto-Approved" (no manager needed, rule 2)
   *   everything else      => "Pending"
   */
  function getInitialStatus(ptoType) {
    return String(ptoType || "").toLowerCase() === "sick" ? "Auto-Approved" : "Pending";
  }

  /**
   * Build one append-only audit line.
   * Format: "[2026-06-11T12:00:00.000Z] Created by Jane Doe — details"
   */
  function buildAuditLine(action, actorName, details) {
    var ts = new Date().toISOString();
    var line = "[" + ts + "] " + (action || "Action") + " by " + (actorName || "Unknown");
    if (details) line += " — " + details;
    return line;
  }

  function normEmail(s) { return String(s || "").trim().toLowerCase(); }

  /**
   * Approval authorization predicate (Alternate Approver aware — see
   * docs/ALTERNATE_APPROVER_DESIGN.md). Pure function, no I/O, so the exact
   * priority order is independently testable from approve.page.js.
   *
   * Priority:
   *   1. `approverEmail`, if present (an alternate-approver override, or the
   *      default mirror of ManagerEmail once the feature is live) — the
   *      signed-in user must match it.
   *   2. Otherwise (no `approverEmail` at all — legacy requests created before
   *      this feature, or the column not yet provisioned) — fall back to
   *      `managerEmail`, exactly the pre-existing behavior.
   *   3. HR/Admin can always decide, regardless of 1/2.
   *
   * All comparisons are case-insensitive; blank/whitespace-only values are
   * treated as absent (never match).
   *
   * @param {object} opts { managerEmail, approverEmail, myEmail, isHrAdmin }
   * @returns {boolean}
   */
  function canDecide(opts) {
    opts = opts || {};
    var mine = normEmail(opts.myEmail);
    var approver = normEmail(opts.approverEmail);
    var manager = normEmail(opts.managerEmail);
    var isHrAdmin = !!opts.isHrAdmin;

    if (!mine) return isHrAdmin;
    if (approver) return mine === approver || isHrAdmin;
    return mine === manager || isHrAdmin;
  }

  return {
    formatDateOnly: formatDateOnly,
    todayDateOnly: todayDateOnly,
    addDays: addDays,
    calculateNoticeDays: calculateNoticeDays,
    isShortNotice: isShortNotice,
    generateRequestKey: generateRequestKey,
    getInitialStatus: getInitialStatus,
    buildAuditLine: buildAuditLine,
    canDecide: canDecide,
    // exposed for reference/testing
    MIN_NOTICE_DAYS: MIN_NOTICE_DAYS,
  };
})();
