/*
 * detail.page.js — Read-only PTO detail page.
 */

(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var state = { itemId: null, me: null };
  var els = {
    signin: $("signin"), signout: $("signout"), account: $("account"),
    userChip: $("user-chip"), userChipName: $("user-chip-name"), userChipAvatar: $("user-chip-avatar"),
    error: $("error"),
  };

  var yearEl = $("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  function friendly(e) { return (e && (e.message || e.errorMessage)) || String(e); }
  function showError(msg) { els.error.textContent = msg; els.error.style.display = "block"; }
  function clearError() { els.error.textContent = ""; els.error.style.display = "none"; }
  function initialsOf(name) {
    var parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "··";
    return ((parts[0] || " ")[0] + (parts[parts.length - 1] || " ")[0]).toUpperCase();
  }
  function itemIdFromUrl() {
    var q = new URLSearchParams(window.location.search).get("itemId");
    if (q) return q;
    var h = window.location.hash.replace(/^#/, "").replace(/^\?/, "");
    return new URLSearchParams(h).get("itemId");
  }
  function renderAuth() {
    var acct = PTOAuth.getAccount();
    var signedIn = !!acct;
    els.signin.disabled = signedIn;
    els.signin.style.display = signedIn ? "none" : "";
    els.signout.disabled = !signedIn;
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
  function daysInclusive(start, end) {
    var s = new Date(start + "T00:00:00");
    var e = new Date((end || start) + "T00:00:00");
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return "—";
    var days = Math.round((e - s) / 86400000) + 1;
    return days + " day" + (days === 1 ? "" : "s");
  }
  function setText(id, value) { PTOUI.setText(id, value); }
  function render(item) {
    var f = item.fields || {};
    document.title = (f.Title || "PTO Request") + " — PTO Central";
    setText("detail-title", "PTO Request");
    var status = $("d-status");
    status.textContent = "";
    status.appendChild(PTOUI.statusBadge(f.Status));
    setText("d-requester", f.RequesterName);
    setText("d-requester-email", f.RequesterEmail);
    setText("d-type", f.PtoType);
    setText("d-dates", PTOUI.formatRange(f.StartDate, f.EndDate));
    setText("d-duration", daysInclusive(f.StartDate, f.EndDate));
    setText("d-submitted", f.SubmittedAt ? new Date(f.SubmittedAt).toLocaleString() : "—");
    setText("d-manager", ((f.ManagerName || "") + (f.ManagerEmail ? " <" + f.ManagerEmail + ">" : "")).trim());
    setText("d-approver", ((f.ApproverName || "") + (f.ApproverEmail ? " <" + f.ApproverEmail + ">" : "")).trim());
    setText("d-backup", ((f.BackupContactName || "") + (f.BackupContactEmail ? " <" + f.BackupContactEmail + ">" : "")).trim());
    setText("d-notice", (f.IsShortNotice ? "Short notice · " : "") + ((f.NoticeDays === undefined || f.NoticeDays === null) ? "—" : f.NoticeDays + " day(s)"));
    setText("d-reason", f.Reason);
  }

  async function load() {
    clearError();
    state.itemId = itemIdFromUrl();
    if (!state.itemId) { showError("No itemId in the URL. Open as pto-detail.html?itemId=9001."); return; }
    try {
      state.me = await PTODirectory.getMe();
      var az = await PTOAuthz.enforce(state.me);
      if (!az.authorized) return;
      render(await PTORequests.getRequestById(state.itemId));
    } catch (e) {
      showError("Could not load request detail: " + friendly(e));
    }
  }

  els.signin.addEventListener("click", async function () { await PTOAuth.signIn(); renderAuth(); await load(); });
  els.signout.addEventListener("click", async function () { await PTOAuth.signOut(); renderAuth(); });

  (async function boot() {
    try {
      await PTOAuth.initialize();
      renderAuth();
      if (!PTOAuth.getAccount()) await PTOAuth.signInRedirect();
      else await load();
    } catch (e) {
      showError("Initialization failed: " + friendly(e));
    }
  })();
})();
