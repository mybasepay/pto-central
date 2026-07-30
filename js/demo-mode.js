/*
 * demo-mode.js — Opt-in synthetic adapter for local/demo review.
 * Activate with ?demo=1. Uses sessionStorage only and never calls Graph.
 */

(function () {
  "use strict";

  var FLAG = "pto.demo.active";
  var STORE = "pto.demo.requests.v1";
  var PERSONA = "pto.demo.persona";

  function hasDemoParam() {
    try { return new URLSearchParams(window.location.search).get("demo") === "1"; }
    catch (e) { return false; }
  }
  function isActive() {
    if (hasDemoParam()) {
      try { sessionStorage.setItem(FLAG, "1"); } catch (e) {}
      return true;
    }
    try { return sessionStorage.getItem(FLAG) === "1"; } catch (e) { return false; }
  }
  if (!isActive()) return;

  window.PTODemo = { active: true, persona: getPersona };
  document.documentElement.classList.add("demo-mode");

  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }
  function people() { return clone(window.PTODemoFixtures.people); }
  function emailOf(u) { return (u && (u.mail || u.userPrincipalName)) || ""; }
  function norm(s) { return String(s || "").trim().toLowerCase(); }
  function getPersona() {
    try { return sessionStorage.getItem(PERSONA) || "employee"; } catch (e) { return "employee"; }
  }
  function setPersona(role) {
    try { sessionStorage.setItem(PERSONA, role); } catch (e) {}
  }
  function personById(id) {
    return people().filter(function (p) { return p.id === id; })[0] || null;
  }
  function currentUser() {
    var role = getPersona();
    var id = role === "approver" ? PTODemoFixtures.approverUserId :
      role === "hr" ? PTODemoFixtures.hrUserId : PTODemoFixtures.currentUserId;
    return personById(id);
  }
  function loadRequests() {
    try {
      var raw = sessionStorage.getItem(STORE);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return clone(window.PTODemoFixtures.requests);
  }
  function saveRequests(items) {
    try { sessionStorage.setItem(STORE, JSON.stringify(items)); } catch (e) {}
  }
  function nextId(items) {
    return String(items.reduce(function (max, item) {
      return Math.max(max, Number(item.id) || 0);
    }, 9000) + 1);
  }
  function normalize(item) {
    var f = item.fields || {};
    var submittedAt = f.SubmittedAt || "";
    return {
      id: item.id,
      webUrl: item.webUrl,
      fields: f,
      requestKey: f.Title,
      ptoType: f.PtoType,
      startDate: f.StartDate,
      endDate: f.EndDate,
      status: f.Status,
      managerEmail: f.ManagerEmail,
      managerName: f.ManagerName,
      isShortNotice: f.IsShortNotice,
      isUrgent: f.IsUrgent,
      noticeDays: f.NoticeDays,
      submittedAt: submittedAt,
      requesterEmail: f.RequesterEmail,
      requesterName: f.RequesterName,
      _sortKey: submittedAt,
    };
  }
  function findUserByEmail(email) {
    var target = norm(email);
    return people().filter(function (p) {
      return norm(p.mail) === target || norm(p.userPrincipalName) === target;
    })[0] || null;
  }
  function matchesPerson(p, query) {
    var q = norm(query);
    return norm(p.displayName).indexOf(q) !== -1 ||
      norm(p.mail).indexOf(q) !== -1 ||
      norm(p.userPrincipalName).indexOf(q) !== -1;
  }
  function managerFor(user) {
    return user && user.managerId ? personById(user.managerId) : null;
  }
  function demoUrl(id) {
    return "pto-detail.html?demo=1&itemId=" + encodeURIComponent(id);
  }

  function rewriteDemoLinks() {
    Array.prototype.forEach.call(document.querySelectorAll("a[href]"), function (a) {
      var href = a.getAttribute("href");
      if (!href || href.indexOf("http") === 0 || href.indexOf("mailto:") === 0 || href.indexOf("#") === 0) return;
      if (!/\.html(?:[?#].*)?$/.test(href)) return;
      try {
        var url = new URL(href, window.location.href);
        url.searchParams.set("demo", "1");
        a.setAttribute("href", url.pathname.split("/").pop() + url.search + url.hash);
      } catch (e) {}
    });
  }

  function addBadge() {
    var badge = document.createElement("div");
    badge.className = "demo-indicator";
    badge.setAttribute("role", "status");
    badge.textContent = "Demo Environment — Synthetic Data";
    document.body.appendChild(badge);
  }

  function addPersonaSwitcher() {
    var auth = document.querySelector(".auth-area, .hr-auth");
    if (!auth) return;
    var label = document.createElement("label");
    label.className = "demo-persona";
    label.textContent = "View as";
    var select = document.createElement("select");
    select.id = "demo-persona";
    [
      ["employee", "Employee"],
      ["approver", "Approver"],
      ["hr", "HR Admin"],
      ["limited", "Limited employee"],
    ].forEach(function (entry) {
      var opt = document.createElement("option");
      opt.value = entry[0];
      opt.textContent = entry[1];
      select.appendChild(opt);
    });
    select.value = getPersona();
    select.addEventListener("change", function () {
      setPersona(select.value);
      window.location.reload();
    });
    label.appendChild(select);
    auth.insertBefore(label, auth.firstChild);
  }

  function overrideAuth() {
    window.PTOAuth = {
      initialize: async function () {},
      signIn: async function () { return this.getAccount(); },
      signInRedirect: async function () {},
      signOut: async function () {},
      getAccount: function () {
        var me = currentUser();
        return { username: me.mail, name: me.displayName, homeAccountId: me.id };
      },
      getToken: async function () { throw new Error("Demo mode does not use access tokens."); },
    };
  }

  function overrideDirectory() {
    window.PTODirectory = {
      getMe: async function () { return clone(currentUser()); },
      getMyManager: async function () { return clone(managerFor(currentUser())); },
      getUserManager: async function (id) { return clone(managerFor(personById(id))); },
      getManagerChainForUser: async function (id) {
        var manager = managerFor(personById(id));
        return { manager: clone(manager), managersManager: clone(managerFor(manager)) };
      },
      getUserByEmail: async function (email) { return clone(findUserByEmail(email)); },
      searchUsers: async function (query) {
        if (String(query || "").trim().length < 2) throw new Error("Type at least 2 characters to search.");
        return people().filter(function (p) { return matchesPerson(p, query); }).slice(0, 8);
      },
    };
  }

  function overrideAuthz() {
    window.PTOAuthz = {
      enforce: async function (me) { return { authorized: true, email: emailOf(me) }; },
      hasRole: async function () { return getPersona() === "hr"; },
      lookup: async function () { return { active: true, roles: getPersona() === "hr" ? ["HR"] : [] }; },
      AUTH_ONLY: ["request.html", "my-requests.html", "cancel.html", "approve.html", "pto-detail.html"],
      ROLE_REQUIRED: { "hr.html": ["HR", "Admin"] },
    };
  }

  function overrideRequests() {
    var real = window.PTORequests || {};
    window.PTORequests = {
      buildCreateRequestFields: real.buildCreateRequestFields,
      readSubmitMetadata: function (fields) {
        fields = fields || {};
        return {
          SubmittedById: fields.SubmittedById,
          SubmittedByEmail: fields.SubmittedByEmail,
          SubmittedByName: fields.SubmittedByName,
          OnBehalf: fields.OnBehalf,
          RequestMode: fields.RequestMode,
          OnBehalfReason: fields.OnBehalfReason,
          CopySubmitterOnConfirmation: fields.CopySubmitterOnConfirmation,
        };
      },
      readApproverMetadata: function (fields) {
        fields = fields || {};
        return {
          ApproverEmail: fields.ApproverEmail,
          ApproverName: fields.ApproverName,
          ApproverOverride: fields.ApproverOverride,
          ApproverOverrideReason: fields.ApproverOverrideReason,
          OriginalManagerEmail: fields.OriginalManagerEmail,
          OriginalManagerName: fields.OriginalManagerName,
        };
      },
      resolveMetadataFieldMap: async function () { return {}; },
      resolveApproverFieldMap: async function () { return {}; },
      createRequest: async function (fields) {
        var items = loadRequests();
        var id = nextId(items);
        var copyFields = clone(fields);
        copyFields.Title = copyFields.Title || ("DEMO-PTO-" + id);
        var item = { id: id, webUrl: demoUrl(id), fields: copyFields };
        items.unshift(item);
        saveRequests(items);
        try { sessionStorage.setItem("pto.demo.lastRequestId", id); } catch (e) {}
        return clone(item);
      },
      getRequest: async function (itemId) { return this.getRequestById(itemId); },
      getRequestById: async function (itemId) {
        var item = loadRequests().filter(function (r) { return String(r.id) === String(itemId); })[0];
        if (!item) throw new Error("Demo request not found: " + itemId);
        item.webUrl = demoUrl(item.id);
        return clone(item);
      },
      updateRequestDecision: async function (itemId, decision) {
        var items = loadRequests();
        var item = items.filter(function (r) { return String(r.id) === String(itemId); })[0];
        if (!item) throw new Error("Demo request not found: " + itemId);
        var actor = decision.actor || currentUser();
        var status = decision.status === "Rejected" ? "Rejected" : "Approved";
        var line = "[" + new Date().toISOString() + "] " + status + " by " +
          (actor.displayName || emailOf(actor)) + " — demo decision" +
          (decision.comment ? ": " + decision.comment : "");
        item.fields.Status = status;
        item.fields.DecisionById = actor.id || "";
        item.fields.DecisionByEmail = emailOf(actor);
        item.fields.DecisionByName = actor.displayName || emailOf(actor);
        item.fields.DecisionDate = new Date().toISOString();
        item.fields.DecisionComment = decision.comment || "";
        item.fields.AuditLog = (item.fields.AuditLog ? item.fields.AuditLog + "\n" : "") + line;
        saveRequests(items);
        return { fields: clone(item.fields), response: clone(item) };
      },
      listMyRequests: async function (email) {
        var target = norm(email);
        var items = loadRequests().map(normalize).filter(function (r) {
          return norm(r.requesterEmail) === target || norm(r.fields.SubmittedByEmail) === target;
        });
        items.sort(function (a, b) { return String(b._sortKey).localeCompare(String(a._sortKey)); });
        return { items: items, warning: null, usedFallback: false, raw: { demo: true, value: items } };
      },
      listAllRequests: async function () {
        var items = loadRequests().map(normalize);
        items.sort(function (a, b) { return String(b._sortKey).localeCompare(String(a._sortKey)); });
        return { items: items, truncated: false, pages: 1 };
      },
      cancelRequest: async function (itemId, opts) {
        var items = loadRequests();
        var item = items.filter(function (r) { return String(r.id) === String(itemId); })[0];
        if (!item) throw new Error("Demo request not found: " + itemId);
        var actor = (opts && opts.actor) || currentUser();
        item.fields.Status = "Cancelled";
        item.fields.AuditLog = (item.fields.AuditLog || "") + "\n[" + new Date().toISOString() +
          "] Cancelled by " + (actor.displayName || emailOf(actor)) + " — demo cancellation";
        saveRequests(items);
        return { fields: clone(item.fields), response: clone(item) };
      },
      requestCancellation: async function (itemId, opts) {
        var items = loadRequests();
        var item = items.filter(function (r) { return String(r.id) === String(itemId); })[0];
        if (!item) throw new Error("Demo request not found: " + itemId);
        var status = item.fields.Status;
        if (!PTORules.isEmployeeCancellationEligible(status)) {
          throw new Error("This request is not eligible for employee cancellation.");
        }
        item.fields.StatusBeforeCancellationRequest = status;
        item.fields.Status = "Cancellation Requested";
        item.fields.CancellationRequestedAt = new Date().toISOString();
        item.fields.CancellationRequestReason = (opts && opts.reason) || "";
        item.fields.AuditLog = (item.fields.AuditLog || "") + "\n[" + new Date().toISOString() +
          "] Cancellation Requested by " + (currentUser().displayName || emailOf(currentUser())) +
          " — demo employee cancellation request";
        saveRequests(items);
        return { fields: clone(item.fields), response: clone(item) };
      },
      completeCancellationRequest: async function (itemId, opts) {
        var items = loadRequests();
        var item = items.filter(function (r) { return String(r.id) === String(itemId); })[0];
        if (!item) throw new Error("Demo request not found: " + itemId);
        if (item.fields.Status !== "Cancellation Requested") throw new Error("This request is not awaiting cancellation review.");
        var actor = (opts && opts.actor) || currentUser();
        item.fields.Status = "Cancelled";
        item.fields.HrActionType = "Completed Cancellation";
        item.fields.CancelledAt = new Date().toISOString();
        item.fields.CancelledByEmail = emailOf(actor);
        item.fields.CancelledByName = actor.displayName || emailOf(actor);
        item.fields.AuditLog = (item.fields.AuditLog || "") + "\n[" + new Date().toISOString() +
          "] Completed Cancellation by " + (actor.displayName || emailOf(actor)) + " — demo HR action";
        saveRequests(items);
        return { fields: clone(item.fields), response: clone(item) };
      },
      declineCancellationRequest: async function (itemId, opts) {
        var items = loadRequests();
        var item = items.filter(function (r) { return String(r.id) === String(itemId); })[0];
        if (!item) throw new Error("Demo request not found: " + itemId);
        if (item.fields.Status !== "Cancellation Requested") throw new Error("This request is not awaiting cancellation review.");
        var actor = (opts && opts.actor) || currentUser();
        item.fields.Status = item.fields.StatusBeforeCancellationRequest || "Approved";
        item.fields.HrActionType = "Declined Cancellation Request";
        item.fields.HrCancellationNote = (opts && opts.note) || "";
        item.fields.AuditLog = (item.fields.AuditLog || "") + "\n[" + new Date().toISOString() +
          "] Declined Cancellation Request by " + (actor.displayName || emailOf(actor)) +
          (item.fields.HrCancellationNote ? " — " + item.fields.HrCancellationNote : " — demo HR action");
        saveRequests(items);
        return { fields: clone(item.fields), response: clone(item) };
      },
      CANCELLABLE_STATUSES: ["Pending", "Approved", "Auto-Approved", "Auto-Approved (Escalation)"],
    };
  }

  overrideAuth();
  overrideDirectory();
  overrideAuthz();
  overrideRequests();

  document.addEventListener("DOMContentLoaded", function () {
    addBadge();
    addPersonaSwitcher();
    rewriteDemoLinks();
  });
})();
