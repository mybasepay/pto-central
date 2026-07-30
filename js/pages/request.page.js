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
    // (No role gates remain on this page: on-behalf AND alternate approver
    // are available to every authenticated employee as of 2026-07-08.)
    onBehalf: false,     // is the on-behalf toggle active
    lookupOk: false,     // has a valid requester been resolved for the current mode
    // The signed-in user's own chain (the default "self" target).
    self: { requester: null, manager: null, managersManager: null, managersManagerError: null },
    // The active target the request is FOR (self or a looked-up employee).
    target: { requester: null, manager: null, managersManager: null },
    // Alternate approver (HR/Admin only) — routes THIS request's approval to
    // someone other than the target's manager. Independent of on-behalf.
    approverOverride: { active: false, lookupOk: false, approver: null },
    // Required backup contacts, selected from the employee directory.
    // Shape: [{ name, email }], min 1, max PTORules.MAX_BACKUP_CONTACTS.
    backups: [],
    submitted: false,
    authorized: false,
    requestType: null,  // "self" | "other" after the first-step choice
    canSubmitForOthers: true,
  };

  // ---- DOM ready (script is at end of body, so elements exist) ----
  var els = {
    signin: $("signin"), signout: $("signout"), account: $("account"),
    userChip: $("user-chip"), userChipName: $("user-chip-name"),
    ptoType: $("ptoType"), startDate: $("startDate"), endDate: $("endDate"),
    reason: $("reason"),
    // Backup contact = employee lookup (fills BackupContactName/Email on submit).
    backupSearch: $("backupSearch"),
    backupResults: $("backupResults"), backupSelected: $("backupSelected"),
    backupSelectedText: $("backupSelectedText"), backupClear: $("backupClear"),
    backupError: $("backupError"), backupNotified: $("backupNotified"),
    backupNotifiedBox: $("backupNotifiedBox"),
    submit: $("submit"), submitText: $("submitText"), submitStatus: $("submit-status"), error: $("error"),
    detailsTitle: $("details-title-text"),
    // "Who is this request for?" (all employees) controls.
    oboSection: $("obo-section"), oboFields: $("oboFields"),
    forWhoMyself: $("forWhoMyself"), forWhoOther: $("forWhoOther"),
    oboSearch: $("oboSearch"), oboResults: $("oboResults"),
    oboReason: $("oboReason"),
    oboStatus: $("oboStatus"), oboError: $("oboError"),
    oboSelected: $("oboSelected"), oboSelectedText: $("oboSelectedText"), oboClear: $("oboClear"),
    oboBadge: $("oboBadge"), oboBadgeText: $("oboBadgeText"),
    // Alternate approver (HR/Admin) controls.
    approverSection: $("approver-section"), approverToggle: $("approverToggle"),
    approverFields: $("approverFields"), approverEmail: $("approverEmail"),
    approverReason: $("approverReason"),
    approverResults: $("approverResults"),
    approverStatus: $("approverStatus"), approverError: $("approverError"),
    approverBadge: $("approverBadge"), approverBadgeText: $("approverBadgeText"),
    requestTypeStep: $("request-type-step"), requestFormShell: $("request-form-shell"),
    requestTypeSelf: $("requestTypeSelf"), requestTypeOther: $("requestTypeOther"),
    requestTypeChange: $("requestTypeChange"), requestPageTitle: $("request-page-title"),
    requestPageDesc: $("request-page-desc"), routeDefault: $("routeDefault"),
    approverEdit: $("approverEdit"), approverRestore: $("approverRestore"),
    requestTypeError: $("requestTypeError"), requestContext: $("request-context"),
    reviewList: $("review-list"),
    reasonCount: $("reasonCount"), oboReasonCount: $("oboReasonCount"),
    dateError: $("dateError"), copySubmitter: $("copySubmitter"),
    copySubmitterBox: $("copySubmitterBox"),
  };
  var backupPicker = null;
  var employeePicker = null;
  var approverPicker = null;

  var yearEl = $("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // Default dates to tomorrow.
  var tomorrow = PTORules.formatDateOnly(PTORules.addDays(new Date(), 1));
  els.startDate.value = tomorrow;
  els.endDate.value = tomorrow;
  els.endDate.min = tomorrow;

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
    return (u.displayName || "?") + "\n" + (u.mail || u.userPrincipalName || "no email");
  }

  function setSubmitText(text) {
    if (els.submitText) els.submitText.textContent = text;
    else if (els.submit) els.submit.textContent = text;
  }

  function updateCharCount(input, counter) {
    if (!input || !counter) return;
    var max = Number(input.getAttribute("maxlength")) || 250;
    counter.textContent = String(input.value.length) + " / " + max;
  }

  function setDateError(text) {
    if (!els.dateError) return;
    els.dateError.textContent = text || "";
    els.dateError.style.display = text ? "block" : "none";
    if (els.endDate) {
      if (text) els.endDate.setAttribute("aria-invalid", "true");
      else els.endDate.removeAttribute("aria-invalid");
    }
  }

  function repairDateRange() {
    if (!els.startDate || !els.endDate) return;
    if (els.startDate.value) els.endDate.min = els.startDate.value;
    if (els.startDate.value && els.endDate.value && els.endDate.value < els.startDate.value) {
      els.endDate.value = els.startDate.value;
    }
    var bad = els.startDate.value && els.endDate.value && els.endDate.value < els.startDate.value;
    setDateError(bad ? "End date must be on or after the start date." : "");
  }

  // No-manager guidance: this is now purely informational text (see
  // #approverGuidance in request.html) plus the same manager-missing
  // warning below — there is NO automatic approver resolution or fallback
  // of any kind. An employee with no manager must manually select an
  // alternate approver (which may or may not be Maggie Mondragon) through
  // the existing "Route approval to someone else" control; that selection
  // goes through the exact same PTORules.userSelectionProblem() +
  // assertApproverIsSafe() validation as any other manually chosen
  // approver — no special-cased exception for any name.
  var NO_MANAGER_GUIDANCE_MESSAGE =
    "If you do not have a manager, or your manager is unavailable, select Maggie Mondragon as your approver.";

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
    // always recorded separately (SubmittedBy*) from the authenticated
    // session — never from form input.
    if (window.PTODemo && window.PTODemo.active && window.PTODemo.persona && window.PTODemo.persona() === "limited") {
      state.canSubmitForOthers = false;
    }
    if (els.oboSection) els.oboSection.style.display = "none";
    // "Route approval to someone else" is ALSO available to every
    // authenticated employee (2026-07-08 — was HR/Admin-only, which is why
    // non-HR accounts couldn't see it). The approver must still resolve from
    // the directory and pass PTORules.userSelectionProblem + context checks;
    // this also unblocks requesters with NO manager in Entra (they can route
    // approval to a chosen approver instead of being stuck).
    if (els.approverSection) els.approverSection.style.display = "none";

    renderRequestTypeGate();
  }

  function renderRequestTypeGate() {
    if (els.requestTypeStep) {
      els.requestTypeStep.style.display = state.requestType ? "none" : "block";
      els.requestTypeStep.classList.toggle("is-chosen", !!state.requestType);
    }
    if (els.requestFormShell) els.requestFormShell.hidden = !state.requestType;
    if (els.requestFormShell) {
      els.requestFormShell.classList.toggle("is-self", state.requestType === "self");
      els.requestFormShell.classList.toggle("is-other", state.requestType === "other");
    }
    document.body.classList.toggle("request-mode-self", state.requestType === "self");
    document.body.classList.toggle("request-mode-other", state.requestType === "other");
    if (els.requestTypeChange) els.requestTypeChange.hidden = !state.requestType;
    if (els.requestPageTitle) {
      els.requestPageTitle.textContent = state.requestType === "self"
        ? "My PTO Request"
        : state.requestType === "other"
          ? "PTO Request for Another Employee"
          : "Submit PTO Request";
    }
    if (els.requestPageDesc) {
      els.requestPageDesc.textContent = state.requestType === "self"
        ? "Create a PTO request for your own time off."
        : state.requestType === "other"
          ? "Create a PTO request on behalf of an eligible employee."
          : "Choose who this request is for to begin.";
    }
    if (els.requestTypeSelf) els.requestTypeSelf.setAttribute("aria-pressed", state.requestType === "self" ? "true" : "false");
    if (els.requestTypeOther) els.requestTypeOther.setAttribute("aria-pressed", state.requestType === "other" ? "true" : "false");
    if (els.copySubmitterBox) els.copySubmitterBox.style.display = state.requestType ? "flex" : "none";
  }

  function hasMeaningfulEntry() {
    return !!(
      (els.reason && els.reason.value.trim()) ||
      (els.oboReason && els.oboReason.value.trim()) ||
      (els.approverReason && els.approverReason.value.trim()) ||
      state.lookupOk && state.onBehalf ||
      state.approverOverride.lookupOk
    );
  }

  function changeRequestType() {
    if (hasMeaningfulEntry() && !window.confirm("Changing request type will clear the selected employee, approver, and notes that no longer apply. Continue?")) {
      return;
    }
    state.requestType = null;
    state.onBehalf = false;
    state.lookupOk = false;
    state.target = { requester: null, manager: null, managersManager: null };
    if (els.oboSearch) els.oboSearch.value = "";
    if (els.oboReason) els.oboReason.value = "";
    if (employeePicker) employeePicker.clear(false);
    updateCharCount(els.oboReason, els.oboReasonCount);
    clearOboMessages();
    clearOboResults();
    resetApproverOverride();
    renderTargetDetails();
    renderRequestTypeGate();
    refreshSubmitEnabled();
    renderReview();
  }

  function setRequestContext(text, onBehalf) {
    if (!els.requestContext) return;
    els.requestContext.textContent = text || "";
    els.requestContext.classList.toggle("on-behalf", !!onBehalf);
  }

  function resetApproverOverride() {
    state.approverOverride = { active: false, lookupOk: false, approver: null };
    if (els.approverToggle) els.approverToggle.checked = false;
    if (els.approverFields) els.approverFields.classList.remove("show");
    if (els.approverFields) els.approverFields.style.display = "none";
    if (els.approverEmail) els.approverEmail.value = "";
    if (els.approverReason) els.approverReason.value = "";
    if (els.approverResults) {
      els.approverResults.innerHTML = "";
      els.approverResults.classList.remove("show");
    }
    clearApproverMessages();
    updateApproverBadge();
    renderApprovalRoute();
  }

  function chooseRequestType(type) {
    clearError();
    if (els.requestTypeError) {
      els.requestTypeError.textContent = "";
      els.requestTypeError.style.display = "none";
    }
    state.requestType = type;
    resetApproverOverride();
    if (type === "self") {
      if (els.forWhoMyself) els.forWhoMyself.checked = true;
      if (els.forWhoOther) els.forWhoOther.checked = false;
      if (els.oboSection) els.oboSection.style.display = "none";
      if (els.oboFields) els.oboFields.classList.remove("show");
      if (els.approverSection) els.approverSection.style.display = "block";
      setSubmitText("Submit my PTO request");
      setRequestContext("", false);
      setSelfTarget();
    } else {
      if (!state.canSubmitForOthers) {
        state.requestType = null;
        if (els.requestTypeError) {
          els.requestTypeError.textContent = "Your demo persona is not authorized to submit for another employee.";
          els.requestTypeError.style.display = "block";
        }
        renderRequestTypeGate();
        return;
      }
      if (els.forWhoMyself) els.forWhoMyself.checked = false;
      if (els.forWhoOther) els.forWhoOther.checked = true;
      if (els.oboSection) els.oboSection.style.display = "block";
      if (els.oboFields) els.oboFields.classList.add("show");
      if (els.approverSection) els.approverSection.style.display = "block";
      setSubmitText("Submit PTO request for employee");
      setRequestContext("", true);
      enterOnBehalfMode();
    }
    renderRequestTypeGate();
    renderReview();
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
    PTOUI.setText("c-mgr", t.manager ? fmtUser(t.manager) : (r.id ? "No default manager found" : "—"));

    // Manager-missing warning (same rule for self and on-behalf: required unless Sick).
    // No automatic approver assignment of any kind — the employee must
    // manually select an approver via the existing alternate-approver
    // control (see #approverGuidance in request.html for the persistent hint).
    var w = $("mgr-warn");
    if (r.id && !t.manager) {
      w.textContent = (state.onBehalf
        ? "This employee has no manager in Entra ID. "
        : "No manager found in Entra ID for your account. ") +
        "Please select an approver above.";
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
    renderApprovalRoute();
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
    renderReview();
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
    renderReview();
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
        "Selected approver: " + who + (email ? " (" + email + ")" : "");
      els.approverBadge.classList.add("show");
    } else {
      els.approverBadge.classList.remove("show");
    }
  }

  function renderApprovalRoute() {
    if (els.routeDefault) els.routeDefault.textContent = defaultApproverLabel();
    if (els.approverEdit) {
      els.approverEdit.textContent = state.target.manager ? "Change approver" : "Select approver";
    }
    // No automatic-fallback concept anywhere below — "needsRoute" (a
    // manager-less, non-Sick request) is resolved ONLY by the employee
    // manually selecting an approver (state.approverOverride), never by any
    // system-assigned default.
    if (els.approverSection) {
      var hasSelected = !!(state.approverOverride.active && state.approverOverride.lookupOk);
      var needsRoute = !!(state.target.requester && !state.target.manager && els.ptoType && els.ptoType.value !== "Sick");
      els.approverSection.classList.toggle("has-selected-approver", hasSelected);
      els.approverSection.classList.toggle("needs-approver", needsRoute && !hasSelected);
      var managerWarn = $("mgr-warn");
      if (managerWarn && needsRoute) {
        managerWarn.style.display = hasSelected ? "none" : "block";
      }
    }
    if (els.approverFields) {
      var needsRoute = !!(state.target.requester && !state.target.manager && els.ptoType && els.ptoType.value !== "Sick");
      var editing = state.approverOverride.active && !state.approverOverride.lookupOk;
      var hasSelectedApprover = !!(state.approverOverride.active && state.approverOverride.lookupOk);
      els.approverFields.style.display = ((needsRoute && !hasSelectedApprover) || editing) ? "block" : "none";
    }
    updateApproverBadge();
  }

  function showApproverEditor() {
    state.approverOverride.active = true;
    state.approverOverride.lookupOk = false;
    state.approverOverride.approver = null;
    if (els.approverToggle) els.approverToggle.checked = true;
    if (els.approverFields) els.approverFields.style.display = "block";
    if (els.approverEmail) els.approverEmail.value = "";
    clearApproverResults();
    updateApproverBadge();
    renderReview();
    setTimeout(function () { if (els.approverEmail) els.approverEmail.focus(); }, 0);
  }

  function restoreDefaultApprover() {
    resetApproverOverride();
    renderApprovalRoute();
    renderReview();
  }

  function clearApproverResults() {
    if (!els.approverResults) return;
    els.approverResults.innerHTML = "";
    els.approverResults.classList.remove("show");
  }

  function approverProblem(approver) {
    var problem = PTORules.userSelectionProblem(approver);
    if (!problem && emailOf(approver).toLowerCase() === emailOf(state.me).toLowerCase()) {
      problem = "You can't route approval to yourself.";
    }
    if (!problem) {
      var reqEmail = emailOf(state.target.requester || {});
      if (reqEmail && emailOf(approver).toLowerCase() === reqEmail.toLowerCase()) {
        problem = "The selected approver must be different from the employee receiving PTO.";
      }
    }
    return problem;
  }

  function selectApprover(approver) {
    clearApproverMessages();
    clearApproverResults();
    var problem = approverProblem(approver);
    if (problem) {
      state.approverOverride.lookupOk = false;
      state.approverOverride.approver = null;
      updateApproverBadge();
      renderReview();
      showApproverError(problem);
      return;
    }
    state.approverOverride.active = true;
    state.approverOverride.lookupOk = true;
    state.approverOverride.approver = approver;
    if (els.approverEmail) els.approverEmail.value = approver.displayName || emailOf(approver);
    if (els.approverFields) els.approverFields.style.display = "none";
    updateApproverBadge();
    renderApprovalRoute();
    setApproverStatus("✓ Approval will be routed to " + (approver.displayName || emailOf(approver)) + ".");
    renderReview();
  }

  // ---- backup contact lookup (required) --------------------------------------
  // Employee search by name or email (PTODirectory.searchUsers). Selecting a
  // match fills the SAME SharePoint fields as the old backup inputs
  // (BackupContactName/BackupContactEmail via gatherInput). Free text is not
  // accepted because approvals and handoffs need a trusted directory contact.
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

  function backupLabel(c) {
    return (c && c.name ? c.name : "") + (c && c.email ? "\n" + c.email : "");
  }

  function renderBackupSelected() {
    if (!els.backupSelected) return;
    els.backupSelected.innerHTML = "";
    if (els.backupSelectedText) {
      els.backupSelectedText.textContent = state.backups.length
        ? state.backups.length + " selected"
        : "-";
    }
    if (state.backups.length) {
      state.backups.forEach(function (backup, idx) {
        var chip = document.createElement("span");
        chip.className = "person-chip backup-chip show";
        var text = document.createElement("span");
        text.className = "txt";
        text.textContent = backup.name + (backup.email ? " — " + backup.email : "");
        var btn = document.createElement("button");
        btn.className = "clear";
        btn.type = "button";
        btn.setAttribute("aria-label", "Remove backup contact " + backup.name);
        btn.textContent = "×";
        btn.addEventListener("click", function () { removeBackup(idx); });
        chip.appendChild(text);
        chip.appendChild(btn);
        els.backupSelected.appendChild(chip);
      });
      els.backupSelected.classList.add("show");
    } else {
      els.backupSelected.classList.remove("show");
    }
    renderReview();
  }

  function resetBackupNotified() {
    if (els.backupNotified) els.backupNotified.checked = false;
  }

  function selectBackup(name, email) {
    var normalized = String(email || "").trim().toLowerCase();
    if (!normalized) { showBackupError("Select a backup contact from the suggestions first."); return; }
    var requesterEmail = String(emailOf(state.target.requester || "")).trim().toLowerCase();
    if (requesterEmail && normalized === requesterEmail) {
      showBackupError(PTORules.SELF_AS_BACKUP_MESSAGE);
      if (backupPicker) backupPicker.clear(false);
      return;
    }
    if (state.backups.some(function (b) { return String(b.email || "").trim().toLowerCase() === normalized; })) {
      showBackupError("That backup contact is already selected.");
      if (backupPicker) backupPicker.clear(false);
      return;
    }
    if (state.backups.length >= PTORules.MAX_BACKUP_CONTACTS) {
      showBackupError("Select no more than " + PTORules.MAX_BACKUP_CONTACTS + " backup contacts.");
      if (backupPicker) backupPicker.clear(false);
      return;
    }
    state.backups.push({ name: name || email || "", email: email || "" });
    clearBackupResults();
    if (backupPicker) backupPicker.clear(false);
    if (els.backupSearch) els.backupSearch.value = "";
    resetBackupNotified();
    showBackupError("");
    renderBackupSelected();
  }

  function removeBackup(index) {
    state.backups.splice(index, 1);
    resetBackupNotified();
    renderBackupSelected();
    showBackupError("");
  }

  function clearBackup() {
    state.backups = [];
    if (backupPicker) backupPicker.clear(false);
    if (els.backupSearch) els.backupSearch.value = "";
    resetBackupNotified();
    renderBackupSelected();
    showBackupError("");
  }

  // ---- employee search + selection (on-behalf — all employees) --------------
  // The selectable-employee source of truth is Entra ID via Graph
  // (PTODirectory.searchUsers / getManagerChainForUser) — never free text. An
  // arbitrary email cannot be injected: the target is only ever set from a
  // Graph user object, and the SUBMITTER is always derived from the
  // authenticated session (state.me from /me), plus SharePoint's built-in
  // Created By (Author) column records the true creator server-side.
  function employeeSelectionProblem(u) {
    // Shared pure checks (active / Member / @mybasepay.com / valid email).
    var base = PTORules.userSelectionProblem(u);
    if (base) return base;
    // Context rule: can't select yourself as the on-behalf employee.
    if (emailOf(u).toLowerCase() === emailOf(state.me).toLowerCase()) {
      return "That's you — choose \"Myself\" above to submit your own PTO.";
    }
    return null; // selectable
  }

  function clearOboResults() {
    if (!els.oboResults) return;
    els.oboResults.innerHTML = "";
    els.oboResults.classList.remove("show");
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
      resetApproverOverride();
      renderTargetDetails();
      recomputeRuleUI();
      if (els.oboSelectedText) {
        els.oboSelectedText.textContent = (employee.displayName || emailOf(employee)) +
          (emailOf(employee) ? " — " + emailOf(employee) : "");
      }
      setOboStatus("✓ Submitting on behalf of " + (employee.displayName || emailOf(employee)) + ".");
    } catch (e) {
      state.lookupOk = false;
      updateOboBadge();
      setOboStatus("");
      showOboError("Could not load the employee's details: " + friendly(e));
    } finally {
      refreshSubmitEnabled();
      renderReview();
    }
  }

  function initPeoplePickers() {
    if (els.backupSearch && !backupPicker) {
      backupPicker = PTOUI.peoplePicker({
        input: els.backupSearch,
        results: els.backupResults,
        selected: els.backupSelected,
        selectedText: els.backupSelectedText,
        clear: els.backupClear,
        status: els.backupError,
        onSelect: function (u) { selectBackup(u.displayName || emailOf(u), emailOf(u)); },
        onClear: function () { renderBackupSelected(); },
      });
    }
    if (els.oboSearch && !employeePicker) {
      employeePicker = PTOUI.peoplePicker({
        input: els.oboSearch,
        results: els.oboResults,
        selected: els.oboSelected,
        selectedText: els.oboSelectedText,
        clear: els.oboClear,
        status: els.oboError,
        onSelect: selectEmployee,
        onClear: function () {
          state.lookupOk = false;
          state.target = { requester: null, manager: null, managersManager: null };
          resetApproverOverride();
          renderTargetDetails();
          refreshSubmitEnabled();
          renderReview();
        },
      });
    }
    if (els.approverEmail && !approverPicker) {
      approverPicker = PTOUI.peoplePicker({
        input: els.approverEmail,
        results: els.approverResults,
        status: els.approverError,
        onSelect: selectApprover,
        onClear: function () {
          state.approverOverride.lookupOk = false;
          state.approverOverride.approver = null;
          updateApproverBadge();
          renderReview();
        },
      });
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
      $("notice").textContent = PTORules.isShortNotice(noticeDays)
        ? "Short notice: This request starts in " + noticeDays + " day(s) and will be flagged for HR review."
        : "Notice: " + noticeDays + " day(s) before start date.";
      PTOUI.show("notice", true);
      PTOUI.show("shortNotice", false);
    } else {
      PTOUI.show("notice", false);
      PTOUI.show("shortNotice", false);
    }
    renderApprovalRoute();
  }

  // ---- validation (app-enforced; SharePoint columns are optional) ----
  function validate() {
    if (!state.me) return "Please sign in first.";
    if (!state.requestType) return "Choose whether this PTO request is for yourself or another employee.";

    // On-behalf: a valid employee must be resolved before anything else.
    if (state.onBehalf && (!state.lookupOk || !state.target.requester)) {
      return 'Select the employee first — search by name or email and pick them from the results.';
    }

    var type = els.ptoType.value;
    if (!type) return "Choose a PTO type.";
    if (!els.startDate.value) return "Choose a start date.";
    if (!els.endDate.value) return "Choose an end date.";
    try { PTORules.validateDateRange(els.startDate.value, els.endDate.value); }
    catch (e) { setDateError("End date must be on or after the start date."); return "End date must be on or after the start date."; }
    if (els.backupSearch && els.backupSearch.value.trim()) {
      return "Select the backup contact from the suggestions or clear the backup search text.";
    }
    if (!state.backups.length) return "Select at least one backup contact before submitting.";
    var requesterEmail = String(emailOf(state.target.requester || "")).trim().toLowerCase();
    if (requesterEmail && state.backups.some(function (b) { return String(b.email || "").trim().toLowerCase() === requesterEmail; })) {
      return "The employee taking PTO can't be selected as their own backup contact.";
    }
    if (!els.backupNotified || !els.backupNotified.checked) return 'Please check "I have notified all backup contacts".';

    // An approval route is required unless Sick (auto-approved): either the
    // resolved target has a manager in Entra, OR the employee has manually
    // enabled "Route approval to someone else" and selected a valid
    // approver (the override block below enforces that a valid approver is
    // selected + a reason is given). There is no automatic substitute for a
    // missing manager — see #approverGuidance in request.html for the
    // guidance shown to the employee in this exact situation.
    if (type !== "Sick" && !state.target.manager && !state.approverOverride.active) {
      return "You don't have a manager on file. " + NO_MANAGER_GUIDANCE_MESSAGE;
    }

    // Alternate approver (HR/Admin only): a valid approver + reason required
    // whenever the toggle is on.
    if (state.approverOverride.active) {
      if (!state.approverOverride.lookupOk || !state.approverOverride.approver) {
        return "Select the alternate approver from the suggestions first.";
      }
      if (!els.approverReason.value.trim()) {
        return "Enter a reason for routing approval to an alternate approver.";
      }
    }

    return null; // ok
  }

  function refreshSubmitEnabled() {
    // Submit is enabled when signed in and not already submitted; detailed
    // validation runs on click so the user sees a specific reason.
    els.submit.disabled = state.submitted || !PTOAuth.getAccount() || !state.requestType;
  }

  function defaultApproverLabel() {
    var m = state.target.manager;
    if (m) return (m.displayName || emailOf(m)) + (emailOf(m) ? "\n" + emailOf(m) : "");
    if (state.target.requester) return "No manager on file — select an approver above.";
    return "No default manager found";
  }

  function selectedApproverLabel() {
    if (state.approverOverride.active && state.approverOverride.lookupOk && state.approverOverride.approver) {
      var a = state.approverOverride.approver;
      return (a.displayName || emailOf(a)) + (emailOf(a) ? "\n" + emailOf(a) : "");
    }
    return defaultApproverLabel();
  }

  function reviewPerson(u, fallback) {
    if (!u) return fallback || "—";
    return (u.displayName || emailOf(u) || fallback || "—") + (emailOf(u) ? "\n" + emailOf(u) : "");
  }

  function addReviewItem(label, value) {
    if (!els.reviewList) return;
    var wrap = document.createElement("div");
    var dt = document.createElement("dt");
    var dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = value || "—";
    wrap.appendChild(dt);
    wrap.appendChild(dd);
    els.reviewList.appendChild(wrap);
  }

  function renderReview() {
    if (!els.reviewList) return;
    els.reviewList.innerHTML = "";
    var requester = state.target.requester;
    var backup = state.backups.length
      ? state.backups.map(backupLabel).join("\n")
      : "Required";
    var reason = els.reason && els.reason.value.trim();
    if (state.requestType === "other") {
      addReviewItem("Submitted by", reviewPerson(state.me));
      addReviewItem("Employee receiving PTO", reviewPerson(requester, "Select an employee"));
      addReviewItem("Default manager", defaultApproverLabel());
      addReviewItem("Selected approver", selectedApproverLabel());
      addReviewItem("PTO type", els.ptoType ? els.ptoType.value : "");
      addReviewItem("Dates", PTOUI.formatRange(els.startDate.value, els.endDate.value));
      addReviewItem("Backup contacts", backup);
      addReviewItem("Backup contacts notified", els.backupNotified && els.backupNotified.checked ? "Yes" : "No");
      addReviewItem("Confirmation copy", els.copySubmitter && els.copySubmitter.checked ? "Yes" : "No");
      if (reason) addReviewItem("Reason / Notes", reason);
    } else {
      addReviewItem("Requester", reviewPerson(requester));
      addReviewItem("PTO type", els.ptoType ? els.ptoType.value : "");
      addReviewItem("Start date", PTOUI.formatDateOnly(els.startDate.value));
      addReviewItem("End date", PTOUI.formatDateOnly(els.endDate.value));
      addReviewItem("Manager", defaultApproverLabel());
      addReviewItem("Backup contacts", backup);
      addReviewItem("Backup contacts notified", els.backupNotified && els.backupNotified.checked ? "Yes" : "No");
      addReviewItem("Confirmation copy", els.copySubmitter && els.copySubmitter.checked ? "Yes" : "No");
      if (reason) addReviewItem("Reason / Notes", reason);
    }
  }

  // ---- submit ----
  function gatherInput() {
    return {
      ptoType: els.ptoType.value,
      startDate: els.startDate.value,
      endDate: els.endDate.value,
      reason: els.reason.value,
      BackupContacts: state.backups.slice(),
      BackupNotified: !!(els.backupNotified && els.backupNotified.checked),
      BackupNotifiedAppliesToAll: true,
      BackupNotifiedByEmail: emailOf(state.me),
      CopySubmitterOnConfirmation: !!(els.copySubmitter && els.copySubmitter.checked),
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
    var submitLabel = els.submitText ? els.submitText.textContent : "Submit PTO Request";
    setSubmitText("Submitting...");
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
      setSubmitText("Submitted");
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
      setSubmitText(submitLabel);
    }
  }

  // ---- wiring ----
  els.ptoType.addEventListener("change", function () { recomputeRuleUI(); renderReview(); });
  els.startDate.addEventListener("change", function () { repairDateRange(); recomputeRuleUI(); renderReview(); });
  els.endDate.addEventListener("change", function () { repairDateRange(); recomputeRuleUI(); renderReview(); });
  els.reason.addEventListener("input", function () {
    updateCharCount(els.reason, els.reasonCount);
    renderReview();
  });
  if (els.oboReason) {
    els.oboReason.addEventListener("input", function () {
      updateCharCount(els.oboReason, els.oboReasonCount);
      renderReview();
    });
  }
  if (els.backupNotified) {
    els.backupNotified.addEventListener("change", function () {
      renderReview();
      refreshSubmitEnabled();
    });
  }
  if (els.copySubmitter) els.copySubmitter.addEventListener("change", renderReview);
  if (els.requestTypeSelf) els.requestTypeSelf.addEventListener("click", function () { chooseRequestType("self"); });
  if (els.requestTypeOther) els.requestTypeOther.addEventListener("click", function () { chooseRequestType("other"); });
  if (els.requestTypeChange) els.requestTypeChange.addEventListener("click", changeRequestType);
  initPeoplePickers();

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
      updateCharCount(els.oboReason, els.oboReasonCount);
      setSelfTarget();
    }
  }
  if (els.forWhoMyself) els.forWhoMyself.addEventListener("change", onForWhoChange);
  if (els.forWhoOther) els.forWhoOther.addEventListener("change", onForWhoChange);
  // Alternate approver: inline editor plus reactive people picker.
  if (els.approverEdit) els.approverEdit.addEventListener("click", showApproverEditor);
  if (els.approverRestore) els.approverRestore.addEventListener("click", restoreDefaultApprover);
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
        clearApproverResults();
      }
      updateApproverBadge();
      renderReview();
    });
  }
  if (els.approverEmail) {
    els.approverEmail.addEventListener("input", function () {
      state.approverOverride.lookupOk = false;
      state.approverOverride.approver = null;
      updateApproverBadge();
      renderReview();
    });
  }
  if (els.approverReason) els.approverReason.addEventListener("input", renderReview);
  updateCharCount(els.reason, els.reasonCount);
  updateCharCount(els.oboReason, els.oboReasonCount);
  repairDateRange();

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
