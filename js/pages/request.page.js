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
 * Phase 2B scope: create only. No Teams / calendar / email / on-behalf yet.
 * Pages call domain modules, never Graph directly (§7).
 */

(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  var state = {
    me: null,
    manager: null,
    managersManager: null,
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
    PTOUI.show("mgr-warn", false);
    PTOUI.show("mm-warn", false);

    state.me = await PTODirectory.getMe();
    var az = await PTOAuthz.enforce(state.me);
    state.authorized = az.authorized;
    if (!az.authorized) return;
    PTOUI.setText("c-name", state.me.displayName);
    PTOUI.setText("c-email", state.me.mail || state.me.userPrincipalName);
    PTOUI.setText("c-dept", (state.me.department || "—") + " / " + (state.me.jobTitle || "—"));

    // Direct manager (User.Read) — needed to route approval unless Sick.
    state.manager = await PTODirectory.getMyManager();
    PTOUI.setText("c-mgr", state.manager ? fmtUser(state.manager) : "(none found)");
    if (!state.manager) {
      var w = $("mgr-warn");
      w.textContent =
        "No manager found in Entra ID. Non-Sick requests cannot be routed for approval — " +
        "please contact HR (pto-approvals@mybasepay.com). Sick leave is auto-approved and can still be submitted.";
      w.style.display = "block";
    }

    // Manager's manager (User.Read.All) — escalation snapshot; non-blocking.
    state.managersManager = null;
    if (state.manager && state.manager.id) {
      try {
        state.managersManager = await PTODirectory.getUserManager(state.manager.id);
      } catch (e) {
        var mw = $("mm-warn");
        mw.textContent =
          "Manager's-manager lookup unavailable (" + friendly(e) + "). " +
          "Your request can still be submitted; the escalation contact will be blank.";
        mw.style.display = "block";
      }
    }
    PTOUI.setText("c-mm", state.managersManager ? fmtUser(state.managersManager) : "(none / unavailable)");

    recomputeRuleUI();
    refreshSubmitEnabled();
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
    var type = els.ptoType.value;
    if (!type) return "Choose a PTO type.";
    if (!els.startDate.value) return "Choose a start date.";
    if (!els.endDate.value) return "Choose an end date.";
    if (els.endDate.value < els.startDate.value) return "End date must be on or after the start date.";

    if (els.partialDay.checked) {
      var h = parseFloat(els.hours.value);
      if (!(h > 0)) return "Enter the number of hours for a partial-day request.";
    }

    // Manager required unless Sick (Sick is auto-approved).
    if (type !== "Sick" && !state.manager) {
      return "No manager found in Entra ID, so this request can't be routed for approval. " +
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
        requester: state.me,
        submitter: state.me, // Phase 2B: self-service only
        manager: state.manager,
        managersManager: state.managersManager,
        onBehalf: false,
      };
      var fields = PTORequests.buildCreateRequestFields(input, context);
      var created = await PTORequests.createRequest(fields);

      state.submitted = true; // prevent duplicate submits
      renderResult(fields, created);
      setSubmitStatus("✓ Submitted. Submit is disabled to avoid duplicates.");
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
