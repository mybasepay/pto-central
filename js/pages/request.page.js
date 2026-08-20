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
    approverOverride: { active: false, lookupOk: false, approver: null, reason: "" },
    approverDraft: { approver: null, reason: "" },
    // Optional backup contacts, selected via employee lookup/autocomplete.
    // Shape: [{ name, email }].
    backups: [],
    submitted: false,
    authorized: false,
    selectionCommitted: true,
  };

  var PREVIEW_DIRECTORY = [
    {
      id: "preview-user",
      displayName: "Jane Doe",
      mail: "jane.doe@mybasepay.com",
      userPrincipalName: "jane.doe@mybasepay.com",
      department: "Human Resources",
      jobTitle: "HR Manager",
      accountEnabled: true,
      userType: "Member",
    },
    {
      id: "preview-alex",
      displayName: "Alex Rivera",
      mail: "alex.rivera@mybasepay.com",
      userPrincipalName: "alex.rivera@mybasepay.com",
      department: "Finance",
      jobTitle: "Payroll Specialist",
      accountEnabled: true,
      userType: "Member",
    },
    {
      id: "preview-jordan",
      displayName: "Jordan Lee",
      mail: "jordan.lee@mybasepay.com",
      userPrincipalName: "jordan.lee@mybasepay.com",
      department: "Customer Success",
      jobTitle: "Support Specialist",
      accountEnabled: true,
      userType: "Member",
    },
    {
      id: "preview-priya",
      displayName: "Priya Shah",
      mail: "priya.shah@mybasepay.com",
      userPrincipalName: "priya.shah@mybasepay.com",
      department: "Product",
      jobTitle: "Product Designer",
      accountEnabled: true,
      userType: "Member",
    },
    {
      id: "preview-maggie",
      displayName: "Maggie Mondragon",
      mail: "maggie.mondragon@mybasepay.com",
      userPrincipalName: "maggie.mondragon@mybasepay.com",
      department: "People Operations",
      jobTitle: "Senior HR Business Partner",
      accountEnabled: true,
      userType: "Member",
    },
    {
      id: "preview-manager",
      displayName: "Michael Reed",
      mail: "michael.reed@mybasepay.com",
      userPrincipalName: "michael.reed@mybasepay.com",
      department: "Human Resources",
      jobTitle: "Director, People Operations",
      accountEnabled: true,
      userType: "Member",
    },
    {
      id: "preview-escalation",
      displayName: "Alicia Carter",
      mail: "alicia.carter@mybasepay.com",
      userPrincipalName: "alicia.carter@mybasepay.com",
      department: "Executive",
      jobTitle: "VP, People",
      accountEnabled: true,
      userType: "Member",
    }
  ];

  var PREVIEW_MANAGER_CHAINS = {
    "preview-user": { managerId: "preview-manager", managersManagerId: "preview-escalation" },
    "preview-alex": { managerId: "preview-manager", managersManagerId: "preview-escalation" },
    "preview-jordan": { managerId: "preview-maggie", managersManagerId: "preview-escalation" },
    "preview-priya": { managerId: null, managersManagerId: null },
    "preview-maggie": { managerId: "preview-escalation", managersManagerId: null },
    "preview-manager": { managerId: "preview-escalation", managersManagerId: null },
    "preview-escalation": { managerId: null, managersManagerId: null },
  };

  // ---- DOM ready (script is at end of body, so elements exist) ----
  var els = {
    signin: $("signin"), signout: $("signout"), account: $("account"),
    userChip: $("user-chip"), userChipName: $("user-chip-name"),
    ptoType: $("ptoType"), startDate: $("startDate"), endDate: $("endDate"),
    reason: $("reason"), confirm: $("confirm"), requestCopy: $("requestCopy"),
    // Backup contacts = employee autocomplete (fills BackupContactName/Email on submit).
    backupSearch: $("backupSearch"), backupLookup: $("backupLookup"),
    backupResults: $("backupResults"), backupSelected: $("backupSelected"),
    backupError: $("backupError"),
    submit: $("submit"), submitStatus: $("submit-status"), error: $("error"),
    submitLabel: $("submitLabel"),
    detailsTitle: $("details-title-text"),
    requestEntryShell: $("requestEntryShell"),
    pageTitle: $("request-page-title"),
    pageSubtitle: $("request-page-subtitle"), dateRangeError: $("dateRangeError"),
    choicePanel: $("entryChoicePanel"),
    choiceMyselfCard: $("choiceMyselfCard"),
    choiceOtherCard: $("choiceOtherCard"),
    selectionSummary: $("requestSelectionSummary"),
    selectionSummaryIcon: $("selectionSummaryIcon"),
    selectionSummaryLabel: $("selectionSummaryLabel"),
    selectionSummaryTitle: $("selectionSummaryTitle"),
    selectionSummaryNote: $("selectionSummaryNote"),
    changeSelection: $("changeSelection"),
    requestFlow: $("requestFlow"),
    requestWorkspace: $("requestWorkspace"),
    pilotBanner: $("pilotBanner"),
    requesterDetailsPanel: $("requester-details-panel"),
    tipLine: $("tipLine"),
    requestFooter: $("requestFooter"),
    reviewRequester: $("reviewRequester"),
    reviewManager: $("reviewManager"),
    reviewPtoType: $("reviewPtoType"),
    reviewStartDate: $("reviewStartDate"),
    reviewEndDate: $("reviewEndDate"),
    reviewBackupContact: $("reviewBackupContact"),
    // "Who is this request for?" (all employees) controls.
    oboSection: $("obo-section"), oboFields: $("oboFields"),
    forWhoMyself: $("forWhoMyself"), forWhoOther: $("forWhoOther"),
    viewAsMyself: $("viewAsMyself"), viewAsOther: $("viewAsOther"),
    oboSearch: $("oboSearch"), oboResults: $("oboResults"),
    oboLookup: $("oboLookup"), oboReason: $("oboReason"),
    oboReasonWrap: $("oboReasonWrap"),
    oboStatus: $("oboStatus"), oboError: $("oboError"),
    oboBadge: $("oboBadge"), oboBadgeText: $("oboBadgeText"), sidebarApproverOpen: $("sidebarApproverOpen"),
    // Alternate approver controls.
    approverSection: $("approver-section"), approverModal: $("approverModal"),
    approverOpen: $("approverOpen"), approverClear: $("approverClear"),
    approverSummaryText: $("approverSummaryText"),
    approverCompact: $("approverCompact"), approverCompactText: $("approverCompactText"),
    approverCompactReason: $("approverCompactReason"), approverSearch: $("approverSearch"),
    approverResults: $("approverResults"), approverReason: $("approverReason"),
    approverConfirm: $("approverConfirm"), approverCancel: $("approverCancel"),
    approverSelectionClear: $("approverSelectionClear"),
    approverStatus: $("approverStatus"), approverError: $("approverError"),
    approverBadge: $("approverBadge"), approverBadgeText: $("approverBadgeText"),
  };

  var yearEl = $("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();
  var MAX_BACKUP_CONTACTS = 3;
  var oboSearchTimer = 0;
  var oboSearchRequestId = 0;
  var backupSearchTimer = 0;
  var backupSearchRequestId = 0;
  var approverSearchTimer = 0;
  var approverSearchRequestId = 0;
  var approverModalInstance = null;

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
  function fmtUserName(u) {
    if (!u) return "—";
    return u.displayName || emailOf(u) || "—";
  }

  function fmtReviewDate(value) {
    if (!value) return "—";
    var d = new Date(value + "T00:00:00");
    if (isNaN(d.getTime())) return value;
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  }

  function clonePreviewUser(user) {
    return user ? Object.assign({}, user) : null;
  }

  function previewUserById(userId) {
    for (var i = 0; i < PREVIEW_DIRECTORY.length; i += 1) {
      if (PREVIEW_DIRECTORY[i].id === userId) return clonePreviewUser(PREVIEW_DIRECTORY[i]);
    }
    return null;
  }

  function previewSearchUsers(query) {
    var raw = String(query === null || query === undefined ? "" : query).trim().toLowerCase();
    if (raw.length < 2) throw new Error("Type at least 2 characters to search.");

    var meId = state.me && state.me.id;
    return PREVIEW_DIRECTORY.filter(function (user) {
      var haystack = [
        user.displayName || "",
        emailOf(user),
        user.department || "",
        user.jobTitle || ""
      ].join(" ").toLowerCase();
      return user.id !== meId && haystack.indexOf(raw) !== -1;
    }).slice(0, 8).map(clonePreviewUser);
  }

  function previewManagerChainForUser(userId) {
    var chain = PREVIEW_MANAGER_CHAINS[userId] || { managerId: null, managersManagerId: null };
    return {
      manager: previewUserById(chain.managerId),
      managersManager: previewUserById(chain.managersManagerId),
    };
  }

  function directorySearchUsers(query) {
    if (isPreviewMode()) return Promise.resolve(previewSearchUsers(query));
    return PTODirectory.searchUsers(query);
  }

  function directoryGetManagerChainForUser(userId) {
    if (isPreviewMode()) return Promise.resolve(previewManagerChainForUser(userId));
    return PTODirectory.getManagerChainForUser(userId);
  }

  function setPreviewSearchHints() {
    if (!isPreviewMode()) return;
    if (els.oboSearch && !els.oboSearch.value) {
      els.oboSearch.placeholder = "Try Alex Rivera, Jordan Lee, Priya Shah, or Maggie Mondragon";
    }
    if (els.backupSearch && !els.backupSearch.value) {
      els.backupSearch.placeholder = "Try Michael Reed, Maggie Mondragon, or Alicia Carter";
    }
    if (els.approverSearch && !els.approverSearch.value) {
      els.approverSearch.placeholder = "Try Maggie Mondragon, Michael Reed, or Alicia Carter";
    }
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

    // Default to the self target.
    setSelfTarget();
    updateFlowUI();
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
    PTOUI.setText("c-dept", r.department || "—");
    PTOUI.setText("c-title", r.jobTitle || "—");
    PTOUI.setText("c-mgr", t.manager ? fmtUserName(t.manager) : (r.id ? "(none found)" : "—"));
    PTOUI.setText("c-mm", t.managersManager ? fmtUserName(t.managersManager) : (r.id ? "(none / unavailable)" : "—"));

    // Manager-missing warning (same rule for self and on-behalf, every type).
    var w = $("mgr-warn");
    if (r.id && !t.manager) {
      w.textContent = (state.onBehalf
        ? "This employee has no manager in Entra ID. "
        : "No manager found in Entra ID for your account. ") +
        "To submit any request — including Sick — enable \"Route approval to someone else\" and " +
        "select an approver, or contact HR (pto-approvals@mybasepay.com).";
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
    syncApproverOverrideForCurrentTarget();
    updateReviewSummary();
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
    updateFlowUI();
  }

  // Toggle turned ON but no employee resolved yet — clear details and block
  // submit until a successful lookup.
  function enterOnBehalfMode() {
    state.onBehalf = true;
    state.lookupOk = false;
    state.target = { requester: null, manager: null, managersManager: null };
    if (els.detailsTitle) els.detailsTitle.textContent = "Employee details";
    renderTargetDetails();
    if (isPreviewMode()) {
      setPreviewSearchHints();
      setOboStatus("Preview demo: try Alex Rivera, Jordan Lee, Priya Shah, or Maggie Mondragon.");
    }
    refreshSubmitEnabled();
    updateFlowUI();
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

  function updateViewAsUI() {
    if (els.viewAsMyself) {
      els.viewAsMyself.classList.toggle("is-active", !!(els.forWhoMyself && els.forWhoMyself.checked));
    }
    if (els.viewAsOther) {
      els.viewAsOther.classList.toggle("is-active", !!(els.forWhoOther && els.forWhoOther.checked));
    }
  }

  function setHidden(el, hidden) {
    if (!el) return;
    el.hidden = !!hidden;
  }

  function currentSelectionMode() {
    return els.forWhoOther && els.forWhoOther.checked ? "other" : "self";
  }

  function updateChoiceCards() {
    var myselfSelected = !!(state.selectionCommitted && els.forWhoMyself && els.forWhoMyself.checked);
    var otherSelected = !!(state.selectionCommitted && els.forWhoOther && els.forWhoOther.checked);
    if (els.choiceMyselfCard) els.choiceMyselfCard.classList.toggle("is-selected", myselfSelected);
    if (els.choiceOtherCard) els.choiceOtherCard.classList.toggle("is-selected", otherSelected);
    updateViewAsUI();
  }

  function updateSelectionSummary() {
    var other = currentSelectionMode() === "other";
    if (els.changeSelection) {
      els.changeSelection.innerHTML = other
        ? '<i class="bi bi-arrow-left" aria-hidden="true"></i><span>Back to my request</span>'
        : '<i class="bi bi-arrow-left-right" aria-hidden="true"></i><span>Request on behalf of someone else</span>';
      els.changeSelection.setAttribute(
        "aria-label",
        other ? "Switch back to my PTO request" : "Switch this PTO request to another employee"
      );
    }
  }

  function updateSubmitButtonCopy() {
    if (!els.submitLabel || state.submitted) return;
    var mode = currentSelectionMode();
    els.submitLabel.textContent = mode === "other" ? "Submit PTO request" : "Submit my PTO request";
  }

  function updatePageHeading() {
    if (!els.pageTitle || !els.pageSubtitle) return;
    var mode = currentSelectionMode();
    var title = "Submit PTO Request";
    var subtitle = "Who is this PTO request for?";

    if (mode === "self") {
      title = "My PTO Request";
      subtitle = "Create a PTO request for your own time off.";
    } else if (mode === "other" && state.lookupOk && state.target.requester) {
      title = "Employee PTO Request";
      subtitle = "Create a PTO request on behalf of " + (state.target.requester.displayName || "the selected employee") + ".";
    } else if (mode === "other") {
      title = "PTO Request";
      subtitle = "Select the employee this request is for to continue.";
    }

    els.pageTitle.textContent = title;
    els.pageSubtitle.textContent = subtitle;
  }

  function updateReviewSummary() {
    if (!els.reviewRequester) return;
    var requester = state.target && state.target.requester ? state.target.requester : null;
    var manager = state.target && state.target.manager ? state.target.manager : null;
    PTOUI.setText("reviewRequester", requester ? (requester.displayName || emailOf(requester) || "—") : "—");
    PTOUI.setText("reviewManager", manager ? (manager.displayName || emailOf(manager) || "—") : "—");
    PTOUI.setText("reviewPtoType", els.ptoType && els.ptoType.value ? els.ptoType.value : "—");
    PTOUI.setText("reviewStartDate", fmtReviewDate(els.startDate && els.startDate.value));
    PTOUI.setText("reviewEndDate", fmtReviewDate(els.endDate && els.endDate.value));
    PTOUI.setText(
      "reviewBackupContact",
      backupSummaryText() || "None selected"
    );
  }

  function backupContacts() {
    return state.backups || [];
  }

  function backupSummaryText() {
    return backupContacts().map(function (contact) {
      return contact.name + (contact.email ? " (" + contact.email + ")" : "");
    }).join(", ");
  }

  function backupNameFieldValue() {
    return backupContacts().map(function (contact) { return contact.name; }).join("; ");
  }

  function backupEmailFieldValue() {
    return backupContacts().map(function (contact) { return contact.email; }).filter(Boolean).join("; ");
  }

  function updateFlowUI() {
    var mode = currentSelectionMode();
    var showFlow = !!state.me || isPreviewMode();
    var showEmployeeSelection = mode === "other";
    var showResolvedFlow = showFlow && (
      mode === "self" ||
      (mode === "other" && state.lookupOk && !!(state.target.requester && state.target.requester.id))
    );

    updateChoiceCards();
    updateSelectionSummary();
    updatePageHeading();
    updateSubmitButtonCopy();
    renderApproverSummary();
    updateReviewSummary();
    if (els.requestEntryShell) {
      els.requestEntryShell.classList.toggle("is-form-mode", showFlow);
      els.requestEntryShell.classList.toggle("mode-selection", !showFlow);
      els.requestEntryShell.classList.toggle("mode-self", mode === "self");
      els.requestEntryShell.classList.toggle("mode-other", mode === "other");
    }

    setHidden(els.choicePanel, true);
    setHidden(els.selectionSummary, true);
    setHidden(els.requestFlow, !showFlow);
    setHidden(els.oboSection, !showEmployeeSelection);
    setHidden(els.requestWorkspace, !showResolvedFlow);
    setHidden(els.pilotBanner, !showResolvedFlow);
    setHidden(els.approverSection, !showResolvedFlow);
    setHidden(els.requesterDetailsPanel, !showResolvedFlow);
    setHidden($("request-details-panel"), !showResolvedFlow);
    setHidden(els.tipLine, !showResolvedFlow);
    setHidden(els.requestFooter, !showResolvedFlow);
    if (els.oboReasonWrap) setHidden(els.oboReasonWrap, !(showEmployeeSelection && state.lookupOk));
    if (els.oboFields) els.oboFields.classList.toggle("show", showEmployeeSelection);
  }

  function commitSelection(mode) {
    if (!state.me && !isPreviewMode()) {
      showError("Please sign in to continue.");
      if (els.signin && !PTOAuth.getAccount()) els.signin.focus();
      return;
    }
    if (mode === "other") {
      if (els.forWhoOther) els.forWhoOther.checked = true;
    } else {
      if (els.forWhoMyself) els.forWhoMyself.checked = true;
    }
    onForWhoChange();
    updateFlowUI();
  }

  function resetSelection() {
    commitSelection(currentSelectionMode() === "other" ? "self" : "other");
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

  function approverSelectionProblem(user) {
    var problem = PTORules.userSelectionProblem(user);
    var approverEmail = emailOf(user).toLowerCase();
    var targetEmail = emailOf(state.target.requester || {}).toLowerCase();
    var submitterEmail = emailOf(state.me || {}).toLowerCase();

    if (!problem && approverEmail && targetEmail && approverEmail === targetEmail) {
      problem = "The alternate approver must be different from the employee taking the PTO.";
    }
    if (!problem && approverEmail && submitterEmail && approverEmail === submitterEmail) {
      problem = "You can't route approval to yourself.";
    }
    return problem;
  }

  function clearApproverResults() {
    if (!els.approverResults) return;
    els.approverResults.innerHTML = "";
    els.approverResults.classList.remove("show");
  }

  function setApproverResultsEmpty(message) {
    if (!els.approverResults) return;
    els.approverResults.innerHTML = "";
    var empty = document.createElement("div");
    empty.className = "backup-results__empty";
    empty.textContent = message;
    els.approverResults.appendChild(empty);
    els.approverResults.classList.add("show");
  }

  function loadApproverDraftFromState() {
    state.approverDraft.approver = state.approverOverride.active ? state.approverOverride.approver : null;
    state.approverDraft.reason = state.approverOverride.active ? (state.approverOverride.reason || "") : "";
    if (els.approverSearch) els.approverSearch.value = "";
    if (els.approverReason) els.approverReason.value = state.approverDraft.reason;
    clearApproverResults();
    clearApproverMessages();
    updateApproverBadge();
  }

  function renderApproverSummary() {
    var active = !!(state.approverOverride.active && state.approverOverride.lookupOk && state.approverOverride.approver);
    var approver = active ? state.approverOverride.approver : null;
    var managerMissing = !state.target.manager && els.ptoType && els.ptoType.value !== "Sick";

    if (els.approverOpen) {
      els.approverOpen.textContent = active ? "Change approver" : "Select alternate approver";
    }
    if (els.approverClear) els.approverClear.hidden = !active;
    if (els.approverCompact) els.approverCompact.hidden = !active;

    if (els.approverSummaryText) {
      if (active && approver) {
        els.approverSummaryText.textContent = "Approval will be routed to " + (approver.displayName || emailOf(approver) || "the selected approver") + ".";
      } else if (managerMissing) {
        els.approverSummaryText.textContent = "No manager is configured for this request, so selecting an alternate approver is required before you submit.";
      } else {
        els.approverSummaryText.textContent = "Keep the default manager routing, or choose an alternate approver if needed.";
      }
    }

    if (active && approver) {
      if (els.approverCompactText) {
        els.approverCompactText.textContent = (approver.displayName || emailOf(approver) || "Selected approver") +
          (emailOf(approver) ? " — " + emailOf(approver) : "");
      }
      if (els.approverCompactReason) {
        els.approverCompactReason.textContent = state.approverOverride.reason ? "Reason: " + state.approverOverride.reason : "";
      }
    } else {
      if (els.approverCompactText) els.approverCompactText.textContent = "None selected";
      if (els.approverCompactReason) els.approverCompactReason.textContent = "";
    }
  }

  function updateApproverBadge() {
    if (!els.approverBadge) return;
    var a = state.approverDraft && state.approverDraft.approver ? state.approverDraft.approver : null;
    if (a) {
      var who = a.displayName || emailOf(a) || "approver";
      var email = emailOf(a);
      els.approverBadgeText.textContent = who + (email ? " — " + email : "");
      els.approverBadge.hidden = false;
    } else {
      els.approverBadge.hidden = true;
    }
  }

  function syncApproverOverrideForCurrentTarget() {
    if (!state.approverOverride.active || !state.approverOverride.approver) {
      renderApproverSummary();
      return;
    }
    var problem = approverSelectionProblem(state.approverOverride.approver);
    if (problem) {
      clearAlternateApprover();
      return;
    }
    renderApproverSummary();
  }

  function ensureApproverModal() {
    if (!approverModalInstance && els.approverModal && window.bootstrap && window.bootstrap.Modal) {
      approverModalInstance = new window.bootstrap.Modal(els.approverModal, {
        backdrop: true,
        focus: true
      });
    }
    return approverModalInstance;
  }

  function openApproverModal() {
    loadApproverDraftFromState();
    var modal = ensureApproverModal();
    if (modal) modal.show();
  }

  function closeApproverModal() {
    var modal = ensureApproverModal();
    if (modal) modal.hide();
  }

  function clearAlternateApprover() {
    state.approverOverride.active = false;
    state.approverOverride.lookupOk = false;
    state.approverOverride.approver = null;
    state.approverOverride.reason = "";
    clearApproverMessages();
    renderApproverSummary();
  }

  function selectApproverDraft(approver) {
    clearApproverMessages();
    var problem = approverSelectionProblem(approver);
    if (problem) {
      showApproverError(problem);
      return;
    }
    state.approverDraft.approver = approver;
    updateApproverBadge();
    clearApproverResults();
    if (els.approverSearch) els.approverSearch.value = "";
    setApproverStatus("Selected " + (approver.displayName || emailOf(approver) || "alternate approver") + ".");
  }

  function clearApproverDraftSelection() {
    state.approverDraft.approver = null;
    updateApproverBadge();
    clearApproverMessages();
    if (els.approverSearch) els.approverSearch.focus();
  }

  function validateApproverDraft() {
    if (!state.approverDraft.approver) return "Select an alternate approver from the directory.";
    var problem = approverSelectionProblem(state.approverDraft.approver);
    if (problem) return problem;
    if (!els.approverReason || !els.approverReason.value.trim()) {
      return "Enter a reason for routing approval to an alternate approver.";
    }
    return null;
  }

  async function onApproverSearch() {
    clearApproverMessages();
    var q = (els.approverSearch && els.approverSearch.value || "").trim();
    var requestId = ++approverSearchRequestId;
    if (!q) { clearApproverResults(); return; }
    if (q.length < 2) {
      setApproverResultsEmpty("Type at least 2 characters to see alternate approver suggestions.");
      return;
    }
    try {
      var matches = await directorySearchUsers(q);
      if (requestId !== approverSearchRequestId) return;
      clearApproverResults();
      var selectedEmail = emailOf(state.approverDraft.approver || {}).toLowerCase();
      var eligible = (matches || []).filter(function (u) {
        var email = emailOf(u).toLowerCase();
        if (!email) return false;
        if (selectedEmail && email === selectedEmail) return false;
        return !approverSelectionProblem(u);
      });
      if (!eligible.length) {
        setApproverResultsEmpty("No eligible alternate approvers matched that search.");
        return;
      }
      eligible.forEach(function (u) {
        var email = emailOf(u);
        els.approverResults.appendChild(backupResultRow(
          u.displayName || email,
          email,
          function () { selectApproverDraft(u); }
        ));
      });
      els.approverResults.classList.add("show");
    } catch (e) {
      if (requestId !== approverSearchRequestId) return;
      clearApproverResults();
      showApproverError("Alternate approver suggestions are unavailable right now (" + friendly(e) + ").");
    }
  }

  function queueApproverSearch() {
    window.clearTimeout(approverSearchTimer);
    approverSearchTimer = window.setTimeout(onApproverSearch, 160);
  }

  function confirmAlternateApprover() {
    clearApproverMessages();
    var problem = validateApproverDraft();
    if (problem) {
      showApproverError(problem);
      return;
    }
    state.approverOverride.active = true;
    state.approverOverride.lookupOk = true;
    state.approverOverride.approver = state.approverDraft.approver;
    state.approverOverride.reason = (els.approverReason.value || "").trim();
    renderApproverSummary();
    closeApproverModal();
  }

  // ---- backup contact autocomplete (optional) ---------------------------------
  // Employee search by name or email (PTODirectory.searchUsers). Selecting one
  // or more matches fills the SAME SharePoint fields as before
  // (BackupContactName/BackupContactEmail via gatherInput), serialized as
  // semicolon-delimited values for compatibility with the live list schema.
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
    var contacts = backupContacts();
    els.backupSelected.innerHTML = "";
    if (contacts.length) {
      contacts.forEach(function (contact, index) {
        var chip = document.createElement("span");
        chip.className = "backup-chip";
        chip.setAttribute("role", "listitem");

        var text = document.createElement("span");
        text.className = "backup-chip__text";
        text.textContent = contact.name + (contact.email ? " — " + contact.email : "");
        chip.appendChild(text);

        var remove = document.createElement("button");
        remove.type = "button";
        remove.className = "backup-chip__remove";
        remove.setAttribute("aria-label", "Remove backup contact " + contact.name);
        remove.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>';
        remove.addEventListener("click", function () {
          removeBackup(index);
        });
        chip.appendChild(remove);

        els.backupSelected.appendChild(chip);
      });
      els.backupSelected.classList.add("show");
    } else {
      els.backupSelected.classList.remove("show");
    }
    updateReviewSummary();
  }

  function removeBackup(index) {
    var contacts = backupContacts().slice();
    if (index < 0 || index >= contacts.length) return;
    contacts.splice(index, 1);
    state.backups = contacts;
    renderBackupSelected();
    showBackupError("");
  }

  function selectBackup(contact) {
    var name = contact && contact.name ? contact.name : "";
    var email = contact && contact.email ? contact.email : "";
    var normalizedEmail = email.toLowerCase();
    var targetEmail = emailOf(state.target.requester || {}).toLowerCase();
    var contacts = backupContacts().slice();

    if (!name) {
      showBackupError("Select a valid backup contact from the directory.");
      return;
    }
    if (email && targetEmail && normalizedEmail === targetEmail) {
      showBackupError("Choose someone other than the employee taking PTO as the backup contact.");
      return;
    }
    if (email && contacts.some(function (item) { return item.email && item.email.toLowerCase() === normalizedEmail; })) {
      showBackupError(name + " is already selected as a backup contact.");
      return;
    }
    if (contacts.length >= MAX_BACKUP_CONTACTS) {
      showBackupError("You can select up to " + MAX_BACKUP_CONTACTS + " backup contacts.");
      return;
    }
    state.backups = contacts.concat([{ name: name, email: email }]);
    clearBackupResults();
    showBackupError("");
    if (els.backupSearch) els.backupSearch.value = "";
    renderBackupSelected();
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

  function setBackupResultsEmpty(message) {
    if (!els.backupResults) return;
    els.backupResults.innerHTML = "";
    var empty = document.createElement("div");
    empty.className = "backup-results__empty";
    empty.textContent = message;
    els.backupResults.appendChild(empty);
    els.backupResults.classList.add("show");
  }

  async function onBackupSearch() {
    showBackupError("");
    var q = (els.backupSearch.value || "").trim();
    var requestId = ++backupSearchRequestId;
    if (!q) { clearBackupResults(); return; }
    if (backupContacts().length >= MAX_BACKUP_CONTACTS) {
      clearBackupResults();
      showBackupError("You can select up to " + MAX_BACKUP_CONTACTS + " backup contacts.");
      return;
    }
    if (q.length < 2) {
      setBackupResultsEmpty("Type at least 2 characters to see backup contact suggestions.");
      return;
    }
    try {
      var matches = await directorySearchUsers(q);
      if (requestId !== backupSearchRequestId) return;
      clearBackupResults();
      els.backupResults.innerHTML = "";
      var selectedEmails = backupContacts().map(function (item) { return (item.email || "").toLowerCase(); });
      var targetEmail = emailOf(state.target.requester || {}).toLowerCase();
      var eligible = (matches || []).filter(function (u) {
        var email = emailOf(u);
        var problem = PTORules.userSelectionProblem(u);
        if (problem) return false;
        if (!email) return false;
        if (targetEmail && email.toLowerCase() === targetEmail) return false;
        return selectedEmails.indexOf(email.toLowerCase()) === -1;
      });
      eligible.forEach(function (u) {
        var email = emailOf(u);
        els.backupResults.appendChild(backupResultRow(
          u.displayName || email,
          email,
          function () { selectBackup({ name: u.displayName || email, email: email }); }
        ));
      });
      // Free-text fallback (name only, no email) — keeps a non-employee/external
      // backup contact possible and keeps an empty/failed search from being a
      // dead end. Directory matches above are still validated via
      // PTORules.userSelectionProblem; this path is intentionally unvalidated
      // since it's for people who aren't in the directory at all.
      els.backupResults.appendChild(backupResultRow(
        (eligible.length ? "Or use “" : "No employee match — use “") + q + "” as the name only",
        null,
        function () { selectBackup({ name: q, email: "" }); }
      ));
      els.backupResults.classList.add("show");
    } catch (e) {
      if (requestId !== backupSearchRequestId) return;
      clearBackupResults();
      showBackupError(
        "Backup contact suggestions are unavailable right now (" + friendly(e) + "). " +
        "You can submit without backup contacts, or try again in a moment."
      );
    }
  }

  function queueBackupSearch() {
    window.clearTimeout(backupSearchTimer);
    backupSearchTimer = window.setTimeout(onBackupSearch, 160);
  }

  function dateRangeProblem() {
    var start = els.startDate && els.startDate.value;
    var end = els.endDate && els.endDate.value;
    if (!start || !end) return "";
    if (start > end) return "Start Date cannot be after End Date.";
    return "";
  }

  function updateDateRangeUI() {
    var message = dateRangeProblem();
    if (els.endDate) {
      if (els.startDate && els.startDate.value) els.endDate.min = els.startDate.value;
      else els.endDate.removeAttribute("min");
      if (message) els.endDate.setAttribute("aria-invalid", "true");
      else els.endDate.removeAttribute("aria-invalid");
    }
    if (els.startDate) {
      els.startDate.removeAttribute("max");
      if (message) els.startDate.setAttribute("aria-invalid", "true");
      else els.startDate.removeAttribute("aria-invalid");
    }
    if (els.dateRangeError) {
      els.dateRangeError.textContent = message;
      els.dateRangeError.style.display = message ? "block" : "none";
    }
    return message;
  }

  function maybeOpenDatePicker(input) {
    if (!input || typeof input.showPicker !== "function") return;
    try { input.showPicker(); } catch (e) {}
  }

  function syncDateRangeFromStart() {
    updateDateRangeUI();
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

  function setOboResultsEmpty(message) {
    if (!els.oboResults) return;
    els.oboResults.innerHTML = "";
    var empty = document.createElement("div");
    empty.className = "backup-results__empty";
    empty.textContent = message;
    els.oboResults.appendChild(empty);
    els.oboResults.classList.add("show");
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
    var q = (els.oboSearch.value || "").trim();
    var requestId = ++oboSearchRequestId;
    if (!q) {
      clearOboResults();
      if (isPreviewMode()) {
        setOboStatus("Preview demo: try Alex Rivera, Jordan Lee, Priya Shah, or Maggie Mondragon.");
      } else {
        setOboStatus("");
      }
      return;
    }
    if (q.length < 2) {
      clearOboResults();
      setOboResultsEmpty("Type at least 2 characters to see employee suggestions.");
      return;
    }

    try {
      var matches = await directorySearchUsers(q);
      if (requestId !== oboSearchRequestId) return;
      clearOboResults();
      setOboStatus("");
      if (!matches || !matches.length) {
        setOboResultsEmpty('No employee found for "' + q + '".');
        return;
      }
      els.oboResults.innerHTML = "";
      matches.forEach(function (u) { els.oboResults.appendChild(oboResultRow(u)); });
      els.oboResults.classList.add("show");
    } catch (e) {
      if (requestId !== oboSearchRequestId) return;
      setOboStatus("");
      showOboError("Employee search failed: " + friendly(e));
    }
  }

  function queueOboSearch() {
    window.clearTimeout(oboSearchTimer);
    oboSearchTimer = window.setTimeout(onOboSearch, 160);
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
      var chain = await directoryGetManagerChainForUser(employee.id);

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
      updateFlowUI();
    } catch (e) {
      state.lookupOk = false;
      updateOboBadge();
      setOboStatus("");
      showOboError("Could not load the employee's details: " + friendly(e));
      updateFlowUI();
    } finally {
      refreshSubmitEnabled();
    }
  }

  // ---- business-rule hints ----
  function recomputeRuleUI() {
    var type = els.ptoType.value;
    var start = els.startDate.value;
    updateDateRangeUI();

    // Sick note + manager-requirement messaging. Sick is no longer
    // auto-approved (HR change 2026-08-19) — it follows the normal approval
    // workflow, so the note now says exactly that instead of the opposite.
    PTOUI.show("sickNote", type === "Sick");
    if (type === "Sick") $("sickNote").textContent = "Sick time goes to your approver for a decision, the same as any other request.";

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
    renderApproverSummary();
    updateReviewSummary();
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
    var dateProblem = updateDateRangeUI();
    if (dateProblem) return dateProblem;

    // An approval route is required for EVERY PTO type: either the resolved
    // target has a manager in Entra, OR the user enabled "Route approval to
    // someone else" (the override block below enforces that a valid approver
    // is selected + a reason is given). This unblocks requesters with no
    // manager configured (e.g. service-style accounts).
    //
    // Sick used to be exempt here because it auto-approved on submit and so
    // needed nobody to act on it. HR removed automatic approval on 2026-08-19,
    // which makes the exemption actively harmful: a Sick request with no
    // approval route would be created Pending with no one able to decide it,
    // and would sit Pending indefinitely. The exemption is therefore removed
    // together with the auto-approval it existed to serve.
    if (!state.target.manager && !state.approverOverride.active) {
      return state.onBehalf
        ? "This employee has no manager in Entra ID. Enable \"Route approval to someone else\" " +
          "and select an approver, or contact HR (pto-approvals@mybasepay.com)."
        : "No manager found in Entra ID for your account. Enable \"Route approval to someone else\" " +
          "and select an approver, or contact HR (pto-approvals@mybasepay.com).";
    }

    // Alternate approver (HR/Admin only): a valid approver + reason required
    // whenever the toggle is on.
    if (state.approverOverride.active) {
      if (!state.approverOverride.lookupOk || !state.approverOverride.approver) {
        return "Select and confirm an alternate approver before submitting.";
      }
      if (!state.approverOverride.reason.trim()) {
        return "Enter a reason for routing approval to an alternate approver.";
      }
    }

    if (!els.confirm.checked) {
      return 'Please confirm the request is accurate and that any selected backup contact has been notified.';
    }
    return null; // ok
  }

  function refreshSubmitEnabled() {
    // Submit is enabled when signed in and not already submitted; detailed
    // validation runs on click so the user sees a specific reason.
    els.submit.disabled = state.submitted || (!PTOAuth.getAccount() && !isPreviewMode());
  }

  // ---- submit ----
  function gatherInput() {
    return {
      ptoType: els.ptoType.value,
      startDate: els.startDate.value,
      endDate: els.endDate.value,
      reason: els.reason.value,
      // Backup contacts come from the employee autocomplete; the SharePoint
      // fields stay unchanged and receive semicolon-delimited values.
      backupContactName: backupNameFieldValue(),
      backupContactEmail: backupEmailFieldValue(),
      // Partial day was removed from the UI (2026-07-03). Safe defaults keep
      // buildCreateRequestFields' contract intact: IsPartialDay = false is
      // still written; Hours is omitted (only written for partial days).
      isPartialDay: false,
      hours: "",
      onBehalfReason: state.onBehalf && els.oboReason ? els.oboReason.value : "",
      notifyRequesterCopy: !!(els.requestCopy && els.requestCopy.checked),
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
          ? { approver: state.approverOverride.approver, reason: state.approverOverride.reason }
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
      if (els.submitLabel) {
        els.submitLabel.textContent = "Submitted";
      } else {
        els.submit.textContent = "Submitted";
      }
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
  els.startDate.addEventListener("change", function () {
    syncDateRangeFromStart();
    recomputeRuleUI();
  });
  els.endDate.addEventListener("change", recomputeRuleUI);
  els.confirm.addEventListener("change", refreshSubmitEnabled);

  if (els.startDate) {
    els.startDate.addEventListener("click", function () { maybeOpenDatePicker(els.startDate); });
  }
  if (els.endDate) {
    els.endDate.addEventListener("click", function () { maybeOpenDatePicker(els.endDate); });
  }

  // Backup contact autocomplete (optional).
  if (els.backupSearch) {
    els.backupSearch.addEventListener("input", queueBackupSearch);
    els.backupSearch.addEventListener("focus", function () {
      if ((els.backupSearch.value || "").trim().length >= 2) queueBackupSearch();
    });
    els.backupSearch.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        var first = els.backupResults ? els.backupResults.querySelector(".backup-result") : null;
        e.preventDefault();
        if (first) {
          first.click();
        } else {
          onBackupSearch();
        }
      }
    });
  }

  // On-behalf (HR/Admin): toggle reveals the lookup; switching off restores self.
  // "Who is this request for?" radios — Myself (default) / Another employee.
  function onForWhoChange() {
    var other = !!(els.forWhoOther && els.forWhoOther.checked);
    updateViewAsUI();
    clearOboMessages();
    clearOboResults();
    if (other) {
      enterOnBehalfMode();
    } else {
      if (els.oboSearch) els.oboSearch.value = "";
      if (els.oboReason) els.oboReason.value = "";
      setSelfTarget();
    }
    updateFlowUI();
  }
  if (els.forWhoMyself) els.forWhoMyself.addEventListener("change", onForWhoChange);
  if (els.forWhoOther) els.forWhoOther.addEventListener("change", onForWhoChange);
  if (els.choiceMyselfCard) {
    els.choiceMyselfCard.addEventListener("click", function () { commitSelection("self"); });
    els.choiceMyselfCard.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        commitSelection("self");
      }
    });
  }
  if (els.choiceOtherCard) {
    els.choiceOtherCard.addEventListener("click", function () { commitSelection("other"); });
    els.choiceOtherCard.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        commitSelection("other");
      }
    });
  }
  if (els.changeSelection) els.changeSelection.addEventListener("click", resetSelection);
  if (els.oboSearch) {
    els.oboSearch.addEventListener("input", queueOboSearch);
    els.oboSearch.addEventListener("focus", function () {
      if ((els.oboSearch.value || "").trim().length >= 2) queueOboSearch();
    });
    els.oboSearch.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        var first = els.oboResults ? els.oboResults.querySelector(".backup-result") : null;
        e.preventDefault();
        if (first) first.click();
        else onOboSearch();
      }
    });
  }

  if (els.sidebarApproverOpen) els.sidebarApproverOpen.addEventListener("click", openApproverModal);
  if (els.approverOpen) els.approverOpen.addEventListener("click", openApproverModal);
  if (els.approverClear) els.approverClear.addEventListener("click", clearAlternateApprover);
  if (els.approverConfirm) els.approverConfirm.addEventListener("click", confirmAlternateApprover);
  if (els.approverSelectionClear) els.approverSelectionClear.addEventListener("click", clearApproverDraftSelection);
  if (els.approverSearch) {
    els.approverSearch.addEventListener("input", queueApproverSearch);
    els.approverSearch.addEventListener("focus", function () {
      if ((els.approverSearch.value || "").trim().length >= 2) queueApproverSearch();
    });
    els.approverSearch.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        var first = els.approverResults ? els.approverResults.querySelector(".backup-result") : null;
        e.preventDefault();
        if (first) first.click();
        else onApproverSearch();
      }
    });
  }
  if (els.approverModal) {
    els.approverModal.addEventListener("shown.bs.modal", function () {
      if (els.approverSearch) els.approverSearch.focus();
    });
    els.approverModal.addEventListener("hidden.bs.modal", function () {
      clearApproverResults();
      clearApproverMessages();
      if (els.approverSearch) els.approverSearch.value = "";
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
    if (isPreviewMode() && !PTOAuth.getAccount()) {
      return;
    }
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

  // ?preview=1 only activates on localhost/loopback — see PTOUI.isLocalDevHost().
  function isPreviewMode() {
    try {
      return /(?:^|[?&])preview=1(?:&|$)/.test(window.location.search || "") && PTOUI.isLocalDevHost();
    } catch (e) {
      return false;
    }
  }

  function getPreviewEntryMode() {
    try {
      var mode = new URLSearchParams(window.location.search || "").get("mode");
      return mode === "other" ? "other" : mode === "self" ? "self" : "";
    } catch (e) {
      return "";
    }
  }

  function enterPreviewMode() {
    state.authorized = true;
    state.me = previewUserById("preview-user");
    state.self.requester = clonePreviewUser(state.me);
    state.self.manager = previewUserById("preview-manager");
    state.self.managersManager = previewUserById("preview-escalation");
    state.self.managersManagerError = null;

    if (els.userChip) els.userChip.classList.add("show");
    if (els.userChipName) els.userChipName.textContent = state.me.displayName;
    if (els.signin) {
      els.signin.disabled = true;
      els.signin.style.display = "none";
    }
    if (els.signout) els.signout.disabled = false;
    if (els.account) els.account.classList.remove("show-text");

    setPreviewSearchHints();
    setSelfTarget();
    recomputeRuleUI();
    refreshSubmitEnabled();
    if (getPreviewEntryMode() === "other") {
      commitSelection("other");
    } else {
      commitSelection("self");
    }
    updateFlowUI();
  }

  (async function boot() {
    try {
      updateViewAsUI();
      await PTOAuth.initialize(); // handles a returning redirect internally
      renderAuth();
      updateFlowUI();

      if (PTOAuth.getAccount()) {
        // Signed in (cached session or just back from the redirect).
        clearAutoLoginFlag();
        await loadContext();
        return;
      }

      if (isPreviewMode()) {
        enterPreviewMode();
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
