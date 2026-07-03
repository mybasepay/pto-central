/*
 * approve.page.js — Controller for approve.html (Manager Approval).
 *
 * Responsibility (per PTO_CENTRAL_ARCHITECTURE.md §8.4):
 *   - Read ?itemId= from the URL; require sign-in; load /me and the request.
 *   - Render request details.
 *   - Authorize: signed-in email/UPN must match the request's ManagerEmail
 *     (case-insensitive). Phase 3A uses sign-in + manager-email match only;
 *     stronger signed approval links are deferred to Phase 3B.
 *   - If not the manager → blocked (no decision buttons).
 *   - If Status != Pending → read-only ("already {Status}").
 *   - If authorized + pending → Approve / Reject (optional comment), which
 *     PATCHes the decision fields and APPENDS to AuditLog.
 *
 * Phase 3A scope: decision only. No Teams / calendar / email. Pages call
 * domain modules, never Graph directly (§7).
 */

(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  var els = {
    signin: $("signin"), signout: $("signout"), account: $("account"),
    userChip: $("user-chip"), userChipName: $("user-chip-name"), userChipAvatar: $("user-chip-avatar"),
    decisionUi: $("decision-ui"), comment: $("comment"), commentCount: $("comment-count"),
    approve: $("approve"), reject: $("reject"), decisionStatus: $("decision-status"),
    blockNote: $("block-note"), statusNote: $("status-note"),
    error: $("error"), auditlog: $("auditlog"), raw: $("raw"),
    approverNote: $("approver-note"),
  };

  var state = {
    itemId: null, me: null, item: null, fields: null, approverMeta: null,
    decided: false, authorized: false, isHrAdmin: false, canAct: false,
  };

  var yearEl = $("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // Read itemId from the URL, tolerating the several shapes a static dev server
  // (e.g. `npx serve`) may leave us with. In priority order:
  //   1. ?itemId=6                  — query string
  //   2. #itemId=6                  — bare hash
  //   3. #?itemId=6                 — query-style hash
  //   4. /approve/6 | /approve.html/6 — trailing path segment
  //   5. sessionStorage             — survives reloads / the MSAL round-trip
  // Whenever we resolve an id we persist it; any URL-borne id wins over the
  // stored copy and refreshes it.
  var ITEM_ID_KEY = "pto.approve.itemId";

  function pickItemId(search) {
    try { return new URLSearchParams(search).get("itemId"); } catch (e) { return null; }
  }

  function getItemIdFromUrl() {
    var loc = window.location;
    var id = null;

    // 1. Query string: ?itemId=6
    id = pickItemId(loc.search);

    // 2 & 3. Hash: #itemId=6 or #?itemId=6
    if (!id && loc.hash) {
      var h = loc.hash.replace(/^#/, "").replace(/^\?/, "");
      id = pickItemId(h);
    }

    // 4. Path segment: /approve/6 or /approve.html/6
    if (!id && loc.pathname) {
      var m = loc.pathname.match(/\/approve(?:\.html)?\/(\d+)\/?$/i);
      if (m) id = m[1];
    }

    // 5. sessionStorage fallback.
    if (!id) {
      try { id = sessionStorage.getItem(ITEM_ID_KEY); } catch (e) {}
    }

    if (id) {
      try { sessionStorage.setItem(ITEM_ID_KEY, id); } catch (e) {}
    }
    return id;
  }
  state.itemId = getItemIdFromUrl();

  var ITEM_ID_HELP = "No itemId in the URL. Open this page as one of:\n"
    + "  approve.html?itemId=123\n"
    + "  approve#itemId=123\n"
    + "  approve#?itemId=123";

  function friendly(e) {
    return (e && (e.message || e.errorMessage)) ? (e.message || e.errorMessage) : String(e);
  }
  function showError(msg) { els.error.textContent = msg; els.error.style.display = "block"; }
  function clearError() { els.error.style.display = "none"; els.error.textContent = ""; }
  function showNote(el, msg) {
    if (!msg) { el.style.display = "none"; el.textContent = ""; return; }
    el.textContent = msg; el.style.display = "block";
  }

  /** Two-letter initials for the user chip avatar (e.g. "Rodolfo Chacon" → "RC"). */
  function initialsOf(name) {
    var parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "··";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function renderAuth() {
    var acct = PTOAuth.getAccount();
    var signedIn = !!acct;
    // Signed in: show the user chip, hide the Sign in button entirely (same as
    // request.html / hr.html). Signed out: show Sign in + the live status text.
    els.signin.disabled = signedIn;
    els.signin.style.display = signedIn ? "none" : "";
    els.signout.disabled = !signedIn;
    if (els.userChip) {
      els.userChip.classList.toggle("show", signedIn);
      if (signedIn) {
        var display = acct.name || acct.username || acct.homeAccountId;
        if (els.userChipName) els.userChipName.textContent = display;
        if (els.userChipAvatar) els.userChipAvatar.textContent = initialsOf(acct.name || acct.username);
      }
    }
    els.account.classList.toggle("show-text", !signedIn);
    els.account.textContent = signedIn
      ? "Signed in as " + (acct.username || acct.name || acct.homeAccountId)
      : (els.account.textContent || "Not signed in.");
  }

  function myEmail() {
    var m = state.me || {};
    return String(m.mail || m.userPrincipalName || "").trim().toLowerCase();
  }

  /** Approver-aware note under the details dl: shows nothing for the default
   *  (no-override) case; a routing note when ApproverOverride is set; nothing
   *  for legacy requests with no approver columns at all. */
  function renderApproverNote(f, approverMeta) {
    if (!els.approverNote) return;
    var overrideTruthy = approverMeta.ApproverOverride === true ||
      approverMeta.ApproverOverride === "Yes" || approverMeta.ApproverOverride === "yes" ||
      approverMeta.ApproverOverride === 1;
    if (!overrideTruthy) { showNote(els.approverNote, null); return; }

    var approverName = approverMeta.ApproverName || "(unknown)";
    var managerName = approverMeta.OriginalManagerName || f.ManagerName || "(no manager on file)";
    showNote(els.approverNote,
      "Approval routed to " + approverName + " instead of manager " + managerName + "." +
      (approverMeta.ApproverOverrideReason ? " Reason: " + approverMeta.ApproverOverrideReason : "")
    );
  }

  function renderDetails(f, item, approverMeta) {
    approverMeta = approverMeta || {};
    PTOUI.setText("d-key", f.Title);
    PTOUI.setText("d-requester", f.RequesterName);
    PTOUI.setText("d-requester-email", f.RequesterEmail);
    PTOUI.setText("d-type", f.PtoType);
    PTOUI.setText("d-start", PTOUI.formatDateOnly(f.StartDate));
    PTOUI.setText("d-end", PTOUI.formatDateOnly(f.EndDate));
    PTOUI.setText("d-reason", f.Reason);
    var backup = (f.BackupContactName || "") + (f.BackupContactEmail ? " <" + f.BackupContactEmail + ">" : "");
    PTOUI.setText("d-backup", backup.trim() || "—");

    var statusDd = $("d-status");
    statusDd.textContent = "";
    statusDd.appendChild(PTOUI.statusBadge(f.Status));

    PTOUI.setText("d-submitted", f.SubmittedAt ? new Date(f.SubmittedAt).toLocaleString() : "—");
    var mgr = (f.ManagerName || "") + (f.ManagerEmail ? " <" + f.ManagerEmail + ">" : "");
    PTOUI.setText("d-manager", mgr.trim() || "—");

    // Approver: falls back to the manager when ApproverEmail is blank (legacy
    // requests / column not yet provisioned) — never shown as a separate
    // person unless it's actually different (docs/ALTERNATE_APPROVER_DESIGN.md).
    var approverEmail = approverMeta.ApproverEmail || f.ManagerEmail || "";
    var approverName = approverMeta.ApproverName || f.ManagerName || "";
    var apr = (approverName || "") + (approverEmail ? " <" + approverEmail + ">" : "");
    PTOUI.setText("d-approver", apr.trim() || "—");
    renderApproverNote(f, approverMeta);

    PTOUI.setText("d-short", f.IsShortNotice ? "Yes" : "No");
    PTOUI.setText("d-notice", (f.NoticeDays === undefined || f.NoticeDays === null) ? "—" : f.NoticeDays);

    var linkDd = $("d-link");
    linkDd.textContent = "";
    if (item && item.webUrl) {
      linkDd.appendChild(PTOUI.el("a", { href: item.webUrl, target: "_blank", rel: "noopener noreferrer" }, "Open"));
    } else {
      linkDd.textContent = "—";
    }

    els.auditlog.textContent = f.AuditLog || "—";
  }

  /** Decide what the decision panel shows based on auth + status. */
  function evaluateGate() {
    showNote(els.blockNote, null);
    showNote(els.statusNote, null);
    els.decisionUi.style.display = "none";

    var f = state.fields || {};
    var approverMeta = state.approverMeta || {};

    // Alternate-approver-aware authorization (docs/ALTERNATE_APPROVER_DESIGN.md):
    // ApproverEmail (if present) > ManagerEmail (legacy/no override) > HR/Admin.
    // Pure predicate lives in rules.js so it's independently unit-testable.
    state.canAct = PTORules.canDecide({
      managerEmail: f.ManagerEmail,
      approverEmail: approverMeta.ApproverEmail,
      myEmail: myEmail(),
      isHrAdmin: state.isHrAdmin,
    });

    if (!state.canAct) {
      var routedTo = approverMeta.ApproverEmail || f.ManagerEmail;
      showNote(els.blockNote,
        "You can't act on this request. You must be the assigned " +
        (approverMeta.ApproverEmail ? "approver" : "manager") + " (" +
        (routedTo || "none set") + ") or have HR/Admin rights.");
      return;
    }
    if (f.Status !== "Pending") {
      showNote(els.statusNote, "This request is already " + f.Status + ".");
      return;
    }
    // Authorized + pending → show decision controls.
    els.decisionUi.style.display = "";
  }

  async function loadRequest() {
    clearError();
    if (!state.itemId) {
      showError(ITEM_ID_HELP);
      return;
    }
    els.decisionStatus.textContent = "Loading…";
    try {
      state.me = await PTODirectory.getMe();
      var az = await PTOAuthz.enforce(state.me);
      state.authorized = az.authorized;
      if (!az.authorized) { els.decisionStatus.textContent = ""; return; }
      // HR/Admin may act on ANY request; otherwise only the assigned manager can
      // (decided per-request in evaluateGate). One list lookup, approve.html only.
      state.isHrAdmin = await PTOAuthz.hasRole(state.me.mail || state.me.userPrincipalName, ["HR", "Admin"]);
      var item = await PTORequests.getRequestById(state.itemId);
      state.item = item;
      state.fields = (item && item.fields) || {};

      // Resolve the approver columns' live internal names once (tolerates
      // manually-created columns / a not-yet-provisioned list — see
      // docs/ALTERNATE_APPROVER_DESIGN.md); never blocks loading the request.
      try { await PTORequests.resolveApproverFieldMap(); } catch (e) { /* tolerated */ }
      state.approverMeta = PTORequests.readApproverMetadata(state.fields);

      els.raw.textContent = JSON.stringify(item, null, 2);
      renderDetails(state.fields, item, state.approverMeta);
      evaluateGate();
      els.decisionStatus.textContent = "";
    } catch (e) {
      els.decisionStatus.textContent = "";
      showError("Could not load request #" + state.itemId + ": " + friendly(e));
    }
  }

  async function decide(status) {
    clearError();
    if (!state.canAct) { showError("Not authorized to act on this request."); return; }
    if (state.decided) return;
    els.approve.disabled = true;
    els.reject.disabled = true;
    els.decisionStatus.textContent = "Submitting decision…";
    try {
      var result = await PTORequests.updateRequestDecision(state.itemId, {
        status: status,
        actor: state.me,
        comment: els.comment.value,
        existingAuditLog: (state.fields && state.fields.AuditLog) || "",
      });

      state.decided = true;
      // Reflect the new values locally.
      state.fields = Object.assign({}, state.fields, result.fields);

      var statusDd = $("d-status");
      statusDd.textContent = "";
      statusDd.appendChild(PTOUI.statusBadge(state.fields.Status));
      els.auditlog.textContent = state.fields.AuditLog || "—";

      // Lock the panel and show the outcome.
      els.decisionUi.style.display = "none";
      showNote(els.statusNote, "Decision recorded: this request is now " + state.fields.Status + ".");
      els.decisionStatus.textContent = "✓ Saved.";
    } catch (e) {
      els.approve.disabled = false;
      els.reject.disabled = false;
      els.decisionStatus.textContent = "";
      showError("Could not save the decision: " + friendly(e));
    }
  }

  // ---- wiring ----
  // Live comment counter (UI only; the comment stays optional and the textarea's
  // maxlength enforces the cap the counter displays).
  function updateCommentCount() {
    if (!els.commentCount || !els.comment) return;
    var max = els.comment.getAttribute("maxlength") || "1000";
    els.commentCount.textContent = (els.comment.value.length) + "/" + max;
  }
  if (els.comment) els.comment.addEventListener("input", updateCommentCount);

  els.signin.addEventListener("click", async function () {
    clearError();
    els.signin.disabled = true;
    try {
      // Manual, gesture-driven → popup is fine here (and preserves page state).
      await PTOAuth.signIn();
      clearAutoLoginFlag(); // future signed-out visits may auto-login again
      renderAuth();
      await loadRequest();
    } catch (e) {
      showError("Sign-in failed: " + friendly(e));
    } finally {
      renderAuth();
    }
  });

  els.signout.addEventListener("click", async function () {
    clearError();
    try { await PTOAuth.signOut(); } catch (e) { showError(friendly(e)); }
    finally { renderAuth(); }
  });

  els.approve.addEventListener("click", function () { decide("Approved"); });
  els.reject.addEventListener("click", function () { decide("Rejected"); });

  // ---- boot -------------------------------------------------------------------
  // Auto sign-in, same pattern as request.html / hr.html (validated live):
  // browsers block popups at page load, so a same-tab loginRedirect is used.
  // On return from Microsoft, PTOAuth.initialize()'s handleRedirectPromise()
  // captures the account, so boot just finds getAccount() populated.
  //
  // LOOP GUARD: the redirect is attempted at most ONCE per tab session via a
  // sessionStorage flag set BEFORE navigating away. Returning cancelled/failed
  // (no account, flag present) → manual Sign in fallback, never a second
  // automatic redirect. If sessionStorage can't persist the flag, no
  // auto-redirect at all. Cleared on any successful sign-in.
  //
  // SECURITY UNCHANGED: no request data loads until PTOAuth confirms a signed-in
  // account AND PTOAuthz.enforce (inside loadRequest) authorizes; the decide
  // gate (canAct) is unchanged.
  var AUTO_LOGIN_FLAG = "approve_auto_login_attempted";

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
        if (!state.itemId) { showError(ITEM_ID_HELP); return; }
        await loadRequest();
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
          console.warn("[approve.page] auto sign-in redirect failed:", friendly(e));
        }
      }

      // Already attempted this tab session (user cancelled / auth failed / the
      // redirect errored) — or storage can't persist the guard flag. Manual
      // button fallback; never auto-retry.
      renderAuth();
      els.account.textContent = "Not signed in — click Sign in to continue.";
      els.account.classList.add("show-text");
      if (!state.itemId) showError(ITEM_ID_HELP);
    } catch (e) {
      showError("Initialization failed: " + friendly(e));
    }
  })();
})();
