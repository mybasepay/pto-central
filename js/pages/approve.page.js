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
  var query = new URLSearchParams(window.location.search || "");
  var PREVIEW_USER = {
    id: "preview-approver",
    displayName: "Rodolfo Chacon",
    mail: "rodolfo.chacon@example.test",
    userPrincipalName: "rodolfo.chacon@example.test",
  };
  var PREVIEW_ITEM = {
    id: "preview-approve-1",
    webUrl: "https://example.test/sharepoint/pto-requests/preview-approve-1",
    fields: {
      Title: "PTO-20260731-030551-WERL",
      RequesterName: "Tech Support",
      RequesterEmail: "techsupport@mybasepay.com",
      PtoType: "PTO",
      StartDate: "2026-08-02",
      EndDate: "2026-08-02",
      Status: "Pending",
      BackupContactName: "Rodolfo Chacon",
      BackupContactEmail: "rodolfo@mybasepay.com",
      SubmittedAt: "2026-07-31T09:05:51.000Z",
      ManagerName: "",
      ManagerEmail: "",
      Reason: "",
      IsShortNotice: true,
      NoticeDays: 2,
      AuditLog:
        "2026-07-31T09:05:51.786Z    [INFO]  Created by Tech Support - PTO Central app - self-service (Pending);\n" +
        "approval routed to Rodolfo Chacon <rodolfo@mybasepay.com> instead of -\n" +
        "override reason: test\n" +
        "2026-07-31T09:06:29.490Z    [INFO]  MANAGER NOTIFICATION MVP v1",
      ApproverName: "Rodolfo Chacon",
      ApproverEmail: "rodolfo@mybasepay.com",
      ApproverOverride: true,
      ApproverOverrideReason: "test",
      OriginalManagerName: "",
      OriginalManagerEmail: "",
    },
  };

  function clonePreviewItem() {
    return JSON.parse(JSON.stringify(PREVIEW_ITEM));
  }

  var els = {
    signin: $("signin"), signout: $("signout"), account: $("account"),
    userChip: $("user-chip"), userChipName: $("user-chip-name"), userChipAvatar: $("user-chip-avatar"),
    dismissBanner: $("dismiss-banner"), infoBanner: $("info-banner"),
    decisionUi: $("decision-ui"), comment: $("comment"), commentCount: $("comment-count"),
    approve: $("approve"), reject: $("reject"), decisionStatus: $("decision-status"),
    blockNote: $("block-note"), statusNote: $("status-note"),
    error: $("error"),
    approverNote: $("approver-note"),
  };

  var state = {
    // ?preview=1 only activates on localhost/loopback — see PTOUI.isLocalDevHost().
    preview: query.get("preview") === "1" && PTOUI.isLocalDevHost(),
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
  state.itemId = getItemIdFromUrl() || (state.preview ? PREVIEW_ITEM.id : null);

  var ITEM_ID_HELP = "No itemId in the URL. Open this page as one of:\n"
    + "  approve.html?itemId=123\n"
    + "  approve#itemId=123\n"
    + "  approve#?itemId=123";

  function friendly(e) {
    return (e && (e.message || e.errorMessage)) ? (e.message || e.errorMessage) : String(e);
  }
  function formatBackupContacts(nameValue, emailValue) {
    var names = String(nameValue || "").split(/\s*;\s*/).filter(Boolean);
    var emails = String(emailValue || "").split(/\s*;\s*/).filter(Boolean);
    if (!names.length && !emails.length) return "";
    if (names.length <= 1 && emails.length <= 1) {
      return (names[0] || "") + (emails[0] ? " <" + emails[0] + ">" : "");
    }
    var out = [];
    var len = Math.max(names.length, emails.length);
    for (var i = 0; i < len; i++) {
      var name = names[i] || "";
      var email = emails[i] || "";
      out.push((name || email) + (email && name ? " <" + email + ">" : ""));
    }
    return out.join("; ");
  }
  function showError(msg) { els.error.textContent = msg; els.error.style.display = "block"; }
  function clearError() { els.error.style.display = "none"; els.error.textContent = ""; }
  function showNote(el, msg) {
    if (!msg) { el.style.display = "none"; el.textContent = ""; return; }
    el.textContent = msg; el.style.display = "block";
  }

  function setDetailValue(id, value) {
    var node = $(id);
    var text = (value === undefined || value === null || value === "") ? "—" : String(value);
    PTOUI.setText(id, text);
    if (!node) return;
    node.title = text === "—" ? "" : text;
    node.classList.toggle("is-subtle", text === "—");
  }

  /** Two-letter initials for the user chip avatar (e.g. "Rodolfo Chacon" → "RC"). */
  function initialsOf(name) {
    var parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "··";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function renderAuth() {
    if (state.preview) {
      els.signin.disabled = true;
      els.signin.style.display = "none";
      els.signout.disabled = true;
      els.signout.style.display = "none";
      if (els.userChip) {
        els.userChip.classList.add("show");
        if (els.userChipName) els.userChipName.textContent = PREVIEW_USER.displayName;
        if (els.userChipAvatar) els.userChipAvatar.textContent = initialsOf(PREVIEW_USER.displayName);
      }
      els.account.classList.remove("show-text");
      els.account.textContent = "";
      return;
    }

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
    setDetailValue("d-key", f.Title);
    setDetailValue("d-requester", f.RequesterName);
    setDetailValue("d-requester-email", f.RequesterEmail);
    setDetailValue("d-type", f.PtoType);
    setDetailValue("d-start", PTOUI.formatDateOnly(f.StartDate));
    setDetailValue("d-end", PTOUI.formatDateOnly(f.EndDate));
    setDetailValue("d-reason", f.Reason);
    var backup = formatBackupContacts(f.BackupContactName, f.BackupContactEmail);
    setDetailValue("d-backup", backup.trim() || "—");

    var statusDd = $("d-status");
    statusDd.textContent = "";
    statusDd.appendChild(PTOUI.statusBadge(f.Status));
    statusDd.title = f.Status || "";
    statusDd.classList.remove("is-subtle");

    var statusHead = $("d-status-head");
    if (statusHead) {
      statusHead.textContent = "";
      statusHead.appendChild(PTOUI.statusBadge(f.Status));
      statusHead.title = f.Status || "";
      statusHead.classList.remove("is-subtle");
    }

    setDetailValue("d-submitted", f.SubmittedAt ? new Date(f.SubmittedAt).toLocaleString() : "—");
    var mgr = (f.ManagerName || "") + (f.ManagerEmail ? " <" + f.ManagerEmail + ">" : "");
    setDetailValue("d-manager", mgr.trim() || "—");

    // Approver: falls back to the manager when ApproverEmail is blank (legacy
    // requests / column not yet provisioned) — never shown as a separate
    // person unless it's actually different (docs/ALTERNATE_APPROVER_DESIGN.md).
    var approverEmail = approverMeta.ApproverEmail || f.ManagerEmail || "";
    var approverName = approverMeta.ApproverName || f.ManagerName || "";
    var apr = (approverName || "") + (approverEmail ? " <" + approverEmail + ">" : "");
    setDetailValue("d-approver", apr.trim() || "—");
    renderApproverNote(f, approverMeta);

    setDetailValue("d-short", f.IsShortNotice ? "Yes" : "No");
    setDetailValue("d-notice", (f.NoticeDays === undefined || f.NoticeDays === null) ? "—" : f.NoticeDays);

    var linkDd = $("d-link");
    linkDd.textContent = "";
    if (item && item.webUrl) {
      linkDd.appendChild(PTOUI.el("a", {
        href: item.webUrl,
        target: "_blank",
        rel: "noopener noreferrer",
        title: item.webUrl,
      }, [
        "Open",
        PTOUI.el("svg", {
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          "stroke-width": "1.8",
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          "aria-hidden": "true",
        }, [
          PTOUI.el("path", { d: "M14 4h6v6" }),
          PTOUI.el("path", { d: "M20 4l-9 9" }),
          PTOUI.el("path", { d: "M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" }),
        ]),
      ]));
      linkDd.classList.remove("is-subtle");
      linkDd.title = item.webUrl;
    } else {
      linkDd.textContent = "—";
      linkDd.classList.add("is-subtle");
      linkDd.title = "";
    }

    var auditEl = $("auditlog");
    if (auditEl) auditEl.textContent = f.AuditLog ? String(f.AuditLog) : "—";

    var rawEl = $("raw");
    if (rawEl) rawEl.textContent = item ? JSON.stringify(item, null, 2) : "—";
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
    if (state.preview) {
      state.me = Object.assign({}, PREVIEW_USER);
      state.authorized = true;
      state.isHrAdmin = true;
      state.decided = false;
      state.item = clonePreviewItem();
      state.fields = Object.assign({}, state.item.fields);
      state.approverMeta = {
        ApproverName: state.fields.ApproverName,
        ApproverEmail: state.fields.ApproverEmail,
        ApproverOverride: state.fields.ApproverOverride,
        ApproverOverrideReason: state.fields.ApproverOverrideReason,
        OriginalManagerName: state.fields.OriginalManagerName,
        OriginalManagerEmail: state.fields.OriginalManagerEmail,
      };
      if (els.infoBanner) {
        var bannerBody = els.infoBanner.querySelector(".info-banner__body");
        if (bannerBody) {
          bannerBody.innerHTML =
            "<strong>Preview mode:</strong> sample PTO approval data for layout review only. " +
            "No live request is being loaded and no decision writes back to production.";
        }
      }
      renderDetails(state.fields, state.item, state.approverMeta);
      evaluateGate();
      els.decisionStatus.textContent = "";
      return;
    }

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
      var result;
      if (state.preview) {
        var previewAuditLine =
          "[" + new Date().toISOString() + "] " + status + " by " +
          (state.me.displayName || state.me.mail || "Preview Approver") +
          (els.comment.value ? " — " + els.comment.value : "");
        result = {
          fields: Object.assign({}, state.fields, {
            Status: status,
            AuditLog: ((state.fields && state.fields.AuditLog) || "") +
              (((state.fields && state.fields.AuditLog) || "") ? "\n" : "") +
              previewAuditLine,
          }),
        };
      } else {
        result = await PTORequests.updateRequestDecision(state.itemId, {
          status: status,
          actor: state.me,
          comment: els.comment.value,
          existingAuditLog: (state.fields && state.fields.AuditLog) || "",
        });
      }

      state.decided = true;
      // Reflect the new values locally.
      state.fields = Object.assign({}, state.fields, result.fields);
      if (state.item) state.item.fields = Object.assign({}, state.item.fields || {}, state.fields);

      var statusDd = $("d-status");
      statusDd.textContent = "";
      statusDd.appendChild(PTOUI.statusBadge(state.fields.Status));
      statusDd.title = state.fields.Status || "";
      var statusHead = $("d-status-head");
      if (statusHead) {
        statusHead.textContent = "";
        statusHead.appendChild(PTOUI.statusBadge(state.fields.Status));
        statusHead.title = state.fields.Status || "";
      }
      var auditElAfterDecision = $("auditlog");
      if (auditElAfterDecision) auditElAfterDecision.textContent = state.fields.AuditLog ? String(state.fields.AuditLog) : "—";
      var rawElAfterDecision = $("raw");
      if (rawElAfterDecision && state.item) rawElAfterDecision.textContent = JSON.stringify(state.item, null, 2);
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
  updateCommentCount();

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
  if (els.dismissBanner) {
    els.dismissBanner.addEventListener("click", function () {
      if (els.infoBanner) els.infoBanner.hidden = true;
    });
  }

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
      if (state.preview) {
        renderAuth();
        await loadRequest();
        return;
      }

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
