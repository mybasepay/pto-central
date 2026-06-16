/*
 * authz.js — Minimal page authorization layer. Namespace: window.PTOAuthz
 *
 * MODEL (definitive):
 *   - PTO Authorized Users (SharePoint) holds ONLY Admin / HR / exceptions.
 *     It is NOT a roster of every employee/manager.
 *   - Auth-only pages (request.html, my-requests.html, approve.html):
 *       any authenticated myBasePay account is allowed — NO list row required.
 *   - approve.html ACTIONS (approve/reject) are additionally gated in
 *     approve.page.js: allowed if the user is the request's Manager Email OR has
 *     HR/Admin role (PTOAuthz.hasRole). The page itself only needs auth to view.
 *   - Role-gated pages (hr.html, future): REQUIRE an HR/Admin row in the list.
 *
 * IMPORTANT: this is NOT a security boundary. It runs client-side. The real
 * boundary remains SharePoint list permissions + Entra delegated-scope consent
 * (and the single-tenant authority, which only lets org accounts sign in).
 *
 * Dependency direction (per PTO_CENTRAL_ARCHITECTURE.md §7):
 *   authz.js → graph.js → auth.js → config.js. Uses ONLY methods already
 *   exposed by PTOGraph, so graph.js is untouched.
 */
window.PTOAuthz = (function () {
  "use strict";

  // Pages that only require an authenticated myBasePay account (no list row).
  var AUTH_ONLY = ["request.html", "my-requests.html", "approve.html"];
  // Pages that REQUIRE a role row in PTO Authorized Users.
  var ROLE_REQUIRED = { "hr.html": ["HR", "Admin"] };
  // Email domains treated as internal myBasePay accounts.
  var ALLOWED_DOMAINS = ["mybasepay.com"];

  var LIST_NAME =
    (PTOConfig.sharePoint && PTOConfig.sharePoint.authzListName) || "PTO Authorized Users";

  function currentPage() {
    return (window.location.pathname.split("/").pop() || "index.html").toLowerCase();
  }
  function norm(s) { return String(s || "").trim().toLowerCase(); }
  function truthy(v) { return v === true || v === "Yes" || v === "yes" || v === 1; }
  function emailOf(me) { return me && (me.mail || me.userPrincipalName); }

  // An authenticated account whose email domain is a myBasePay domain.
  function isOrgUser(me) {
    var e = norm(emailOf(me));
    if (!e || e.indexOf("@") === -1) return false;
    var domain = e.split("@").pop();
    return ALLOWED_DOMAINS.indexOf(domain) !== -1;
  }

  // Resolve the authorization list id on the configured site (cached per load).
  var _ctx = { siteId: null, listId: null };
  async function resolveList() {
    if (_ctx.siteId && _ctx.listId) return _ctx;
    var site = await PTOGraph.getSiteByPath();
    var lists = await PTOGraph.getListsForConfiguredSite(site.id);
    var match = ((lists && lists.value) || []).filter(function (l) {
      return l.displayName === LIST_NAME;
    })[0];
    if (!match) {
      throw new Error('Authorization list "' + LIST_NAME + '" not found on the site.');
    }
    _ctx.siteId = site.id;
    _ctx.listId = match.id;
    return _ctx;
  }

  /**
   * Aggregate all ACTIVE roles for an email across rows.
   * Primary: server-side $filter on fields/Email (with the Prefer header so it
   * degrades rather than hard-fails). Fallback: read recent items and filter
   * client-side — mirrors PTORequests.listMyRequests.
   * @returns {Promise<{active: boolean, roles: string[]}>}
   */
  async function lookup(email) {
    var target = norm(email);
    if (!target) return { active: false, roles: [] };

    var ctx = await resolveList();
    var base = "/sites/" + ctx.siteId + "/lists/" + ctx.listId + "/items?$expand=fields";
    var filter = "fields/Email eq '" + target.replace(/'/g, "''") + "'";
    var filteredUrl = base + "&$filter=" + filter.replace(/ /g, "%20").replace(/'/g, "%27");

    var rows;
    try {
      var raw = await PTOGraph.request("GET", filteredUrl, {
        scopes: PTOConfig.scopes.siteRead,
        headers: { Prefer: "HonorNonIndexedQueriesWarningMayFailRandomly" },
      });
      rows = (raw && raw.value) || [];
    } catch (e) {
      var raw2 = await PTOGraph.request("GET", base + "&$top=500", {
        scopes: PTOConfig.scopes.siteRead,
      });
      rows = ((raw2 && raw2.value) || []).filter(function (it) {
        return norm(it.fields && it.fields.Email) === target;
      });
    }

    var active = false;
    var roles = [];
    rows.forEach(function (it) {
      var f = it.fields || {};
      if (norm(f.Email) !== target) return; // defensive (filter degradation)
      if (truthy(f.Active)) {
        active = true;
        if (f.Role) roles.push(String(f.Role));
      }
    });
    return { active: active, roles: roles };
  }

  /**
   * Does this email have one of `allowed` roles (active) in the list?
   * FAILS CLOSED (returns false) on any lookup error — used for role elevation.
   * @param {string} email
   * @param {string[]} allowed
   * @returns {Promise<boolean>}
   */
  async function hasRole(email, allowed) {
    try {
      var info = await lookup(email);
      return info.active && info.roles.some(function (r) { return allowed.indexOf(r) !== -1; });
    } catch (e) {
      return false;
    }
  }

  /**
   * Enforce PAGE access for the signed-in user. On failure it BLOCKS the UI and
   * returns { authorized:false }. Call AFTER getMe(), BEFORE loading data.
   *   - AUTH_ONLY pages: authorized if an org (myBasePay) account is signed in.
   *   - ROLE_REQUIRED pages: authorized only if HR/Admin in the list (fail-closed).
   * @param {object} me - Graph profile from PTODirectory.getMe()
   * @returns {Promise<{authorized: boolean, email: string}>}
   */
  async function enforce(me) {
    var email = emailOf(me);
    var page = currentPage();

    if (ROLE_REQUIRED[page]) {
      var allowed = ROLE_REQUIRED[page];
      if (await hasRole(email, allowed)) return { authorized: true, email: email };
      block("Not authorized. This page requires " + allowed.join("/") +
            " rights. Contact pto-approvals@mybasepay.com.");
      return { authorized: false, email: email };
    }

    if (AUTH_ONLY.indexOf(page) !== -1) {
      if (isOrgUser(me)) return { authorized: true, email: email };
      block("Not authorized. Please sign in with your myBasePay (@mybasepay.com) account.");
      return { authorized: false, email: email };
    }

    // Unknown page that opted into enforce() → fail closed.
    block("Not authorized for this page.");
    return { authorized: false, email: email };
  }

  // Visually lock the page: red banner + disable every control except sign in/out.
  function block(message) {
    var main = document.querySelector("main") || document.body;
    Array.prototype.forEach.call(
      main.querySelectorAll("button, input, select, textarea"),
      function (c) { if (c.id !== "signin" && c.id !== "signout") c.disabled = true; }
    );

    var existing = document.getElementById("authz-block");
    if (existing) { existing.textContent = message; return; }

    var b = document.createElement("div");
    b.id = "authz-block";
    b.setAttribute("role", "alert");
    b.textContent = message;
    Object.assign(b.style, {
      margin: "14px 0", padding: "14px 16px", borderRadius: "12px",
      background: "#2a0d0d", border: "1px solid #b91c1c", color: "#fecaca",
      fontWeight: "700", fontSize: "14px",
    });
    var card = document.querySelector(".card") || main;
    var header = card.querySelector("header");
    card.insertBefore(b, header && header.nextSibling ? header.nextSibling : card.firstChild);
  }

  return {
    enforce: enforce,
    hasRole: hasRole,
    lookup: lookup,
    AUTH_ONLY: AUTH_ONLY,
    ROLE_REQUIRED: ROLE_REQUIRED,
  };
})();
