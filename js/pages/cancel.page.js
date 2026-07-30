/*
 * cancel.page.js - Employee cancellation workspace.
 *
 * Loads the signed-in user's PTO records and lets eligible employee-side
 * cancellation requests move to "Cancellation Requested". Demo mode is handled
 * by js/demo-mode.js, which keeps all writes in sessionStorage.
 */

(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  var els = {
    signin: $("signin"), signout: $("signout"), account: $("account"),
    userChip: $("user-chip"), userChipName: $("user-chip-name"), userChipAvatar: $("user-chip-avatar"),
    refresh: $("refresh"), search: $("search"),
    notice: $("notice"), error: $("error"),
    activeList: $("active-list"), activeEmpty: $("active-empty"), activeCount: $("active-count"),
    pastList: $("past-list"), pastEmpty: $("past-empty"), pastCount: $("past-count"),
    modalTitle: $("cancel-modal-title"), modalSubtitle: $("cancel-modal-subtitle"),
    modalDetail: $("cancel-detail"), cancelReason: $("cancel-reason"), confirmCancel: $("confirm-cancel"),
  };

  var state = {
    me: null,
    email: null,
    all: [],
    activeItem: null,
    dialog: null,
  };

  var yearEl = $("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  function friendly(e) {
    return (e && (e.message || e.errorMessage)) ? (e.message || e.errorMessage) : String(e);
  }
  function showError(msg) { els.error.textContent = msg; els.error.style.display = "block"; }
  function clearError() { els.error.textContent = ""; els.error.style.display = "none"; }
  function showNotice(msg) {
    if (!msg) { els.notice.textContent = ""; els.notice.style.display = "none"; return; }
    els.notice.textContent = msg;
    els.notice.style.display = "block";
  }
  function initialsOf(name) {
    var parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "--";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  function renderAuth() {
    var acct = PTOAuth.getAccount();
    var signedIn = !!acct;
    els.signin.disabled = signedIn;
    els.signin.style.display = signedIn ? "none" : "";
    els.signout.disabled = !signedIn;
    els.refresh.disabled = !signedIn;
    if (els.userChip) {
      els.userChip.classList.toggle("show", signedIn);
      if (signedIn) {
        var display = acct.name || acct.username || acct.homeAccountId;
        if (els.userChipName) els.userChipName.textContent = display;
        if (els.userChipAvatar) els.userChipAvatar.textContent = initialsOf(display);
      }
    }
    els.account.classList.toggle("show-text", !signedIn);
    els.account.textContent = signedIn ? "" : "Not signed in.";
  }

  function dateKey(value) {
    return String(value || "").slice(0, 10);
  }
  function isCancellationRequested(status) {
    return String(status || "").trim() === PTORules.STATUS_VALUES.CANCELLATION_REQUESTED;
  }
  function cancellationState(r) {
    if (isCancellationRequested(r.status)) {
      return { eligible: false, label: "Cancellation Requested", reason: "Cancellation Requested" };
    }
    if (!PTORules.isEmployeeCancellationEligible(r.status)) {
      return { eligible: false, label: "-", reason: "-" };
    }
    return { eligible: true, label: "Request Cancellation", reason: "" };
  }
  function isActiveBucket(r) {
    var end = dateKey(r.endDate || r.startDate);
    return !end || end >= PTORules.todayDateOnly();
  }
  function backupSummary(fields) {
    var contacts = PTORules.parseBackupContacts(fields || {});
    if (!contacts.length) return "-";
    return contacts.map(function (c) { return personLine(c.name, c.email); }).join("; ");
  }
  function submittedDate(r) {
    var f = r.fields || {};
    return f.SubmittedAt ? PTOUI.formatDateOnly(f.SubmittedAt) : "-";
  }
  function requestHaystack(r) {
    var f = r.fields || {};
    return [
      r.ptoType, r.startDate, r.endDate, r.status,
      f.Reason, f.CancellationRequestReason,
      f.ApproverName, f.ApproverEmail, f.ManagerName, f.ManagerEmail,
      backupSummary(f),
    ].join(" ").toLowerCase();
  }
  function matchesSearch(r) {
    var q = (els.search.value || "").trim().toLowerCase();
    return !q || requestHaystack(r).indexOf(q) !== -1;
  }
  function sortActive(a, b) {
    return String(a.startDate || "").localeCompare(String(b.startDate || ""));
  }
  function sortPast(a, b) {
    return String(b.startDate || "").localeCompare(String(a.startDate || ""));
  }
  function requestDuration(r) {
    var start = dateKey(r.startDate);
    var end = dateKey(r.endDate || r.startDate);
    if (!start) return "-";
    var s = new Date(start + "T00:00:00");
    var e = new Date((end || start) + "T00:00:00");
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return "-";
    var days = Math.round((e - s) / 86400000) + 1;
    return days + " day" + (days === 1 ? "" : "s");
  }
  function personLine(name, email) {
    return ((name || "") + (email ? " <" + email + ">" : "")).trim() || "-";
  }
  function setCount(el, n) {
    el.textContent = n + " request" + (n === 1 ? "" : "s");
  }
  function approverSummary(fields) {
    fields = fields || {};
    return personLine(fields.ApproverName || fields.ManagerName, fields.ApproverEmail || fields.ManagerEmail);
  }

  function tableCell(text, className) {
    return PTOUI.el("td", { class: className || null }, text || "-");
  }
  function stackedCell(primary, secondary, className) {
    return PTOUI.el("td", { class: className || null }, [
      PTOUI.el("div", { class: "primary-cell" }, primary || "-"),
      secondary ? PTOUI.el("div", { class: "muted-cell" }, secondary) : null,
    ]);
  }
  function rowFor(r) {
    var stateInfo = cancellationState(r);
    var f = r.fields || {};
    var action = PTOUI.el("td", { class: "action-cell" });
    if (stateInfo.eligible) {
      var button = PTOUI.el("button", { class: "btn danger", type: "button" }, stateInfo.label);
      button.addEventListener("click", function () { openCancelModal(r, button); });
      action.appendChild(button);
    } else if (isCancellationRequested(r.status)) {
      action.appendChild(PTOUI.el("span", { class: "ineligible" }, "Cancellation Requested"));
    } else {
      action.appendChild(PTOUI.el("span", { class: "ineligible" }, "-"));
    }

    return PTOUI.el("tr", null, [
      stackedCell(r.ptoType || "-", f.Reason || ""),
      tableCell(PTOUI.formatDateOnly(r.startDate)),
      tableCell(PTOUI.formatDateOnly(r.endDate || r.startDate)),
      tableCell(requestDuration(r)),
      PTOUI.el("td", null, PTOUI.statusBadge(r.status)),
      tableCell(approverSummary(f), "wrap-cell"),
      tableCell(backupSummary(f), "wrap-cell"),
      tableCell(submittedDate(r)),
      action,
    ]);
  }
  function tableFor(rows) {
    var thead = PTOUI.el("thead", null, PTOUI.el("tr", null, [
      PTOUI.el("th", null, "PTO Type"),
      PTOUI.el("th", null, "Start Date"),
      PTOUI.el("th", null, "End Date"),
      PTOUI.el("th", null, "Duration"),
      PTOUI.el("th", null, "Status"),
      PTOUI.el("th", null, "Approver"),
      PTOUI.el("th", null, "Backup Contact(s)"),
      PTOUI.el("th", null, "Submitted"),
      PTOUI.el("th", null, "Action"),
    ]));
    var tbody = PTOUI.el("tbody");
    rows.forEach(function (r) { tbody.appendChild(rowFor(r)); });
    return PTOUI.el("table", { class: "request-table" }, [thead, tbody]);
  }
  function renderBucket(container, emptyEl, countEl, rows) {
    container.innerHTML = "";
    if (rows.length) container.appendChild(tableFor(rows));
    container.style.display = rows.length ? "block" : "none";
    emptyEl.style.display = rows.length ? "none" : "block";
    setCount(countEl, rows.length);
  }

  function render() {
    var rows = state.all.filter(matchesSearch);
    var active = rows.filter(isActiveBucket).sort(sortActive);
    var past = rows.filter(function (r) { return !isActiveBucket(r); }).sort(sortPast);
    renderBucket(els.activeList, els.activeEmpty, els.activeCount, active);
    renderBucket(els.pastList, els.pastEmpty, els.pastCount, past);
  }

  function addInfo(list, label, value) {
    list.appendChild(PTOUI.el("div", null, [
      PTOUI.el("dt", null, label),
      PTOUI.el("dd", null, value || "-"),
    ]));
  }

  function openCancelModal(r, trigger) {
    state.activeItem = r;
    var f = r.fields || {};
    els.modalTitle.textContent = "Request Cancellation";
    els.modalSubtitle.textContent = (r.ptoType || "PTO") + " - " + PTOUI.formatRange(r.startDate, r.endDate);
    els.modalDetail.innerHTML = "";
    var section = PTOUI.el("section", { class: "modal-section" }, [
      PTOUI.el("h3", null, "Request Details"),
    ]);
    var list = PTOUI.el("dl", { class: "info-list" });
    addInfo(list, "Employee", personLine(f.RequesterName, f.RequesterEmail));
    addInfo(list, "PTO type", r.ptoType);
    addInfo(list, "Dates", PTOUI.formatRange(r.startDate, r.endDate));
    addInfo(list, "Duration", requestDuration(r));
    addInfo(list, "Status", "");
    list.lastChild.querySelector("dd").textContent = "";
    list.lastChild.querySelector("dd").appendChild(PTOUI.statusBadge(r.status));
    addInfo(list, "Approver", approverSummary(f));
    addInfo(list, "Backup contacts", backupSummary(f));
    section.appendChild(list);
    els.modalDetail.appendChild(section);
    els.cancelReason.value = "";
    if (!state.dialog) state.dialog = PTOUI.modal({ id: "cancel-modal" });
    state.dialog.open(trigger);
    window.setTimeout(function () { els.cancelReason.focus(); }, 0);
  }

  async function confirmCancellation() {
    if (!state.activeItem) return;
    var item = state.activeItem;
    var reason = String(els.cancelReason.value || "").trim();
    if (!reason) {
      showError("Enter a cancellation reason before submitting.");
      els.cancelReason.focus();
      return;
    }
    var stateInfo = cancellationState(item);
    if (!stateInfo.eligible) {
      showError("This request is no longer eligible for cancellation.");
      if (state.dialog) state.dialog.close();
      await loadRequests();
      return;
    }

    els.confirmCancel.disabled = true;
    var previousLabel = els.confirmCancel.textContent;
    els.confirmCancel.textContent = "Submitting...";
    clearError();
    showNotice(null);
    try {
      var result = await PTORequests.requestCancellation(item.id, {
        actor: state.me,
        reason: reason,
      });
      item.status = PTORules.STATUS_VALUES.CANCELLATION_REQUESTED;
      item.fields = Object.assign({}, item.fields, result.fields);
      if (state.dialog) state.dialog.close();
      showNotice("Your cancellation request was submitted successfully and is pending HR review.");
      render();
    } catch (e) {
      showError("Could not submit cancellation request: " + friendly(e));
    } finally {
      els.confirmCancel.disabled = false;
      els.confirmCancel.textContent = previousLabel;
    }
  }

  async function loadRequests() {
    clearError();
    showNotice(null);
    els.refresh.disabled = true;
    try {
      state.me = await PTODirectory.getMe();
      state.email = state.me.mail || state.me.userPrincipalName;
      if (!state.email) throw new Error("Could not determine your email from your profile.");
      var az = await PTOAuthz.enforce(state.me);
      if (!az.authorized) return;
      var result = await PTORequests.listMyRequests(state.email);
      state.all = result.items || [];
      if (result.warning) showNotice(result.warning);
      render();
    } catch (e) {
      state.all = [];
      render();
      showError("Could not load PTO requests: " + friendly(e));
    } finally {
      els.refresh.disabled = !PTOAuth.getAccount();
    }
  }

  function resetLocalState() {
    state.me = null;
    state.email = null;
    state.all = [];
    state.activeItem = null;
    render();
  }

  var AUTO_LOGIN_FLAG = "cancel_auto_login_attempted";
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

  if (els.search) els.search.addEventListener("input", render);
  els.refresh.addEventListener("click", loadRequests);
  els.confirmCancel.addEventListener("click", confirmCancellation);

  els.signin.addEventListener("click", async function () {
    clearError();
    try {
      await PTOAuth.signIn();
      clearAutoLoginFlag();
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
    resetLocalState();
    renderAuth();
  });

  (async function boot() {
    try {
      await PTOAuth.initialize();
      renderAuth();
      if (PTOAuth.getAccount()) {
        clearAutoLoginFlag();
        await loadRequests();
        return;
      }
      if (!autoLoginAttempted() && markAutoLoginAttempted()) {
        els.signin.disabled = true;
        els.account.textContent = "Redirecting to Microsoft sign-in...";
        els.account.classList.add("show-text");
        try {
          await PTOAuth.signInRedirect();
          return;
        } catch (e) {
          console.warn("[cancel.page] auto sign-in redirect failed:", friendly(e));
        }
      }
      renderAuth();
      els.account.textContent = "Not signed in - click Sign in to continue.";
      els.account.classList.add("show-text");
      render();
    } catch (e) {
      showError("Initialization failed: " + friendly(e));
    }
  })();
})();
