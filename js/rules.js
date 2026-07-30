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
  var MAX_BACKUP_CONTACTS = 3;
  var DEFAULT_APPROVER_NO_MANAGER = {
    email: "maggie@mybasepay.com",
    displayName: "Maggie Mondragon",
  };
  var STATUS_VALUES = {
    PENDING: "Pending",
    APPROVED: "Approved",
    AUTO_APPROVED: "Auto-Approved",
    AUTO_APPROVED_ESCALATION: "Auto-Approved (Escalation)",
    REJECTED: "Rejected",
    CANCELLED: "Cancelled",
    CANCELLATION_REQUESTED: "Cancellation Requested",
  };
  var STATUS_LABELS = {
    "Pending": "Pending",
    "Approved": "Approved",
    "Auto-Approved": "Auto-Approved",
    "Auto-Approved (Escalation)": "Auto-Approved",
    "Rejected": "Rejected",
    "Cancelled": "Cancelled",
    "Cancellation Requested": "Cancellation Requested",
  };

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
    return String(ptoType || "").toLowerCase() === "sick" ? STATUS_VALUES.AUTO_APPROVED : STATUS_VALUES.PENDING;
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
  function emailOf(user) { return (user && (user.mail || user.userPrincipalName || user.email)) || ""; }

  function displayStatus(status) {
    return STATUS_LABELS[String(status || "").trim()] || String(status || "Unknown");
  }

  function validateDateRange(startDate, endDate) {
    if (!startDate) throw new Error("Choose a start date.");
    if (!endDate) throw new Error("Choose an end date.");
    var start = formatDateOnly(startDate);
    var end = formatDateOnly(endDate);
    if (end < start) throw new Error("End date must be on or after the start date.");
    return { startDate: start, endDate: end };
  }

  function backupFromPerson(person) {
    if (!person) return null;
    var email = emailOf(person);
    var name = person.name || person.displayName || email;
    if (!name && !email) return null;
    return { name: name || email, email: email };
  }

  var SELF_AS_BACKUP_MESSAGE = "The employee taking PTO cannot be listed as their own backup contact.";

  /**
   * @param {object|Array} input - form/fields data (see caller)
   * @param {string} [requesterEmail] - the employee the PTO is FOR. When
   *   provided, any backup contact whose email matches (case-insensitive) is
   *   rejected — applies identically to self and on-behalf submissions, since
   *   `requesterEmail` is always the PTO recipient's email, never the acting
   *   submitter's. Omitted entirely (the read-direction callers, e.g.
   *   `parseBackupContacts`), this check is skipped — existing records are
   *   never retroactively invalidated by reading them back.
   */
  function normalizeBackupContacts(input, requesterEmail) {
    var list = [];
    if (Array.isArray(input && input.BackupContacts)) list = input.BackupContacts;
    else if (Array.isArray(input && input.backupContacts)) list = input.backupContacts;
    else if (Array.isArray(input)) list = input;
    else if (input && (input.BackupContactName || input.BackupContactEmail || input.backupContactName || input.backupContactEmail)) {
      list = [{
        name: input.BackupContactName || input.backupContactName || "",
        email: input.BackupContactEmail || input.backupContactEmail || "",
      }];
    }
    var requesterNorm = normEmail(requesterEmail);
    var seen = {};
    var out = [];
    list.forEach(function (raw) {
      var c = backupFromPerson(raw);
      if (!c) return;
      var email = normEmail(c.email);
      if (!email) throw new Error("Each backup contact must have an email address.");
      if (requesterNorm && email === requesterNorm) throw new Error(SELF_AS_BACKUP_MESSAGE);
      if (seen[email]) throw new Error("Backup contacts must be unique.");
      seen[email] = true;
      out.push({ name: c.name || c.email, email: c.email });
    });
    if (out.length > MAX_BACKUP_CONTACTS) {
      throw new Error("Select no more than " + MAX_BACKUP_CONTACTS + " backup contacts.");
    }
    return out;
  }

  function flattenBackupContacts(input, requesterEmail) {
    var contacts = normalizeBackupContacts(input, requesterEmail);
    var fields = {
      BackupContactName: "",
      BackupContactEmail: "",
      BackupContact2Name: "",
      BackupContact2Email: "",
      BackupContact3Name: "",
      BackupContact3Email: "",
      BackupContactCount: contacts.length,
    };
    contacts.forEach(function (c, idx) {
      var suffix = idx === 0 ? "" : String(idx + 1);
      fields["BackupContact" + suffix + "Name"] = c.name || "";
      fields["BackupContact" + suffix + "Email"] = c.email || "";
    });
    return fields;
  }

  function parseBackupContacts(fields) {
    fields = fields || {};
    return normalizeBackupContacts([
      { name: fields.BackupContactName, email: fields.BackupContactEmail },
      { name: fields.BackupContact2Name, email: fields.BackupContact2Email },
      { name: fields.BackupContact3Name, email: fields.BackupContact3Email },
    ]);
  }

  /**
   * Validate a Graph user object as a selectable PTO participant (on-behalf
   * employee, alternate approver, backup contact). PURE — no I/O — so it is
   * unit-testable and shared by every selection flow. The object must come
   * from the directory (PTODirectory lookups $select accountEnabled,userType);
   * free-text values never reach this because callers only pass Graph results.
   *
   * Returns a human-readable problem string, or null when selectable.
   * Rejects: non-objects/free text, missing/invalid email, inactive accounts
   * (accountEnabled === false), Guest/external accounts, and non-company
   * domains. Context rules (not yourself, not the requester, ...) are the
   * caller's job.
   *
   * @param {object} user - Graph user (mail/userPrincipalName, accountEnabled, userType)
   * @param {object} [options] - { allowedDomain?: string } default "mybasepay.com"
   * @returns {string|null}
   */
  function userSelectionProblem(user, options) {
    options = options || {};
    var allowedDomain = normEmail(options.allowedDomain || "mybasepay.com");
    if (!user || typeof user !== "object") {
      return "Select a person from the directory first.";
    }
    var email = normEmail(user.mail || user.userPrincipalName);
    if (!email || email.indexOf("@") === -1) {
      return "That account has no valid email address and can't be selected.";
    }
    if (user.accountEnabled === false) {
      return "That account is inactive and can't be selected.";
    }
    if (normEmail(user.userType) === "guest") {
      return "Guest accounts can't be selected.";
    }
    var domain = email.split("@").pop();
    if (domain !== allowedDomain && !(window.PTODemo && window.PTODemo.active && domain === "example.test")) {
      return "Only " + allowedDomain + " employees can be selected.";
    }
    return null; // selectable
  }

  function assertApproverIsSafe(approver, context) {
    context = context || {};
    var problem = userSelectionProblem(approver);
    if (problem) throw new Error(problem);
    var approverEmail = normEmail(emailOf(approver));
    var requesterEmail = normEmail(emailOf(context.requester));
    var submitterEmail = normEmail(emailOf(context.submitter));
    if (requesterEmail && approverEmail === requesterEmail) {
      throw new Error("The approver must be different from the employee receiving PTO.");
    }
    if (submitterEmail && approverEmail === submitterEmail) {
      throw new Error("The approver must be different from the acting submitter.");
    }
    return approver;
  }

  async function resolveApproverForNoManager(context) {
    context = context || {};
    if (!window.PTODirectory || !PTODirectory.getUserByEmail) {
      throw new Error("Default approver lookup is unavailable.");
    }
    var approver = await PTODirectory.getUserByEmail(DEFAULT_APPROVER_NO_MANAGER.email);
    if (!approver) throw new Error("Default approver could not be resolved.");
    return assertApproverIsSafe(approver, context);
  }

  function isEmployeeCancellationEligible(status) {
    status = String(status || "").trim();
    return status === STATUS_VALUES.PENDING || status === STATUS_VALUES.APPROVED ||
      status === STATUS_VALUES.AUTO_APPROVED || status === STATUS_VALUES.AUTO_APPROVED_ESCALATION;
  }

  /**
   * Feature flag: is the employee-cancellation-request capability (request /
   * complete / decline) active? Default OFF in production
   * (`PTOConfig.features.employeeCancellationRequests`, js/config.js) until
   * SharePoint schema provisioning and live validation are complete — see
   * the operational preflight report. Demo mode (`?demo=1`) is ALWAYS
   * enabled regardless of the flag, so the feature stays fully testable
   * while inactive in production; demo mode never reaches the real backend
   * functions this flag also gates (js/demo-mode.js replaces
   * window.PTORequests wholesale), so the two checks never conflict.
   * @returns {boolean}
   */
  function isEmployeeCancellationEnabled() {
    // Fully window-qualified throughout (never a bare PTODemo/PTOConfig
    // reference) — this file's `vm`-sandboxed test harness gives `window` a
    // plain object, not the sandbox's actual global object, so a bare
    // reference after a truthy `window.X` guard would throw ReferenceError
    // there even though it works in a real browser (where window IS global).
    if (window.PTODemo && window.PTODemo.active === true) return true;
    return !!(window.PTOConfig && window.PTOConfig.features && window.PTOConfig.features.employeeCancellationRequests === true);
  }

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
    userSelectionProblem: userSelectionProblem,
    resolveApproverForNoManager: resolveApproverForNoManager,
    assertApproverIsSafe: assertApproverIsSafe,
    validateDateRange: validateDateRange,
    flattenBackupContacts: flattenBackupContacts,
    parseBackupContacts: parseBackupContacts,
    displayStatus: displayStatus,
    isEmployeeCancellationEligible: isEmployeeCancellationEligible,
    isEmployeeCancellationEnabled: isEmployeeCancellationEnabled,
    // exposed for reference/testing
    MIN_NOTICE_DAYS: MIN_NOTICE_DAYS,
    MAX_BACKUP_CONTACTS: MAX_BACKUP_CONTACTS,
    DEFAULT_APPROVER_NO_MANAGER: DEFAULT_APPROVER_NO_MANAGER,
    STATUS_VALUES: STATUS_VALUES,
    STATUS_LABELS: STATUS_LABELS,
    SELF_AS_BACKUP_MESSAGE: SELF_AS_BACKUP_MESSAGE,
  };
})();
