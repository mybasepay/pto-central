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
    decisionUi: $("decision-ui"), comment: $("comment"),
    approve: $("approve"), reject: $("reject"), decisionStatus: $("decision-status"),
    blockNote: $("block-note"), statusNote: $("status-note"),
    error: $("error"), auditlog: $("auditlog"), raw: $("raw"),
  };

  var state = { itemId: null, me: null, item: null, fields: null, decided: false, authorized: false, isHrAdmin: false, canAct: false };

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

  function renderAuth() {
    var acct = PTOAuth.getAccount();
    var signedIn = !!acct;
    els.signin.disabled = signedIn;
    els.signout.disabled = !signedIn;
    els.account.textContent = signedIn
      ? "Signed in as " + (acct.username || acct.name || acct.homeAccountId)
      : "Not signed in.";
  }

  function myEmail() {
    var m = state.me || {};
    return String(m.mail || m.userPrincipalName || "").trim().toLowerCase();
  }

  function renderDetails(f, item) {
    PTOUI.setText("d-key", f.Title);
    PTOUI.setText("d-requester", f.RequesterName);
    PTOUI.setText("d-requester-email", f.RequesterEmail);
    PTOUI.setText("d-type", f.PtoType);
    PTOUI.setText("d-start", PTOUI.formatDateOnly(f.StartDate));
    PTOUI.setText("d-end", PTOUI.formatDateOnly(f.EndDate));
    PTOUI.setText("d-partial", f.IsPartialDay ? ("Yes" + (f.Hours ? " (" + f.Hours + " hrs)" : "")) : "No");
    PTOUI.setText("d-reason", f.Reason);
    var backup = (f.BackupContactName || "") + (f.BackupContactEmail ? " <" + f.BackupContactEmail + ">" : "");
    PTOUI.setText("d-backup", backup.trim() || "—");

    var statusDd = $("d-status");
    statusDd.textContent = "";
    statusDd.appendChild(PTOUI.statusBadge(f.Status));

    PTOUI.setText("d-submitted", f.SubmittedAt ? new Date(f.SubmittedAt).toLocaleString() : "—");
    var mgr = (f.ManagerName || "") + (f.ManagerEmail ? " <" + f.ManagerEmail + ">" : "");
    PTOUI.setText("d-manager", mgr.trim() || "—");
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
    var managerEmail = String(f.ManagerEmail || "").trim().toLowerCase();

    var mine = myEmail();
    var isManager = !!mine && managerEmail === mine;
    // Can act if assigned manager OR HR/Admin (HR/Admin may act on any request,
    // even one with no assigned manager email).
    state.canAct = isManager || state.isHrAdmin;

    if (!state.canAct) {
      showNote(els.blockNote,
        "You can't act on this request. You must be the assigned manager (" +
        (managerEmail || "none set") + ") or have HR/Admin rights.");
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
      els.raw.textContent = JSON.stringify(item, null, 2);
      renderDetails(state.fields, item);
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
  els.signin.addEventListener("click", async function () {
    clearError();
    els.signin.disabled = true;
    try {
      await PTOAuth.signIn();
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

  // ---- boot ----
  (async function boot() {
    try {
      await PTOAuth.initialize();
      renderAuth();
      if (!state.itemId) {
        showError(ITEM_ID_HELP);
      } else if (PTOAuth.getAccount()) {
        await loadRequest();
      }
    } catch (e) {
      showError("Initialization failed: " + friendly(e));
    }
  })();
})();
