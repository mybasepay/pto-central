/*
 * hr.page.js — Controller for hr.html (HR Center).
 *
 * Responsibility:
 *   - Sign in; enforce HR/Admin via PTOAuthz.enforce (ROLE_REQUIRED["hr.html"] —
 *     fails CLOSED: any lookup problem -> blocked, and NO request data is loaded).
 *   - Load ALL requests from the modern "PTO Requests" list
 *     (PTORequests.listAllRequests — paged, read-only).
 *   - Client-side filters: search, status, manager, start-date range,
 *     short-notice only, on-behalf only. Client-side pagination (view only).
 *   - Per-row kebab menu: Details expansion, Approval-page link, and SAFE
 *     cancellation (PTORequests.cancelRequest):
 *       confirm + reason -> Status = "Cancelled" + AuditLog append (+ optional
 *       Cancelled-by/CancelReason metadata when the columns exist). The validated
 *       "PTO Calendar Cancellation MVP Clean" flow reacts to the status — this
 *       page never touches calendar event ids and never deletes items.
 *
 * The legacy "PTO Tracking" list is intentionally NOT read here.
 * Pages call domain modules, never Graph directly (architecture §7).
 *
 * NOTE: the kebab menu + pagination here are presentation only. The data load,
 * cancellation, and authorization functions are unchanged in behavior.
 */

(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  var els = {
    signin: $("signin"), signout: $("signout"), account: $("account"),
    refresh: $("refresh"), applyFilters: $("apply-filters"), clearFilters: $("clear-filters"), count: $("count"),
    fSearch: $("f-search"), fStatus: $("f-status"), fManager: $("f-manager"),
    fFrom: $("f-from"), fTo: $("f-to"), fShort: $("f-short"), fObo: $("f-obo"),
    ok: $("ok"), warn: $("warn"), error: $("error"), empty: $("empty"),
    table: $("reqs-table"), body: $("reqs-body"),
    cancelPanel: $("cancel-panel"), cancelMeta: $("cancel-meta"),
    cancelReason: $("cancel-reason"), cancelConfirm: $("cancel-confirm"),
    cancelAbort: $("cancel-abort"), cancelStatus: $("cancel-status"),
    rowMenu: $("row-menu"),
    pager: $("pager"), pageSize: $("page-size"), pageRange: $("page-range"),
    pagePrev: $("page-prev"), pageNext: $("page-next"), pageNums: $("page-nums"),
  };

  var state = {
    me: null,
    authorized: false,
    all: [],            // normalized requests (PTORequests.listAllRequests)
    expandedId: null,   // row id with the details expansion open
    cancelTarget: null, // normalized request pending cancellation confirm
    cancelling: false,
    // view-only pagination
    page: 1,
    pageSize: 25,       // number, or Infinity for "All"
    // row action menu
    menuRequest: null,
    menuAnchor: null,
  };

  var yearEl = $("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  function friendly(e) {
    return (e && (e.message || e.errorMessage)) ? (e.message || e.errorMessage) : String(e);
  }
  function showError(msg) { els.error.textContent = msg; els.error.style.display = "block"; }
  function clearError() { els.error.style.display = "none"; els.error.textContent = ""; }
  function showOk(msg) {
    els.ok.textContent = msg || "";
    els.ok.style.display = msg ? "block" : "none";
  }
  function showWarn(msg) {
    els.warn.textContent = msg || "";
    els.warn.style.display = msg ? "block" : "none";
  }

  function renderAuth() {
    var acct = PTOAuth.getAccount();
    var signedIn = !!acct;
    els.signin.disabled = signedIn;
    els.signout.disabled = !signedIn;
    els.refresh.disabled = !signedIn || !state.authorized;
    els.account.textContent = signedIn
      ? "Signed in as " + (acct.username || acct.name || acct.homeAccountId)
      : "Not signed in.";
  }

  // ---- metadata (RequestMode / OnBehalf / SubmittedBy*) --------------------
  // Read through the resolved internal-name map so manually-created columns
  // (Submitted_x0020_By_x0020_Email, OnBehalf0, ...) display correctly.
  function metaOf(r) { return PTORequests.readSubmitMetadata(r.fields); }

  function truthy(v) { return v === true || v === "Yes" || v === "true" || v === 1; }

  // ---- filters --------------------------------------------------------------
  function matchesFilters(r) {
    var meta = metaOf(r);

    var q = els.fSearch.value.trim().toLowerCase();
    if (q) {
      var hay = [r.requestKey, r.requesterName, r.requesterEmail]
        .map(function (s) { return String(s || "").toLowerCase(); })
        .join(" | ");
      if (hay.indexOf(q) === -1) return false;
    }

    var st = els.fStatus.value;
    if (st !== "All") {
      if (st === "Auto-Approved") {
        if (r.status !== "Auto-Approved" && r.status !== "Auto-Approved (Escalation)") return false;
      } else if (r.status !== st) return false;
    }

    var mgr = els.fManager.value.trim().toLowerCase();
    if (mgr) {
      var mhay = (String(r.managerName || "") + " " + String(r.managerEmail || "")).toLowerCase();
      if (mhay.indexOf(mgr) === -1) return false;
    }

    // Start-date range (date-only lexicographic compare on YYYY-MM-DD).
    var start = String(r.startDate || "").slice(0, 10);
    if (els.fFrom.value && (!start || start < els.fFrom.value)) return false;
    if (els.fTo.value && (!start || start > els.fTo.value)) return false;

    if (els.fShort.checked && !truthy(r.isShortNotice)) return false;
    if (els.fObo.checked) {
      var onBehalf = truthy(meta.OnBehalf) || meta.RequestMode === "On behalf of";
      if (!onBehalf) return false;
    }
    return true;
  }

  // ---- table ----------------------------------------------------------------
  function fmtDateTime(value) {
    if (!value) return "—";
    var d = new Date(value);
    return isNaN(d.getTime()) ? String(value) : d.toLocaleString();
  }

  function cancellable(r) {
    return PTORequests.CANCELLABLE_STATUSES.indexOf(String(r.status || "").trim()) !== -1;
  }

  function whoCell(name, email) {
    var td = PTOUI.el("td", { class: "who" }, name || email || "—");
    if (name && email) td.appendChild(PTOUI.el("span", { class: "sub" }, email));
    return td;
  }

  function detailsRow(r) {
    var f = r.fields || {};
    var meta = metaOf(r);
    var dl = PTOUI.el("dl", { class: "details-grid" });

    function item(label, value, spanAll) {
      var wrap = PTOUI.el("div", spanAll ? { class: "span-all" } : null);
      wrap.appendChild(PTOUI.el("dt", null, label));
      var dd = PTOUI.el("dd", null);
      if (value instanceof Node) dd.appendChild(value); else dd.textContent = (value === undefined || value === null || value === "") ? "—" : String(value);
      wrap.appendChild(dd);
      dl.appendChild(wrap);
    }

    item("Reason / notes", f.Reason);
    item("Backup contact", ((f.BackupContactName || "") + (f.BackupContactEmail ? " <" + f.BackupContactEmail + ">" : "")).trim() || "—");
    item("Partial day / hours", f.IsPartialDay ? ("Yes" + (f.Hours ? " (" + f.Hours + " hrs)" : "")) : "No");
    item("Notice days", (r.noticeDays === undefined || r.noticeDays === null) ? "—" : r.noticeDays);
    item("Urgent", truthy(r.isUrgent) ? "Yes" : "No");
    item("Request mode", meta.RequestMode || (truthy(meta.OnBehalf) ? "On behalf of" : "Self"));
    item("On-behalf reason", meta.OnBehalfReason);
    item("Submitted by", ((meta.SubmittedByName || "") + (meta.SubmittedByEmail ? " <" + meta.SubmittedByEmail + ">" : "")).trim() || "—");
    item("Decision", f.DecisionByName
      ? f.Status + " by " + f.DecisionByName + (f.DecisionDate ? " on " + fmtDateTime(f.DecisionDate) : "")
      : "—");
    if (r.webUrl) {
      item("SharePoint item", PTOUI.el("a", { href: r.webUrl, target: "_blank", rel: "noopener noreferrer" }, "Open list item"));
    }

    var auditWrap = PTOUI.el("div", { class: "span-all" });
    auditWrap.appendChild(PTOUI.el("dt", null, "Audit log"));
    auditWrap.appendChild(PTOUI.el("pre", { class: "audit" }, f.AuditLog || "—"));
    dl.appendChild(auditWrap);

    var td = PTOUI.el("td", { colspan: "11" });
    td.appendChild(dl);
    return PTOUI.el("tr", { class: "details-row" }, td);
  }

  var KEBAB_SVG =
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
    '<circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>';

  function rowKebab(r) {
    var btn = PTOUI.el("button", {
      class: "kebab", type: "button", "aria-haspopup": "menu", "aria-expanded": "false",
      "aria-label": "Actions for " + (r.requestKey || ("#" + r.id)),
      html: KEBAB_SVG,
    });
    btn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      toggleRowMenu(btn, r);
    });
    return btn;
  }

  function renderTable() {
    closeRowMenu(); // rows are about to be rebuilt — drop any open menu

    var filtered = state.all.filter(matchesFilters);
    var total = filtered.length;

    // Pagination (view only).
    var size = state.pageSize;
    var pageCount = (size === Infinity) ? 1 : Math.max(1, Math.ceil(total / size));
    if (state.page > pageCount) state.page = pageCount;
    if (state.page < 1) state.page = 1;
    var startIdx = (size === Infinity) ? 0 : (state.page - 1) * size;
    var endIdx = (size === Infinity) ? total : Math.min(total, startIdx + size);
    var pageRows = filtered.slice(startIdx, endIdx);

    els.body.innerHTML = "";
    pageRows.forEach(function (r) {
      var meta = metaOf(r);
      var onBehalf = truthy(meta.OnBehalf) || meta.RequestMode === "On behalf of";

      var actionsTd = PTOUI.el("td", { class: "col-actions" }, rowKebab(r));

      var tr = PTOUI.el("tr", null, [
        PTOUI.el("td", null, r.requestKey || ("#" + r.id)),
        whoCell(r.requesterName, r.requesterEmail),
        PTOUI.el("td", null, r.ptoType || "—"),
        PTOUI.el("td", null, PTOUI.formatRange(r.startDate, r.endDate)),
        PTOUI.el("td", null, fmtDateTime(r.submittedAt)),
        whoCell(r.managerName, r.managerEmail),
        PTOUI.el("td", null, PTOUI.statusBadge(r.status)),
        truthy(r.isShortNotice)
          ? PTOUI.el("td", { class: "flag-short" }, "Short")
          : PTOUI.el("td", { class: "flag-none" }, "—"),
        PTOUI.el("td", { class: onBehalf ? "mode-obo" : "mode-self" }, onBehalf ? "On behalf" : "Self"),
        whoCell(meta.SubmittedByName, meta.SubmittedByEmail),
        actionsTd,
      ]);
      els.body.appendChild(tr);
      if (state.expandedId === r.id) els.body.appendChild(detailsRow(r));
    });

    var hasRows = total > 0;
    els.table.style.display = hasRows ? "" : "none";
    els.empty.style.display = hasRows ? "none" : "block";
    els.empty.textContent = state.all.length
      ? "No requests match the current filters."
      : "No PTO requests found.";
    els.count.textContent = state.all.length
      ? total + " shown of " + state.all.length + " loaded"
      : "";

    renderPager(total, startIdx, endIdx, pageCount);
  }

  // ---- pagination (view only) -----------------------------------------------
  function pageWindow(cur, totalPages) {
    var out = [];
    if (totalPages <= 7) {
      for (var i = 1; i <= totalPages; i++) out.push(i);
      return out;
    }
    out.push(1);
    var s = Math.max(2, cur - 1);
    var e = Math.min(totalPages - 1, cur + 1);
    if (s > 2) out.push("…");
    for (var j = s; j <= e; j++) out.push(j);
    if (e < totalPages - 1) out.push("…");
    out.push(totalPages);
    return out;
  }

  function renderPager(total, startIdx, endIdx, pageCount) {
    if (!total) { els.pager.style.display = "none"; return; }
    els.pager.style.display = "flex";
    els.pageRange.textContent = (startIdx + 1) + "–" + endIdx + " of " + total;

    els.pagePrev.disabled = state.page <= 1;
    els.pageNext.disabled = state.page >= pageCount;

    els.pageNums.innerHTML = "";
    pageWindow(state.page, pageCount).forEach(function (p) {
      if (p === "…") {
        els.pageNums.appendChild(PTOUI.el("span", { class: "page-ellipsis" }, "…"));
        return;
      }
      var b = PTOUI.el("button", {
        class: "page-btn" + (p === state.page ? " active" : ""),
        type: "button",
        "aria-label": "Page " + p,
        "aria-current": p === state.page ? "page" : null,
      }, String(p));
      b.addEventListener("click", function () { goToPage(p); });
      els.pageNums.appendChild(b);
    });
  }

  function goToPage(p) {
    state.page = p;
    renderTable();
  }

  function resetToFirstPage() { state.page = 1; renderTable(); }

  // ---- row action menu ------------------------------------------------------
  function menuItem(act) { return els.rowMenu.querySelector('[data-act="' + act + '"]'); }

  function toggleRowMenu(anchor, r) {
    if (!els.rowMenu.hidden && state.menuAnchor === anchor) { closeRowMenu(); return; }
    openRowMenu(anchor, r);
  }

  function openRowMenu(anchor, r) {
    state.menuRequest = r;
    state.menuAnchor = anchor;

    // Approval-page link (unchanged behavior — relative deep link, new tab).
    menuItem("approval").setAttribute("href", PTOLinks.relativeApprovalUrl(r.id));

    // Cancel item: shown only when the request can be cancelled.
    var canCancel = cancellable(r);
    menuItem("cancel").style.display = canCancel ? "" : "none";
    menuItem("cancel-sep").style.display = canCancel ? "" : "none";

    // Reveal, measure, position (fixed = viewport coords from the anchor rect).
    els.rowMenu.hidden = false;
    var rect = anchor.getBoundingClientRect();
    var mw = els.rowMenu.offsetWidth;
    var mh = els.rowMenu.offsetHeight;
    var left = Math.max(8, Math.min(rect.right - mw, window.innerWidth - mw - 8));
    var top = rect.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, rect.top - mh - 6); // flip up near bottom
    els.rowMenu.style.left = left + "px";
    els.rowMenu.style.top = top + "px";

    anchor.setAttribute("aria-expanded", "true");

    var first = firstVisibleMenuItem();
    if (first) first.focus();
  }

  function closeRowMenu(refocus) {
    if (els.rowMenu.hidden) { return; }
    els.rowMenu.hidden = true;
    var anchor = state.menuAnchor;
    if (anchor) anchor.setAttribute("aria-expanded", "false");
    state.menuAnchor = null;
    state.menuRequest = null;
    if (refocus && anchor && document.contains(anchor)) anchor.focus();
  }

  function visibleMenuItems() {
    return Array.prototype.filter.call(
      els.rowMenu.querySelectorAll(".row-menu-item"),
      function (n) { return n.style.display !== "none"; }
    );
  }
  function firstVisibleMenuItem() { return visibleMenuItems()[0] || null; }

  // Menu item actions (bound once; read state.menuRequest).
  menuItem("details").addEventListener("click", function () {
    var r = state.menuRequest;
    closeRowMenu();
    if (r) { state.expandedId = state.expandedId === r.id ? null : r.id; renderTable(); }
  });
  menuItem("approval").addEventListener("click", function () {
    // Let the <a> open in a new tab (href set on open); just close the menu.
    closeRowMenu();
  });
  menuItem("cancel").addEventListener("click", function () {
    var r = state.menuRequest;
    closeRowMenu();
    if (r) openCancelPanel(r);
  });

  // Global dismissers.
  document.addEventListener("click", function (e) {
    if (els.rowMenu.hidden) return;
    if (els.rowMenu.contains(e.target)) return;
    if (state.menuAnchor && state.menuAnchor.contains(e.target)) return;
    closeRowMenu();
  });
  document.addEventListener("keydown", function (e) {
    if (els.rowMenu.hidden) return;
    if (e.key === "Escape") { e.preventDefault(); closeRowMenu(true); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      var items = visibleMenuItems();
      if (!items.length) return;
      var idx = items.indexOf(document.activeElement);
      e.preventDefault();
      if (e.key === "ArrowDown") idx = (idx + 1) % items.length;
      else idx = (idx - 1 + items.length) % items.length;
      items[idx].focus();
    }
  });
  window.addEventListener("scroll", function () { closeRowMenu(); }, true);
  window.addEventListener("resize", function () { closeRowMenu(); });

  // ---- cancellation (UNCHANGED behavior) ------------------------------------
  function openCancelPanel(r) {
    state.cancelTarget = r;
    els.cancelMeta.textContent =
      (r.requestKey || ("#" + r.id)) + " — " +
      (r.requesterName || r.requesterEmail || "unknown requester") + " · " +
      (r.ptoType || "?") + " · " + PTOUI.formatRange(r.startDate, r.endDate) +
      " · current status: " + (r.status || "?");
    els.cancelReason.value = "";
    els.cancelStatus.textContent = "";
    els.cancelPanel.style.display = "block";
    els.cancelPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    els.cancelReason.focus();
  }

  function closeCancelPanel() {
    state.cancelTarget = null;
    els.cancelPanel.style.display = "none";
    els.cancelStatus.textContent = "";
  }

  async function onConfirmCancel() {
    var r = state.cancelTarget;
    if (!r || state.cancelling) return;

    clearError(); showOk("");
    // Duplicate guard — re-check the loaded status before writing.
    if (!cancellable(r)) {
      showError("This request can no longer be cancelled (status: " + r.status + ").");
      closeCancelPanel();
      return;
    }

    state.cancelling = true;
    els.cancelConfirm.disabled = true;
    els.cancelAbort.disabled = true;
    els.cancelStatus.textContent = "Cancelling…";
    try {
      var result = await PTORequests.cancelRequest(r.id, {
        actor: state.me,
        reason: els.cancelReason.value,
        currentStatus: r.status,
        existingAuditLog: (r.fields && r.fields.AuditLog) || "",
      });

      // Reflect locally — no full reload needed.
      r.status = "Cancelled";
      r.fields = Object.assign({}, r.fields, result.fields);
      closeCancelPanel();
      renderTable();
      showOk(
        "✓ " + (r.requestKey || ("#" + r.id)) + " cancelled. Audit log updated." +
        " If it was approved, the calendar events will be removed automatically by the cancellation flow."
      );
    } catch (e) {
      els.cancelStatus.textContent = "";
      showError("Could not cancel " + (r.requestKey || ("#" + r.id)) + ": " + friendly(e));
    } finally {
      state.cancelling = false;
      els.cancelConfirm.disabled = false;
      els.cancelAbort.disabled = false;
    }
  }

  // ---- data (UNCHANGED behavior) --------------------------------------------
  async function loadRequests() {
    clearError(); showOk(""); showWarn("");
    els.refresh.disabled = true;
    els.count.textContent = "Loading…";
    try {
      state.me = await PTODirectory.getMe();
      var az = await PTOAuthz.enforce(state.me);
      state.authorized = az.authorized;
      if (!az.authorized) {
        // authz.js already blocked the UI with a clean message; load NOTHING.
        els.count.textContent = "";
        return;
      }

      // Resolve the submit-metadata internal names once so RequestMode /
      // OnBehalf / SubmittedBy* read correctly from manually-created columns.
      try { await PTORequests.resolveMetadataFieldMap(); } catch (e) { /* tolerated */ }

      var result = await PTORequests.listAllRequests({ top: 200, maxPages: 10 });
      state.all = result.items || [];
      if (result.truncated) {
        showWarn("Showing the " + state.all.length + " most recent requests — older items beyond the page cap were not loaded.");
      }
      state.expandedId = null;
      state.page = 1;
      closeCancelPanel();
      renderTable();
    } catch (e) {
      state.all = [];
      renderTable();
      showError("Could not load requests: " + friendly(e));
    } finally {
      renderAuth();
    }
  }

  // ---- wiring ----------------------------------------------------------------
  // Live filtering (responsive) + explicit "Apply filters". Both reset to page 1.
  [els.fSearch, els.fManager].forEach(function (el) {
    el.addEventListener("input", resetToFirstPage);
  });
  [els.fStatus, els.fFrom, els.fTo, els.fShort, els.fObo].forEach(function (el) {
    el.addEventListener("change", resetToFirstPage);
  });
  els.applyFilters.addEventListener("click", resetToFirstPage);
  els.clearFilters.addEventListener("click", function () {
    els.fSearch.value = ""; els.fManager.value = "";
    els.fStatus.value = "All"; els.fFrom.value = ""; els.fTo.value = "";
    els.fShort.checked = false; els.fObo.checked = false;
    resetToFirstPage();
  });

  els.pageSize.addEventListener("change", function () {
    var v = els.pageSize.value;
    state.pageSize = (v === "all") ? Infinity : parseInt(v, 10) || 25;
    state.page = 1;
    renderTable();
  });
  els.pagePrev.addEventListener("click", function () { if (state.page > 1) goToPage(state.page - 1); });
  els.pageNext.addEventListener("click", function () { goToPage(state.page + 1); });

  els.refresh.addEventListener("click", loadRequests);
  els.cancelConfirm.addEventListener("click", onConfirmCancel);
  els.cancelAbort.addEventListener("click", closeCancelPanel);

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
    state.authorized = false;
    closeRowMenu();
    closeCancelPanel();
    renderTable();
    renderAuth();
  });

  // ---- boot -------------------------------------------------------------------
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
