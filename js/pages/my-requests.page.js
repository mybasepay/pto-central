/*
 * my-requests.page.js — Controller for my-requests.html (My Requests).
 *
 * Responsibility (per PTO_CENTRAL_ARCHITECTURE.md §8.3):
 *   - Sign in (auto-login on load, same redirect + loop-guard pattern as
 *     request.html / approve.html); load the signed-in user's own requests via
 *     PTORequests.listMyRequests(email).
 *   - Simple summary counts (total / pending / approved), a search + status
 *     filter, a Refresh button, and a clean 4-column table with status badges.
 *   - Empty state, error panel, and a collapsed raw-JSON debug section.
 *
 * READ-ONLY: no cancel/edit. Data source, user-filtering, and status values
 * are unchanged. Pages call domain modules, never Graph directly (§7).
 */

(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  var els = {
    signin: $("signin"), signout: $("signout"), account: $("account"),
    userChip: $("user-chip"), userChipName: $("user-chip-name"), userChipAvatar: $("user-chip-avatar"),
    refresh: $("refresh"), statusFilter: $("statusFilter"), search: $("search"), count: $("count"),
    warn: $("warn"), error: $("error"), empty: $("empty"),
    table: $("reqs-table"), body: $("reqs-body"), raw: $("raw"),
    statTotal: $("stat-total"), statPending: $("stat-pending"), statApproved: $("stat-approved"),
    pageSize: $("page-size"), pagePrev: $("page-prev"), pageNext: $("page-next"),
  };

  var state = { email: null, all: [], page: 1, pageSize: 10 };

  var yearEl = $("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  function friendly(e) {
    return (e && (e.message || e.errorMessage)) ? (e.message || e.errorMessage) : String(e);
  }
  function showError(msg) { els.error.textContent = msg; els.error.style.display = "block"; }
  function clearError() { els.error.style.display = "none"; els.error.textContent = ""; }
  function showWarn(msg) {
    if (!msg) { els.warn.style.display = "none"; els.warn.textContent = ""; return; }
    els.warn.textContent = msg; els.warn.style.display = "block";
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
    // Signed in: show the user chip, hide Sign in (same as request/approve).
    els.signin.disabled = signedIn;
    els.signin.style.display = signedIn ? "none" : "";
    els.signout.disabled = !signedIn;
    els.refresh.disabled = !signedIn;
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

  /** Status filter match. "Auto-Approved" includes the escalation variant. */
  function matchesFilter(status, filter) {
    if (filter === "All") return true;
    if (filter === "Auto-Approved") {
      return status === "Auto-Approved" || status === "Auto-Approved (Escalation)";
    }
    return status === filter;
  }

  /** Free-text search over request key + PTO type (case-insensitive). */
  function matchesSearch(r, q) {
    if (!q) return true;
    var hay = (String(r.requestKey || "") + " " + String(r.ptoType || "")).toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  function fmtDateTime(value) {
    if (!value) return "—";
    var d = new Date(value);
    return isNaN(d.getTime()) ? String(value) : d.toLocaleString();
  }

  function isApprovedStatus(s) {
    return s === "Approved" || s === "Auto-Approved" || s === "Auto-Approved (Escalation)";
  }

  /** Summary cards — always reflect the full loaded set (not the filtered view). */
  function updateSummary() {
    var total = state.all.length;
    var pending = 0, approved = 0;
    state.all.forEach(function (r) {
      if (r.status === "Pending") pending++;
      else if (isApprovedStatus(r.status)) approved++;
    });
    if (els.statTotal) els.statTotal.textContent = total;
    if (els.statPending) els.statPending.textContent = pending;
    if (els.statApproved) els.statApproved.textContent = approved;
  }

  function filteredRows() {
    var filter = els.statusFilter.value;
    var q = (els.search.value || "").trim().toLowerCase();
    return state.all.filter(function (r) {
      return matchesFilter(r.status, filter) && matchesSearch(r, q);
    });
  }

  function renderTable() {
    var rows = filteredRows();
    var total = rows.length;

    // Simple client-side pagination (view only).
    var size = state.pageSize; // number, or Infinity for "All"
    var pageCount = (size === Infinity) ? 1 : Math.max(1, Math.ceil(total / size));
    if (state.page > pageCount) state.page = pageCount;
    if (state.page < 1) state.page = 1;
    var startIdx = (size === Infinity) ? 0 : (state.page - 1) * size;
    var endIdx = (size === Infinity) ? total : Math.min(total, startIdx + size);
    var pageRows = rows.slice(startIdx, endIdx);

    els.body.innerHTML = "";
    pageRows.forEach(function (r) {
      var tr = PTOUI.el("tr", null, [
        PTOUI.el("td", { class: "key" }, r.requestKey || "—"),
        PTOUI.el("td", null, r.ptoType || "—"),
        PTOUI.el("td", null, PTOUI.formatRange(r.startDate, r.endDate)),
        PTOUI.el("td", null, PTOUI.statusBadge(r.status)),
      ]);
      els.body.appendChild(tr);
    });

    var hasRows = total > 0;
    els.table.style.display = hasRows ? "" : "none";
    els.empty.style.display = hasRows ? "none" : "block";
    els.empty.textContent = state.all.length
      ? "No requests match your search or filter."
      : "No PTO requests found for this account.";

    // Footer "Showing X to Y of Z requests".
    els.count.textContent = total
      ? "Showing " + (startIdx + 1) + " to " + endIdx + " of " + total + " request" + (total === 1 ? "" : "s")
      : "";

    if (els.pagePrev) els.pagePrev.disabled = state.page <= 1;
    if (els.pageNext) els.pageNext.disabled = state.page >= pageCount;
  }

  function resetToFirstPage() { state.page = 1; renderTable(); }

  async function loadRequests() {
    clearError();
    showWarn(null);
    els.refresh.disabled = true;
    els.count.textContent = "Loading…";
    try {
      var me = await PTODirectory.getMe();
      state.email = me.mail || me.userPrincipalName;
      if (!state.email) throw new Error("Could not determine your email from your profile.");

      var az = await PTOAuthz.enforce(me);
      if (!az.authorized) { els.count.textContent = ""; return; }

      var result = await PTORequests.listMyRequests(state.email);
      state.all = result.items || [];
      els.raw.textContent = JSON.stringify(result.raw || result, null, 2);

      if (result.warning) {
        showWarn(result.warning + (result.usedFallback ? " (showing client-side filtered results)" : ""));
      }
      updateSummary();
      state.page = 1;
      renderTable();
    } catch (e) {
      state.all = [];
      updateSummary();
      renderTable();
      showError("Could not load your requests: " + friendly(e));
    } finally {
      els.refresh.disabled = !PTOAuth.getAccount();
    }
  }

  // ---- wiring ----
  els.statusFilter.addEventListener("change", resetToFirstPage);
  if (els.search) els.search.addEventListener("input", resetToFirstPage);
  if (els.pageSize) {
    els.pageSize.addEventListener("change", function () {
      var v = els.pageSize.value;
      state.pageSize = (v === "all") ? Infinity : (parseInt(v, 10) || 10);
      resetToFirstPage();
    });
  }
  if (els.pagePrev) els.pagePrev.addEventListener("click", function () { if (state.page > 1) { state.page--; renderTable(); } });
  if (els.pageNext) els.pageNext.addEventListener("click", function () { state.page++; renderTable(); });

  els.signin.addEventListener("click", async function () {
    clearError();
    els.signin.disabled = true;
    try {
      // Manual, gesture-driven → popup is fine here.
      await PTOAuth.signIn();
      clearAutoLoginFlag(); // future signed-out visits may auto-login again
      renderAuth();
      await loadRequests();
    } catch (e) {
      showError("Sign-in failed: " + friendly(e));
    } finally {
      renderAuth();
    }
  });

  els.signout.addEventListener("click", async function () {
    clearError();
    try { await PTOAuth.signOut(); } catch (e) { showError(friendly(e)); }
    state.all = [];
    updateSummary();
    renderTable();
    renderAuth();
  });

  els.refresh.addEventListener("click", loadRequests);

  // ---- boot -------------------------------------------------------------------
  // Auto sign-in, same pattern as request.html / approve.html (validated live):
  // browsers block popups at page load, so a same-tab loginRedirect is used. On
  // return, PTOAuth.initialize()'s handleRedirectPromise() captures the account.
  //
  // LOOP GUARD: at most ONE redirect per tab session via a sessionStorage flag
  // set BEFORE navigating away. Returning cancelled/failed → manual Sign in
  // fallback, never a second automatic redirect. Broken storage → no
  // auto-redirect. Cleared on any successful sign-in.
  var AUTO_LOGIN_FLAG = "myreq_auto_login_attempted";

  function autoLoginAttempted() {
    try { return sessionStorage.getItem(AUTO_LOGIN_FLAG) === "1"; } catch (e) { return true; }
  }
  function markAutoLoginAttempted() {
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
        clearAutoLoginFlag();
        await loadRequests();
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
          console.warn("[my-requests.page] auto sign-in redirect failed:", friendly(e));
        }
      }

      // Manual fallback; never auto-retry this tab session.
      renderAuth();
      els.account.textContent = "Not signed in — click Sign in to continue.";
      els.account.classList.add("show-text");
    } catch (e) {
      showError("Initialization failed: " + friendly(e));
    }
  })();
})();
