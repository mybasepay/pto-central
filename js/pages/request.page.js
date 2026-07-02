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
 * On-behalf (HR/Admin delegated submit) added later: an HR/Admin user can look up
 * another employee and file PTO FOR them. RequesterEmail/ManagerEmail then describe
 * the EMPLOYEE; SubmittedBy* records the HR/Admin who filled the form; RequestMode =
 * "On behalf of". Self-service behavior is unchanged when the toggle is off.
 * Pages call domain modules, never Graph directly (§7).
 */

(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  function emailOf(u) { return (u && (u.mail || u.userPrincipalName)) || ""; }

  var state = {
    me: null,            // always the signed-in user (the submitter)
    isHrAdmin: false,    // may use the on-behalf option
    onBehalf: false,     // is the on-behalf toggle active
    lookupOk: false,     // has a valid requester been resolved for the current mode
    // The signed-in user's own chain (the default "self" target).
    self: { requester: null, manager: null, managersManager: null, managersManagerError: null },
    // The active target the request is FOR (self or a looked-up employee).
    target: { requester: null, manager: null, managersManager: null },
    submitted: false,
    authorized: false,
  };

  // ---- DOM ready (script is at end of body, so elements exist) ----
  var els = {
    signin: $("signin"), signout: $("signout"), account: $("account"),
    ptoType: $("ptoType"), startDate: $("startDate"), endDate: $("endDate"),
    partialDay: $("partialDay"), hours: $("hours"), reason: $("reason"),
    backupName: $("backupName"), backupEmail: $("backupEmail"), confirm: $("confirm"),
    submit: $("submit"), submitStatus: $("submit-status"), error: $("error"),
    detailsTitle: $("details-title"),
    // On-behalf (HR/Admin) controls.
    oboSection: $("obo-section"), oboToggle: $("oboToggle"), oboFields: $("oboFields"),
    oboEmail: $("oboEmail"), oboLookup: $("oboLookup"), oboReason: $("oboReason"),
    oboStatus: $("oboStatus"), oboError: $("oboError"),
    oboBadge: $("oboBadge"), oboBadgeText: $("oboBadgeText"),
    // Dev-only approval link (Phase 3B) — display/copy only, no send.
    devApproval: $("dev-approval"), approvalLink: $("approval-link"),
    approvalLinkRel: $("approval-link-rel"), copyApproval: $("copy-approval"),
    copyApprovalStatus: $("copy-approval-status"), devApprovalError: $("dev-approval-error"),
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
    els.signin.disabled = signedIn;
    els.signout.disabled = !signedIn;
    els.account.textContent = signedIn
      ? "Signed in as " + (acct.username || acct.name || acct.homeAccountId)
      : "Not signed in.";
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

    // HR/Admin gate for the on-behalf option (fails closed on any lookup error).
    state.isHrAdmin = await PTOAuthz.hasRole(az.email, ["HR", "Admin"]);
    if (els.oboSection) els.oboSection.style.display = state.isHrAdmin ? "block" : "none";

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

  // ---- employee lookup (on-behalf) ----
  async function onLookup() {
    clearOboMessages();
    var email = (els.oboEmail.value || "").trim();
    if (!email) { showOboError('Enter the employee’s email, then click "Lookup employee".'); return; }
    if (email.toLowerCase() === emailOf(state.me).toLowerCase()) {
      showOboError('That’s your own account. Turn off "Request PTO for someone else" to submit your own PTO.');
      return;
    }

    els.oboLookup.disabled = true;
    state.lookupOk = false;
    setOboStatus("Looking up " + email + "…");
    try {
      var employee = await PTODirectory.getUserByEmail(email);
      if (!employee) {
        updateOboBadge();
        setOboStatus("");
        showOboError('No employee found for "' + email + '". Check the email and try again.');
        return;
      }

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
      setOboStatus("✓ Loaded " + (employee.displayName || email) + ".");
    } catch (e) {
      state.lookupOk = false;
      updateOboBadge();
      setOboStatus("");
      showOboError("Lookup failed: " + friendly(e));
    } finally {
      els.oboLookup.disabled = false;
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
      return 'Look up the employee first — enter their email and click "Lookup employee".';
    }

    var type = els.ptoType.value;
    if (!type) return "Choose a PTO type.";
    if (!els.startDate.value) return "Choose a start date.";
    if (!els.endDate.value) return "Choose an end date.";
    if (els.endDate.value < els.startDate.value) return "End date must be on or after the start date.";

    if (els.partialDay.checked) {
      var h = parseFloat(els.hours.value);
      if (!(h > 0)) return "Enter the number of hours for a partial-day request.";
    }

    // Manager required unless Sick (Sick is auto-approved). Applies to the
    // resolved target — the employee for on-behalf, the signed-in user otherwise.
    if (type !== "Sick" && !state.target.manager) {
      return state.onBehalf
        ? "This employee has no manager in Entra ID, so the request can't be routed for approval. " +
          "Submit Sick (auto-approved) or contact HR (pto-approvals@mybasepay.com)."
        : "No manager found in Entra ID, so this request can't be routed for approval. " +
          "Contact HR (pto-approvals@mybasepay.com), or submit Sick leave which is auto-approved.";
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
      backupContactName: els.backupName.value,
      backupContactEmail: els.backupEmail.value,
      isPartialDay: els.partialDay.checked,
      hours: els.hours.value,
      onBehalfReason: state.onBehalf ? els.oboReason.value : "",
    };
  }

  function renderResult(fields, created) {
    PTOUI.setText("r-key", fields.Title);
    PTOUI.setText("r-id", created && created.id);
    var statusDd = $("r-status");
    statusDd.textContent = "";
    statusDd.appendChild(PTOUI.statusBadge(fields.Status));
    PTOUI.setText("r-short", fields.IsShortNotice ? "Yes — flagged for HR review" : "No");
    var linkDd = $("r-link");
    linkDd.textContent = "";
    if (created && created.webUrl) {
      linkDd.appendChild(
        PTOUI.el("a", { href: created.webUrl, target: "_blank", rel: "noopener noreferrer" }, created.webUrl)
      );
    } else {
      linkDd.textContent = "—";
    }
    // Reveal the result panel. PTOUI.show now sets an explicit display:block, so
    // it correctly overrides the stylesheet's `.result { display: none }` (this
    // was the Phase 3B visibility bug; helper fixed in Phase 3B-Cleanup).
    PTOUI.show("result", true);

    // The dev block is a sibling of #result and is rendered independently so a
    // hidden result panel can never gate it.
    renderApprovalLinkDev(created);
  }

  /**
   * Pull the SharePoint list item id out of whatever shape the create call
   * returns. Graph's POST returns the id at the top level (`created.id`), but we
   * check the other plausible paths too so a wrapper change can't silently break
   * the link. Returns "" if none is found.
   */
  function extractItemId(created) {
    if (!created) return "";
    var candidates = [
      created.id,
      created.itemId,
      created.sharePointItemId,
      created.raw && created.raw.id,
      created.raw && created.raw.fields && created.raw.fields.id,
      created.createdItem && created.createdItem.id,
      created.fields && created.fields.id,
    ];
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      if (c !== undefined && c !== null && String(c).trim() !== "") return String(c).trim();
    }
    return "";
  }

  /** Show a VISIBLE diagnostic inside the dev block (never fail silently). */
  function showDevApprovalError(reason) {
    console.error("[request.page] DEV approval link block failed:", reason);
    if (els.devApprovalError) {
      els.devApprovalError.textContent = "DEV approval link block failed: " + reason;
      els.devApprovalError.style.display = "block";
    }
  }

  /**
   * DEV-ONLY (Phase 3B): show the manager approval link for the created item so
   * it can be tested manually. Generation only — nothing is sent (no Teams,
   * no email, no signed link).
   *
   * Visibility rules (acceptance criteria):
   *   - The block is ALWAYS revealed after a successful submit.
   *   - On a missing item id it shows "No created item ID returned. See console."
   *   - On any other failure it shows "DEV approval link block failed: <reason>".
   *   - It NEVER fails silently.
   */
  function renderApprovalLinkDev(created) {
    if (!els.devApproval) {
      // No block in the DOM — surface it where we can (status + console).
      setSubmitStatus("✓ Submitted. (DEV approval link block missing from request.html.)");
      console.error("[request.page] #dev-approval not found in the DOM — check request.html.");
      return;
    }

    // Reveal with an EXPLICIT display value (inline "block" overrides any sheet rule).
    els.devApproval.style.display = "block";
    if (els.copyApprovalStatus) els.copyApprovalStatus.textContent = "";
    if (els.devApprovalError) { els.devApprovalError.style.display = "none"; els.devApprovalError.textContent = ""; }

    try {
      var itemId = extractItemId(created);
      console.log("[request.page] created item:", created, "→ resolved itemId:", itemId || "(none)");

      if (!itemId) {
        els.approvalLink.removeAttribute("href");
        els.approvalLink.textContent = "—";
        els.approvalLinkRel.textContent = "—";
        showDevApprovalError("No created item ID returned. See console.");
        return;
      }

      if (typeof PTOLinks === "undefined" || !PTOLinks.absoluteApprovalUrl) {
        els.approvalLink.removeAttribute("href");
        els.approvalLink.textContent = "—";
        els.approvalLinkRel.textContent = "—";
        showDevApprovalError("PTOLinks not loaded — check the js/links.js script tag in request.html.");
        return;
      }

      var abs = PTOLinks.absoluteApprovalUrl(itemId);
      var rel = PTOLinks.relativeApprovalUrl(itemId);
      els.approvalLink.setAttribute("href", abs);
      els.approvalLink.textContent = abs;
      els.approvalLinkRel.textContent = rel;
    } catch (e) {
      showDevApprovalError((e && e.message) ? e.message : String(e));
    }
  }

  async function onCopyApproval() {
    var url = els.approvalLink ? els.approvalLink.getAttribute("href") : "";
    if (!url || url === "#") return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        // Fallback for non-secure contexts / older browsers.
        var ta = document.createElement("textarea");
        ta.value = url;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      els.copyApprovalStatus.textContent = "✓ Copied.";
    } catch (e) {
      els.copyApprovalStatus.textContent = "Copy failed — select the link and copy manually.";
    }
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
      };
      var fields = PTORequests.buildCreateRequestFields(input, context);
      var created = await PTORequests.createRequest(fields);

      state.submitted = true; // prevent duplicate submits
      renderResult(fields, created);
      setSubmitStatus(
        state.onBehalf
          ? "✓ Submitted on behalf of " + (state.target.requester.displayName || emailOf(state.target.requester)) +
            ". Submit is disabled to avoid duplicates."
          : "✓ Submitted. Submit is disabled to avoid duplicates."
      );
      els.submit.textContent = "Submitted";
    } catch (e) {
      setSubmitStatus("");
      showError("Could not submit the request: " + friendly(e));
      els.submit.disabled = false; // allow retry on failure
    }
  }

  // ---- wiring ----
  els.partialDay.addEventListener("change", function () {
    els.hours.disabled = !els.partialDay.checked;
    if (!els.partialDay.checked) els.hours.value = "";
  });
  els.ptoType.addEventListener("change", recomputeRuleUI);
  els.startDate.addEventListener("change", recomputeRuleUI);
  els.endDate.addEventListener("change", recomputeRuleUI);
  els.confirm.addEventListener("change", refreshSubmitEnabled);

  // On-behalf (HR/Admin): toggle reveals the lookup; switching off restores self.
  if (els.oboToggle) {
    els.oboToggle.addEventListener("change", function () {
      var on = els.oboToggle.checked;
      if (els.oboFields) els.oboFields.classList.toggle("show", on);
      clearOboMessages();
      if (on) {
        enterOnBehalfMode();
      } else {
        els.oboEmail.value = "";
        els.oboReason.value = "";
        setSelfTarget();
      }
    });
  }
  if (els.oboLookup) els.oboLookup.addEventListener("click", onLookup);
  if (els.oboEmail) {
    els.oboEmail.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); onLookup(); }
    });
  }

  els.signin.addEventListener("click", async function () {
    clearError();
    els.signin.disabled = true;
    try {
      await PTOAuth.signIn();
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
  if (els.copyApproval) els.copyApproval.addEventListener("click", onCopyApproval);

  // ---- boot ----
  (async function boot() {
    try {
      await PTOAuth.initialize();
      renderAuth();
      if (PTOAuth.getAccount()) {
        await loadContext(); // restore context for an already-signed-in session
      }
    } catch (e) {
      showError("Initialization failed: " + friendly(e));
    }
  })();
})();
