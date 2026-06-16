/*
 * my-requests.page.js — Controller for my-requests.html (My Requests).
 *
 * Responsibility (per PTO_CENTRAL_ARCHITECTURE.md §8.3):
 *   - Sign in; load the signed-in user's own requests via
 *     PTORequests.listMyRequests(email).
 *   - Render a table with a client-side status filter + refresh.
 *   - Empty state, error panel, and raw JSON for debugging.
 *
 * Phase 2C scope: READ-ONLY. No cancel/edit yet. Pages call domain modules,
 * never Graph directly (§7).
 */

(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  var els = {
    signin: $("signin"), signout: $("signout"), account: $("account"),
    refresh: $("refresh"), statusFilter: $("statusFilter"), count: $("count"),
    warn: $("warn"), error: $("error"), empty: $("empty"),
    table: $("reqs-table"), body: $("reqs-body"), raw: $("raw"),
  };

  var state = { email: null, all: [] };

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

  function renderAuth() {
    var acct = PTOAuth.getAccount();
    var signedIn = !!acct;
    els.signin.disabled = signedIn;
    els.signout.disabled = !signedIn;
    els.refresh.disabled = !signedIn;
    els.account.textContent = signedIn
      ? "Signed in as " + (acct.username || acct.name || acct.homeAccountId)
      : "Not signed in.";
  }

  /** Status filter match. "Auto-Approved" includes the escalation variant. */
  function matchesFilter(status, filter) {
    if (filter === "All") return true;
    if (filter === "Auto-Approved") {
      return status === "Auto-Approved" || status === "Auto-Approved (Escalation)";
    }
    return status === filter;
  }

  function fmtDateTime(value) {
    if (!value) return "—";
    var d = new Date(value);
    return isNaN(d.getTime()) ? String(value) : d.toLocaleString();
  }

  function renderTable() {
    var filter = els.statusFilter.value;
    var rows = state.all.filter(function (r) { return matchesFilter(r.status, filter); });

    els.body.innerHTML = "";
    rows.forEach(function (r) {
      var tr = PTOUI.el("tr", null, [
        PTOUI.el("td", null, r.requestKey || "—"),
        PTOUI.el("td", null, r.ptoType || "—"),
        PTOUI.el("td", null, PTOUI.formatRange(r.startDate, r.endDate)),
        PTOUI.el("td", null, PTOUI.statusBadge(r.status)),
        PTOUI.el("td", null, r.managerEmail || "—"),
        r.isShortNotice
          ? PTOUI.el("td", { class: "yes" }, "Yes")
          : PTOUI.el("td", null, "No"),
        PTOUI.el("td", null, fmtDateTime(r.submittedAt)),
        PTOUI.el("td", null,
          r.webUrl
            ? PTOUI.el("a", { href: r.webUrl, target: "_blank", rel: "noopener noreferrer" }, "Open")
            : "—"
        ),
      ]);
      els.body.appendChild(tr);
    });

    var hasRows = rows.length > 0;
    els.table.style.display = hasRows ? "" : "none";
    els.empty.style.display = hasRows ? "none" : (state.all.length ? "block" : "block");
    els.empty.textContent = state.all.length
      ? "No requests match the “" + filter + "” filter."
      : "No PTO requests found for this account.";

    els.count.textContent =
      state.all.length
        ? rows.length + " shown of " + state.all.length + " total"
        : "";
  }

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
      renderTable();
    } catch (e) {
      state.all = [];
      renderTable();
      showError("Could not load your requests: " + friendly(e));
    } finally {
      els.refresh.disabled = !PTOAuth.getAccount();
    }
  }

  // ---- wiring ----
  els.statusFilter.addEventListener("change", renderTable);

  els.signin.addEventListener("click", async function () {
    clearError();
    els.signin.disabled = true;
    try {
      await PTOAuth.signIn();
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
    renderTable();
    renderAuth();
  });

  els.refresh.addEventListener("click", loadRequests);

  // ---- boot ----
  (async function boot() {
    try {
      await PTOAuth.initialize();
      renderAuth();
      if (PTOAuth.getAccount()) await loadRequests();
    } catch (e) {
      showError("Initialization failed: " + friendly(e));
    }
  })();
})();
