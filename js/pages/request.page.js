/*
 * request.page.js — Controller for request.html (Submit PTO Request).
 *
 * Responsibility (per PTO_CENTRAL_ARCHITECTURE.md §8.2):
 *   - Sign in; load the signed-in employee + manager chain (directory.js).
 *   - Show employee context + business-rule hints (notice days, short-notice,
 *     Sick auto-approval) using rules.js.
 *   - Validate app-required fields IN THE PAGE (requiredness is enforced in app
 *     logic, not by SharePoint columns — Phase 1C decision).
 *   - Build + create the request via requests.js, show the result, and prevent
 *     duplicate submits.
 *
 * Phase 2B scope: create only. No Teams / calendar / email.
 * On-behalf (2026-07-08: open to ALL employees): any authenticated active
 * employee can search for another ACTIVE employee and file PTO FOR them.
 * RequesterEmail/ManagerEmail then describe the EMPLOYEE (approval routing,
 * calendar, notifications); SubmittedBy* records the authenticated submitter
 * (from /me, never from form input — SharePoint's Author column is the
 * server-side backstop); RequestMode = "On behalf of". Selection is validated
 * against Entra (active, member, @mybasepay.com). Self-service is the default
 * ("Myself") and unchanged. The alternate-approver override stays HR/Admin.
 * Pages call domain modules, never Graph directly (§7).
 */

(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  function emailOf(u) { return (u && (u.mail || u.userPrincipalName)) || ""; }

  var state = {
    me: null,            // always the signed-in user (the submitter)
    isHrAdmin: false,    // gates ONLY the alternate-approver override (on-behalf is open to all employees)
    onBehalf: false,     // is the on-behalf toggle active
    lookupOk: false,     // has a valid requester been resolved for the current mode
    // The signed-in user's own chain (the default "self" target).
    self: { requester: null, manager: null, managersManager: null, managersManagerError: null },
    // The active target the request is FOR (self or a looked-up employee).
    target: { requester: null, manager: null, managersManager: null },
    // Alternate approver (HR/Admin only) — routes THIS request's approval to
    // someone other than the target's manager. Independent of on-behalf.
    approverOverride: { active: false, lookupOk: false, approver: null },
    // Optional backup contact, selected via employee lookup (or free-text
    // name-only fallback). Shape: { name, email } or null.
    backup: null,
    submitted: false,
    authorized: false,
  };

  // ---- DOM ready (script is at end of body, so elements exist) ----
  var els = {
    signin: $("signin"), signout: $("signout"), account: $("account"),
    userChip: $("user-chip"), userChipName: $("user-chip-name"),
    ptoType: $("ptoType"), startDate: $("startDate"), endDate: $("endDate"),
    reason: $("reason"), confirm: $("confirm"),
    // Backup contact = employee lookup (fills BackupContactName/Email on submit).
    backupSearch: $("backupSearch"), backupLookup: $("backupLookup"),
    backupResults: $("backupResults"), backupSelected: $("backupSelected"),
    backupSelectedText: $("backupSelectedText"), backupClear: $("backupClear"),
    backupError: $("backupError"),
    submit: $("submit"), submitStatus: $("submit-status"), error: $("error"),
    detailsTitle: $("details-title-text"),
    // "Who is this request for?" (all employees) controls.
    oboSection: $("obo-section"), oboFields: $("oboFields"),
    forWhoMyself: $("forWhoMyself"), forWhoOther: $("forWhoOther"),
    oboSearch: $("oboSearch"), oboResults: $("oboResults"),
    oboLookup: $("oboLookup"), oboReason: $("oboReason"),
    oboStatus: $("oboStatus"), oboError: $("oboError"),
    oboBadge: $("oboBadge"), oboBadgeText: $("oboBadgeText"),
    // Alternate approver (HR/Admin) controls.
    approverSection: $("approver-section"), approverToggle: $("approverToggle"),
    approverFields: $("approverFields"), approverEmail: $("approverEmail"),
    approverLookup: $("approverLookup"), approverReason: $("approverReason"),
    approverStatus: $("approverStatus"), approverError: $("approverError"),
    approverBadge: $("approverBadge"), approverBadgeText: $("approverBadgeText"),
  };

  var yearEl = $("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // Default dates to tomorrow.
  var tomorrow = PTORules.formatDateOnly(PTORules.addDays(new Date(), 1));
  els.startDate.value = tomorrow;
  els.endDate.value = tomorrow;

  // ---- error / status helpers ----
  function showError(message) {
    els.error.textContent = message;
    els.error.style.display = "block";
  }
  function clearError() {
    els.error.style.display = "none";
    els.error.textContent = "";
  }
  function setSubmitStatus(text) { els.submitStatus.textContent = text || ""; }

  function friendly(e) {
    return (e && (e.message || e.errorMessage)) ? (e.message || e.errorMessage) : String(e);
  }

  // ---- auth ----
  function renderAuth() {
    var acct = PTOAuth.getAccount();
    var signedIn = !!acct;
    // Signed in: show the user chip, hide the Sign in button entirely.
    // Signed out: show Sign in + the live status text (auto-login fallback).
    els.signin.disabled = signedIn;
    els.signin.style.display = signedIn ? "none" : "";
    els.signout.disabled = !signedIn;
    if (els.userChip) {
      els.userChip.classList.toggle("show", signedIn);
      if (signedIn && els.userChipName) {
        els.userChipName.textContent = acct.name || acct.username || acct.homeAccountId;
      }
    }
    els.account.classList.toggle("show-text", !signedIn);
    els.account.textContent = signedIn
      ? "Signed in as " + (acct.username || acct.name || acct.homeAccountId)
      : (els.account.textContent || "Not signed in.");
    refreshSubmitEnabled();
  }

  // ---- employee context ----
  function fmtUser(u) {
    if (!u) return "—";
    return (u.displayName || "?") + " · " + (u.mail || u.userPrincipalName || "no email");
  }

  async function loadContext() {
    state.me = await PTODirectory.getMe();
    var az = await PTOAuthz.enforce(state.me);
    state.authorized = az.authorized;
    if (!az.authorized) return;

    // Load the signed-in user's OWN manager chain — this is the default
    // self-service target and is unchanged from prior behavior.
    state.self.requester = state.me;
    state.self.manager = await PTODirectory.getMyManager(); // User.Read
    state.self.managersManager = null;
    state.self.managersManagerError = null;
    if (state.self.manager && state.self.manager.id) {
      try {
        // User.Read.All — escalation snapshot; non-blocking.
        state.self.managersManager = await PTODirectory.getUserManager(state.self.manager.id);
      } catch (e) {
        state.self.managersManagerError = friendly(e);
      }
    }

    // "Who is this request for?" is available to EVERY authenticated employee
    // (decision 2026-07-08): any active employee may submit on behalf of
    // another active employee. The PTO EMPLOYEE (selected) drives Requester*,
    // manager routing, calendar, and notifications; the signed-in SUBMITTER is
    // always recorded separately (SubmittedBy*, audit) from the authenticated
    // session — never from form input.
    if (els.oboSection) els.oboSection.style.display = "block";
    // HR/Admin gate stays ONLY for the alternate-approver routing override
    // (fails closed on any lookup error).
    state.isHrAdmin = await PTOAuthz.hasRole(az.email, ["HR", "Admin"]);
    if (els.approverSection) els.approverSection.style.display = state.isHrAdmin ? "block" : "none";

    // Default to the self target.
    setSelfTarget();
  }

  // ---- target (who the PTO is FOR) -----------------------------------------
  // The "target" is either the signed-in user (self) or, for HR/Admin, a
  // looked-up employee. The details panel, rule hints, validation, and submit
  // all read from state.target so the two modes share one code path.

  function renderTargetDetails() {
    var t = state.target;
    var r = t.requester || {};
    PTOUI.setText("c-name", r.displayName);
    PTOUI.setText("c-email", emailOf(r));
    PTOUI.setText("c-dept", (r.department || "—") + " / " + (r.jobTitle || "—"));
    PTOUI.setText("c-mgr", t.manager ? fmtUser(t.manager) : (r.id ? "(none found)" : "—"));
    PTOUI.setText("c-mm", t.managersManager ? fmtUser(t.managersManager) : (r.id ? "(none / unavailable)" : "—"));

    // Manager-missing warning (same rule for self and on-behalf: required unless Sick).
    var w = $("mgr-warn");
    if (r.id && !t.manager) {
      w.textContent = state.onBehalf
        ? "This employee has no manager in Entra ID. Non-Sick requests can't be routed for approval — " +
          "submit Sick (auto-approved) or contact HR (pto-approvals@mybasepay.com)."
        : "No manager found in Entra ID. Non-Sick requests cannot be routed for approval — " +
          "please contact HR (pto-approvals@mybasepay.com). Sick leave is auto-approved and can still be submitted.";
      w.style.display = "block";
    } else {
      w.style.display = "none";
    }

    // Manager's-manager warning only applies to the self path (the on-behalf
    // chain is resolved atomically in onLookup and fails the whole lookup).
    var mw = $("mm-warn");
    if (!state.onBehalf && state.self.managersManagerError) {
      mw.textContent =
        "Manager's-manager lookup unavailable (" + state.self.managersManagerError + "). " +
        "Your request can still be submitted; the escalation contact will be blank.";
      mw.style.display = "block";
    } else {
      mw.style.display = "none";
    }

    updateOboBadge();
  }

  function setSelfTarget() {
    state.onBehalf = false;
    state.lookupOk = true; // self is always resolved
    state.target = {
      requester: state.self.requester,
      manager: state.self.manager,
      managersManager: state.self.managersManager,
    };
    if (els.detailsTitle) els.detailsTitle.textContent = "Your details";
    renderTargetDetails();
    recomputeRuleUI();
    refreshSubmitEnabled();
  }

  // Toggle turned ON but no employee resolved yet — clear details and block
  // submit until a successful lookup.
  function enterOnBehalfMode() {
    state.onBehalf = true;
    state.lookupOk = false;
    state.target = { requester: null, manager: null, managersManager: null };
    if (els.detailsTitle) els.detailsTitle.textContent = "Employee details";
    renderTargetDetails();
    refreshSubmitEnabled();
  }

  function updateOboBadge() {
    if (!els.oboBadge) return;
    var r = state.onBehalf && state.lookupOk ? state.target.requester : null;
    if (r) {
      var who = r.displayName || emailOf(r) || "employee";
      var email = emailOf(r);
      els.oboBadgeText.textContent =
        "Submitting on behalf of " + who + (email ? " (" + email + ")" : "");
      els.oboBadge.classList.add("show");
    } else {
      els.oboBadge.classList.remove("show");
    }
  }

  // ---- on-behalf messages ----
  function setOboStatus(text) {
    if (!els.oboStatus) return;
    els.oboStatus.textContent = text || "";
    els.oboStatus.style.display = text ? "block" : "none";
  }
  function showOboError(text) {
    if (!els.oboError) return;
    els.oboError.textContent = text || "";
    els.oboError.style.display = text ? "block" : "none";
  }
  function clearOboMessages() { setOboStatus(""); showOboError(""); }

  // ---- alternate-approver messages ----
  function setApproverStatus(text) {
    if (!els.approverStatus) return;
    els.approverStatus.textContent = text || "";
    els.approverStatus.style.display = text ? "block" : "none";
  }
  function showApproverError(text) {
    if (!els.approverError) return;
    els.approverError.textContent = text || "";
    els.approverError.style.display = text ? "block" : "none";
  }
  function clearApproverMessages() { setApproverStatus(""); showApproverError(""); }

  function updateApproverBadge() {
    if (!els.approverBadge) return;
    var a = state.approverOverride.active && state.approverOverride.lookupOk
      ? state.approverOverride.approver
      : null;
    if (a) {
      var who = a.displayName || emailOf(a) || "approver";
      var email = emailOf(a);
      els.approverBadgeText.textContent =
        "Approval routed to " + who + (email ? " (" + email + ")" : "");
      els.approverBadge.classList.add("show");
    } else {
      els.approverBadge.classList.remove("show");
    }
  }

  // ---- alternate-approver lookup (HR/Admin) ----
  async function onApproverLookup() {
    clearApproverMessages();
    var email = (els.approverEmail.value || "").trim();
    if (!email) { showApproverError('Enter the approver’s email, then click "Lookup approver".'); return; }

    var targetEmail = emailOf(state.target.requester || {});
    if (targetEmail && email.toLowerCase() === targetEmail.toLowerCase()) {
      showApproverError("The alternate approver must be different from the employee taking the PTO.");
      return;
    }

    els.approverLookup.disabled = true;
    state.approverOverride.lookupOk = false;
    setApproverStatus("Looking up " + email + "…");
    try {
      var approver = await PTODirectory.getUserByEmail(email);
      if (!approver) {
        updateApproverBadge();
        setApproverStatus("");
        showApproverError('No employee found for "' + email + '". Check the email and try again.');
        return;
      }
      state.approverOverride.lookupOk = true;
      state.approverOverride.approver = approver;
      updateApproverBadge();
      setApproverStatus("✓ Loaded " + (approver.displayName || email) + ".");
    } catch (e) {
      state.approverOverride.lookupOk = false;
      updateApproverBadge();
      setApproverStatus("");
      showApproverError("Lookup failed: " + friendly(e));
    } finally {
      els.approverLookup.disabled = false;
    }
  }

  // ---- backup contact lookup (optional) --------------------------------------
  // Employee search by name or email (PTODirectory.searchUsers). Selecting a
  // match fills the SAME SharePoint fields as the old free-text inputs
  // (BackupContactName/BackupContactEmail via gatherInput). Never blocks a
  // submit: backup contact stays optional, and a failed lookup only shows a
  // friendly message. A "name only" fallback keeps non-employee backups
  // (e.g. an external vendor) possible.
  function showBackupError(text) {
    if (!els.backupError) return;
    els.backupError.textContent = text || "";
    els.backupError.style.display = text ? "block" : "none";
  }

  function clearBackupResults() {
    if (!els.backupResults) return;
    els.backupResults.innerHTML = "";
    els.backupResults.classList.remove("show");
  }

  function renderBackupSelected() {
    if (!els.backupSelected) return;
    if (state.backup) {
      els.backupSelectedText.textContent = "Selected: " + state.backup.name +
        (state.backup.email ? " — " + state.backup.email : "");
      els.backupSelected.classList.add("show");
    } else {
      els.backupSelected.classList.remove("show");
    }
  }

  function selectBackup(name, email) {
    state.backup = { name: name || "", email: email || "" };
    clearBackupResults();
    showBackupError("");
    if (els.backupSearch) els.backupSearch.value = "";
    renderBackupSelected();
  }

  function clearBackup() {
    state.backup = null;
    renderBackupSelected();
    showBackupError("");
  }

  function backupResultRow(label, sub, onPick) {
    var row = document.createElement("button");
    row.type = "button";
    row.className = "backup-result";
    row.setAttribute("role", "option");
    var main = document.createElement("span");
    main.textContent = label;
    row.appendChild(main);
    if (sub) {
      var s = document.createElement("span");
      s.className = "sub";
      s.textContent = sub;
      row.appendChild(s);
    }
    row.addEventListener("click", onPick);
    return row;
  }

  async function onBackupSearch() {
    showBackupError("");
    clearBackupResults();
    var q = (els.backupSearch.value || "").trim();
    if (!q) { showBackupError("Type a name or email to search for a backup contact."); return; }

    els.backupLookup.disabled = true;
    try {
      var matches = await PTODirectory.searchUsers(q);
      els.backupResults.innerHTML = "";
      (matches || []).forEach(function (u) {
        var email = emailOf(u);
        els.backupResults.appendChild(backupResultRow(
          u.displayName || email, email,
          function () { selectBackup(u.displayName || email, email); }
        ));
      });
      // Free-text fallback (name only, no email) — keeps non-employee backup
      // contacts possible and keeps a failed/empty search from being a dead end.
      els.backupResults.appendChild(backupResultRow(
        (matches && matches.length ? "Or use “" : "No employee match — use “") + q + "” as the name only",
        null,
        function () { selectBackup(q, ""); }
      ));
      els.backupResults.classList.add("show");
    } catch (e) {
      showBackupError(
        "Backup contact search is unavailable right now (" + friendly(e) + "). " +
        "You can submit without a backup contact, or try again."
      );
    } finally {
      els.backupLookup.disabled = false;
    }
  }

  // ---- employee search + selection (on-behalf — all employees) --------------
  // The selectable-employee source of truth is Entra ID via Graph
  // (PTODirectory.searchUsers / getManagerChainForUser) — never free text. An
  // arbitrary email cannot be injected: the target is only ever set from a
  // Graph user object, and the SUBMITTER is always derived from the
  // authenticated session (state.me from /me), plus SharePoint's built-in
  // Created By (Author) column records the true creator server-side.
  function employeeSelectionProblem(u) {
    var email = emailOf(u);
    if (!email) return "That account has no email address and can't be selected.";
    if (email.toLowerCase() === emailOf(state.me).toLowerCase()) {
      return "That's you — choose \"Myself\" above to submit your own PTO.";
    }
    if (u.accountEnabled === false) return "That account is inactive and can't be selected for PTO.";
    if (String(u.userType || "").toLowerCase() === "guest") return "Guest accounts can't be selected for PTO.";
    var domain = email.split("@").pop().toLowerCase();
    if (domain !== "mybasepay.com") return "Only active myBasePay employees can be selected.";
    return null; // selectable
  }

  function clearOboResults() {
    if (!els.oboResults) return;
    els.oboResults.innerHTML = "";
    els.oboResults.classList.remove("show");
  }

  function oboResultRow(u) {
    var row = document.createElement("button");
    row.type = "button";
    row.className = "backup-result";
    row.setAttribute("role", "option");
    var main = document.createElement("span");
    main.textContent = u.displayName || emailOf(u);
    row.appendChild(main);
    var s = document.createElement("span");
    s.className = "sub";
    s.textContent = emailOf(u) + (u.department ? " · " + u.department : "");
    row.appendChild(s);
    row.addEventListener("click", function () { selectEmployee(u); });
    return row;
  }

  async function onOboSearch() {
    clearOboMessages();
    clearOboResults();
    var q = (els.oboSearch.value || "").trim();
    if (!q) { showOboError("Type the employee's name or email, then click Search."); return; }

    els.oboLookup.disabled = true;
    setOboStatus("Searching for \"" + q + "\"…");
    try {
      var matches = await PTODirectory.searchUsers(q);
      setOboStatus("");
      if (!matches || !matches.length) {
        showOboError('No employee found for "' + q + '". Check the spelling and try again.');
        return;
      }
      els.oboResults.innerHTML = "";
      matches.forEach(function (u) { els.oboResults.appendChild(oboResultRow(u)); });
      els.oboResults.classList.add("show");
    } catch (e) {
      setOboStatus("");
      showOboError("Employee search failed: " + friendly(e));
    } finally {
      els.oboLookup.disabled = false;
    }
  }

  async function selectEmployee(employee) {
    clearOboMessages();
    // Validate against the trusted directory record BEFORE accepting.
    var problem = employeeSelectionProblem(employee);
    if (problem) { showOboError(problem); return; }

    clearOboResults();
    state.lookupOk = false;
    setOboStatus("Loading " + (employee.displayName || emailOf(employee)) + "…");
    try {
      // Resolve the EMPLOYEE's manager chain (User.Read.All). A hard failure here
      // throws and is caught below → submit stays blocked with a clear message.
      var chain = await PTODirectory.getManagerChainForUser(employee.id);

      state.onBehalf = true;
      state.lookupOk = true;
      state.target = {
        requester: employee,
        manager: chain.manager,
        managersManager: chain.managersManager,
      };
      if (els.detailsTitle) els.detailsTitle.textContent = "Employee details";
      renderTargetDetails();
      recomputeRuleUI();
      setOboStatus("✓ Submitting on behalf of " + (employee.displayName || emailOf(employee)) + ".");
    } catch (e) {
      state.lookupOk = false;
      updateOboBadge();
      setOboStatus("");
      showOboError("Could not load the employee's details: " + friendly(e));
    } finally {
      refreshSubmitEnabled();
    }
  }

  // ---- business-rule hints ----
  function recomputeRuleUI() {
    var type = els.ptoType.value;
    var start = els.startDate.value;

    // Sick note + manager-requirement messaging.
    PTOUI.show("sickNote", type === "Sick");
    if (type === "Sick") $("sickNote").textContent = "Sick time is auto-approved — no manager approval needed.";

    // Notice days + short-notice warning.
    if (start) {
      var noticeDays = PTORules.calculateNoticeDays(start, new Date());
      $("notice").textContent = "Notice: " + noticeDays + " day(s) before start date.";
      PTOUI.show("notice", true);

      if (PTORules.isShortNotice(noticeDays)) {
        $("shortNotice").textContent =
          "This request is less than 7 days away and will be flagged for HR review.";
        PTOUI.show("shortNotice", true);
      } else {
        PTOUI.show("shortNotice", false);
      }
    } else {
      PTOUI.show("notice", false);
      PTOUI.show("shortNotice", false);
    }
  }

  // ---- validation (app-enforced; SharePoint columns are optional) ----
  function validate() {
    if (!state.me) return "Please sign in first.";

    // On-behalf: a valid employee must be resolved before anything else.
    if (state.onBehalf && (!state.lookupOk || !state.target.requester)) {
      return 'Select the employee first — search by name or email and pick them from the results.';
    }

    var type = els.ptoType.value;
    if (!type) return "Choose a PTO type.";
    if (!els.startDate.value) return "Choose a start date.";
    if (!els.endDate.value) return "Choose an end date.";
    if (els.endDate.value < els.startDate.value) return "End date must be on or after the start date.";

    // Manager required unless Sick (Sick is auto-approved). Applies to the
    // resolved target — the employee for on-behalf, the signed-in user otherwise.
    if (type !== "Sick" && !state.target.manager) {
      return state.onBehalf
        ? "This employee has no manager in Entra ID, so the request can't be routed for approval. " +
          "Submit Sick (auto-approved) or contact HR (pto-approvals@mybasepay.com)."
        : "No manager found in Entra ID, so this request can't be routed for approval. " +
          "Contact HR (pto-approvals@mybasepay.com), or submit Sick leave which is auto-approved.";
    }

    // Alternate approver (HR/Admin only): a valid approver + reason required
    // whenever the toggle is on.
    if (state.approverOverride.active) {
      if (!state.approverOverride.lookupOk || !state.approverOverride.approver) {
        return 'Look up the alternate approver first — enter their email and click "Lookup approver".';
      }
      if (!els.approverReason.value.trim()) {
        return "Enter a reason for routing approval to an alternate approver.";
      }
    }

    if (!els.confirm.checked) return 'Please check "I confirm this PTO request is accurate".';
    return null; // ok
  }

  function refreshSubmitEnabled() {
    // Submit is enabled when signed in and not already submitted; detailed
    // validation runs on click so the user sees a specific reason.
    els.submit.disabled = state.submitted || !PTOAuth.getAccount();
  }

  // ---- submit ----
  function gatherInput() {
    return {
      ptoType: els.ptoType.value,
      startDate: els.startDate.value,
      endDate: els.endDate.value,
      reason: els.reason.value,
      // Backup contact comes from the employee lookup (state.backup); the
      // SharePoint fields BackupContactName/BackupContactEmail are unchanged.
      backupContactName: state.backup ? state.backup.name : "",
      backupContactEmail: state.backup ? state.backup.email : "",
      // Partial day was removed from the UI (2026-07-03). Safe defaults keep
      // buildCreateRequestFields' contract intact: IsPartialDay = false is
      // still written; Hours is omitted (only written for partial days).
      isPartialDay: false,
      hours: "",
      onBehalfReason: state.onBehalf ? els.oboReason.value : "",
    };
  }

  /**
   * Production confirmation after a successful submit: request key, status
   * badge, and the short-notice flag only when it applies. No item id, no
   * SharePoint link, no approval link — status tracking happens in
   * my-requests.html / hr.html. (The Phase-3B internal approval-link test
   * panel was removed for production on 2026-07-03; manager notification
   * behavior is unchanged by that removal.)
   */
  function renderResult(fields) {
    PTOUI.setText("r-key", fields.Title);
    var statusDd = $("r-status");
    statusDd.textContent = "";
    statusDd.appendChild(PTOUI.statusBadge(fields.Status));

    var isShort = !!fields.IsShortNotice;
    var shortLabel = $("r-short-label");
    var shortDd = $("r-short");
    if (shortLabel) shortLabel.style.display = isShort ? "" : "none";
    if (shortDd) {
      shortDd.style.display = isShort ? "" : "none";
      shortDd.textContent = "Yes — flagged for HR review";
    }

    // Reveal the result panel (PTOUI.show sets an explicit display:block, which
    // overrides the stylesheet's `#result { display: none }`).
    PTOUI.show("result", true);
  }

  async function onSubmit() {
    clearError();
    if (!state.authorized) { showError("Not authorized to submit PTO requests."); return; }
    var problem = validate();
    if (problem) { showError(problem); return; }

    els.submit.disabled = true;
    setSubmitStatus("Submitting…");
    try {
      var input = gatherInput();
      var context = {
        requester: state.target.requester, // the employee the PTO is FOR (self by default)
        submitter: state.me,               // who actually filled the form
        manager: state.target.manager,
        managersManager: state.target.managersManager,
        onBehalf: state.onBehalf,
        approverOverride: state.approverOverride.active
          ? { approver: state.approverOverride.approver, reason: els.approverReason.value }
          : null,
      };
      var fields = PTORequests.buildCreateRequestFields(input, context);
      await PTORequests.createRequest(fields);

      state.submitted = true; // prevent duplicate submits
      renderResult(fields);
      var statusMsg = state.onBehalf
        ? "✓ Submitted on behalf of " + (state.target.requester.displayName || emailOf(state.target.requester)) + "."
        : "✓ Submitted.";
      if (context.approverOverride) {
        statusMsg += " Approval routed to " +
          (context.approverOverride.approver.displayName || emailOf(context.approverOverride.approver)) + ".";
      }
      setSubmitStatus(statusMsg + " Submit is disabled to avoid duplicates.");
      els.submit.textContent = "Submitted";
    } catch (e) {
      setSubmitStatus("");
      // Detailed INTERNAL diagnostics (console only) — endpoint, method, HTTP
      // status, Graph error code, and stage. Never shown to the user.
      var status = e && e.status;
      console.error("[request.page] Submit failed", {
        stage: "PTORequests.createRequest",
        httpStatus: status || "(none)",
        graphMethod: (e && e.graphMethod) || "(n/a)",
        endpoint: (e && e.graphUrl) || "(n/a)",
        graphErrorCode: (e && e.graphErrorCode) || "(n/a)",
        reason: friendly(e),
        requesterEmail: emailOf(state.target.requester || {}),
        onBehalf: state.onBehalf,
      });
      // User-facing copy: friendly, never the raw "Graph 403: Access denied".
      var accessDenied = status === 403 ||
        /\b403\b|access denied|accessdenied|authorization/i.test(friendly(e));
      if (accessDenied) {
        showError(
          "We couldn't submit your request because of a system permissions issue on the PTO " +
          "list — this is not a problem with your account. Please contact Tech Support " +
          "(reference PTO-SP-403) so they can enable submissions for you or file the request on your behalf."
        );
      } else {
        showError(
          "We couldn't submit your request right now. Please try again in a moment, and contact " +
          "Tech Support if the problem continues."
        );
      }
      els.submit.disabled = false; // allow retry on failure
    }
  }

  // ---- wiring ----
  els.ptoType.addEventListener("change", recomputeRuleUI);
  els.startDate.addEventListener("change", recomputeRuleUI);
  els.endDate.addEventListener("change", recomputeRuleUI);
  els.confirm.addEventListener("change", refreshSubmitEnabled);

  // Backup contact lookup (optional).
  if (els.backupLookup) els.backupLookup.addEventListener("click", onBackupSearch);
  if (els.backupSearch) {
    els.backupSearch.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); onBackupSearch(); }
    });
  }
  if (els.backupClear) els.backupClear.addEventListener("click", clearBackup);

  // On-behalf (HR/Admin): toggle reveals the lookup; switching off restores self.
  // "Who is this request for?" radios — Myself (default) / Another employee.
  function onForWhoChange() {
    var other = !!(els.forWhoOther && els.forWhoOther.checked);
    if (els.oboFields) els.oboFields.classList.toggle("show", other);
    clearOboMessages();
    clearOboResults();
    if (other) {
      enterOnBehalfMode();
    } else {
      if (els.oboSearch) els.oboSearch.value = "";
      els.oboReason.value = "";
      setSelfTarget();
    }
  }
  if (els.forWhoMyself) els.forWhoMyself.addEventListener("change", onForWhoChange);
  if (els.forWhoOther) els.forWhoOther.addEventListener("change", onForWhoChange);
  if (els.oboLookup) els.oboLookup.addEventListener("click", onOboSearch);
  if (els.oboSearch) {
    els.oboSearch.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); onOboSearch(); }
    });
  }

  // Alternate approver (HR/Admin): toggle reveals the lookup; switching off clears it.
  if (els.approverToggle) {
    els.approverToggle.addEventListener("change", function () {
      var on = els.approverToggle.checked;
      state.approverOverride.active = on;
      if (els.approverFields) els.approverFields.classList.toggle("show", on);
      clearApproverMessages();
      if (!on) {
        state.approverOverride.lookupOk = false;
        state.approverOverride.approver = null;
        els.approverEmail.value = "";
        els.approverReason.value = "";
      }
      updateApproverBadge();
    });
  }
  if (els.approverLookup) els.approverLookup.addEventListener("click", onApproverLookup);
  if (els.approverEmail) {
    els.approverEmail.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); onApproverLookup(); }
    });
  }

  els.signin.addEventListener("click", async function () {
    clearError();
    els.signin.disabled = true;
    try {
      // Manual, gesture-driven → popup is fine here (and preserves page state).
      await PTOAuth.signIn();
      clearAutoLoginFlag(); // future signed-out visits may auto-login again
      renderAuth();
      await loadContext();
    } catch (e) {
      showError("Sign-in / context load failed: " + friendly(e));
    } finally {
      renderAuth();
    }
  });

  els.signout.addEventListener("click", async function () {
    clearError();
    try { await PTOAuth.signOut(); } catch (e) { showError(friendly(e)); }
    finally { renderAuth(); }
  });

  els.submit.addEventListener("click", onSubmit);

  // ---- boot -------------------------------------------------------------------
  // Auto sign-in, same pattern as hr.html (validated live): browsers block
  // popups at page load, so a same-tab loginRedirect is used instead. On return
  // from Microsoft, PTOAuth.initialize()'s handleRedirectPromise() captures the
  // account, so this boot simply finds getAccount() populated and takes the
  // normal signed-in path.
  //
  // LOOP GUARD: the redirect is attempted at most ONCE per tab session, via a
  // sessionStorage flag set BEFORE navigating away. Returning cancelled/failed
  // (no account, flag present) → manual Sign in button fallback, never a second
  // automatic redirect. If sessionStorage can't persist the flag, no
  // auto-redirect at all (a loop there would be undetectable). The flag clears
  // on any successful sign-in.
  //
  // SECURITY UNCHANGED: no directory/context data loads until PTOAuth confirms
  // a signed-in account AND PTOAuthz.enforce (inside loadContext) authorizes;
  // the HR/Admin gates for on-behalf + alternate approver are inside
  // loadContext and unaffected.
  var AUTO_LOGIN_FLAG = "request_auto_login_attempted";

  function autoLoginAttempted() {
    try { return sessionStorage.getItem(AUTO_LOGIN_FLAG) === "1"; } catch (e) { return true; }
  }
  function markAutoLoginAttempted() {
    // True only if the flag VERIFIABLY persisted — the redirect is gated on
    // that, so broken storage can never produce a redirect loop.
    try {
      sessionStorage.setItem(AUTO_LOGIN_FLAG, "1");
      return sessionStorage.getItem(AUTO_LOGIN_FLAG) === "1";
    } catch (e) { return false; }
  }
  function clearAutoLoginFlag() {
    try { sessionStorage.removeItem(AUTO_LOGIN_FLAG); } catch (e) {}
  }

  (async function boot() {
    try {
      await PTOAuth.initialize(); // handles a returning redirect internally
      renderAuth();

      if (PTOAuth.getAccount()) {
        // Signed in (cached session or just back from the redirect).
        clearAutoLoginFlag();
        await loadContext();
        return;
      }

      if (!autoLoginAttempted() && markAutoLoginAttempted()) {
        els.signin.disabled = true;
        els.account.textContent = "Redirecting to Microsoft sign-in…";
        els.account.classList.add("show-text");
        try {
          await PTOAuth.signInRedirect(); // navigates away; won't resolve on success
          return;
        } catch (e) {
          // The redirect call itself failed (config/init error) — fall through
          // to the manual fallback. The flag stays set: no automatic retry.
          console.warn("[request.page] auto sign-in redirect failed:", friendly(e));
        }
      }

      // Already attempted this tab session (user cancelled at Microsoft, auth
      // failed, or the redirect call errored) — or storage can't persist the
      // guard flag. Show the manual button; never auto-retry.
      renderAuth();
      els.account.textContent = "Not signed in — click Sign in to continue.";
      els.account.classList.add("show-text");
    } catch (e) {
      showError("Initialization failed: " + friendly(e));
    }
  })();
})();
