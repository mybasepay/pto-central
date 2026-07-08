/*
 * graph.js — Thin Microsoft Graph client wrapper. Namespace: window.PTOGraph
 *
 * Responsibility (per PTO_CENTRAL_ARCHITECTURE.md §5, §7):
 *   The ONLY module that talks to https://graph.microsoft.com directly.
 *   Acquires a token via PTOAuth, attaches headers, calls Graph, and returns
 *   parsed JSON (or throws a readable error). Domain modules call THIS, never
 *   fetch() Graph themselves.
 *
 * Dependency direction (§7): graph.js → auth.js → config.js (window.PTOConfig).
 *
 * Phase 1A: GET /me smoke test.
 * Phase 1B: SharePoint site/list/column discovery (GET).
 * Phase 1D: POST + PATCH for SharePoint list item create/read-back (dev test).
 * DELETE is added later (cancellation/cleanup).
 */

window.PTOGraph = (function () {
  "use strict";

  /** Resolve a relative Graph path against PTOConfig.graph.baseUrl. */
  function buildUrl(url) {
    if (/^https?:\/\//i.test(url)) return url; // already absolute
    var base = ((PTOConfig.graph && PTOConfig.graph.baseUrl) || "").replace(/\/+$/, "");
    return base + (url.charAt(0) === "/" ? url : "/" + url);
  }

  /**
   * Core HTTP request to Graph. Supports GET, POST, PATCH.
   * @param {string} method - "GET" | "POST" | "PATCH"
   * @param {string} url - relative path (e.g. "/me") or absolute Graph URL
   * @param {object} [options] - { scopes: string[], headers: object, body: any }
   * @returns {Promise<any>} parsed JSON (or text; null for 204 No Content)
   */
  async function request(method, url, options) {
    options = options || {};
    var verb = String(method || "GET").toUpperCase();

    if (verb !== "GET" && verb !== "POST" && verb !== "PATCH") {
      throw new Error(
        "PTOGraph supports GET, POST, PATCH. '" + verb + "' is not implemented."
      );
    }

    var scopes = options.scopes && options.scopes.length ? options.scopes : PTOConfig.scopes.graphMe;
    var token = await PTOAuth.getToken(scopes);

    var headers = Object.assign(
      {
        Authorization: "Bearer " + token,
        Accept: "application/json",
      },
      options.headers || {}
    );

    var fetchOpts = { method: verb, headers: headers };

    // Attach a JSON body for POST/PATCH when provided.
    var hasBody =
      (verb === "POST" || verb === "PATCH") &&
      options.body !== undefined &&
      options.body !== null;
    if (hasBody) {
      headers["Content-Type"] = "application/json";
      fetchOpts.body =
        typeof options.body === "string" ? options.body : JSON.stringify(options.body);
    }

    var response;
    try {
      response = await fetch(buildUrl(url), fetchOpts);
    } catch (networkErr) {
      throw new Error("Network error calling Graph: " + (networkErr && networkErr.message));
    }

    // Parse body (Graph errors are JSON with an "error.message").
    var raw = await response.text();
    var body = null;
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch (_) {
        body = raw; // non-JSON response
      }
    }

    if (!response.ok) {
      var detail =
        body && body.error && body.error.message
          ? body.error.message
          : typeof body === "string" && body
          ? body
          : response.statusText || "Unknown error";
      // Log the exact failing endpoint/method/status so we can pinpoint WHICH
      // Graph call was denied (e.g. POST .../items vs GET .../columns) without
      // showing raw internals to the user. Callers map .status to friendly copy.
      console.error(
        "[PTOGraph] " + verb + " " + url + " → HTTP " + response.status + " · " + detail
      );
      var err = new Error("Graph " + response.status + ": " + detail);
      err.status = response.status;          // e.g. 403
      err.graphMethod = verb;                // GET | POST | PATCH
      err.graphUrl = url;                     // relative path or absolute nextLink
      err.graphErrorCode = (body && body.error && body.error.code) || null; // e.g. "accessDenied"
      throw err;
    }

    return body;
  }

  /**
   * GET a Graph resource.
   * @param {string} url - relative path or absolute URL
   * @param {string[]} [scopes] - token scopes (defaults to PTOConfig.scopes.graphMe)
   */
  async function get(url, scopes) {
    return request("GET", url, { scopes: scopes });
  }

  /**
   * POST a JSON body to a Graph resource.
   * @param {string} url
   * @param {any} body - serialized to JSON
   * @param {string[]} [scopes]
   */
  async function post(url, body, scopes) {
    return request("POST", url, { body: body, scopes: scopes });
  }

  /**
   * PATCH a Graph resource with a JSON body. (Low-risk; not used by the Phase 1D
   * page, which only creates + reads back, but available for later phases.)
   * @param {string} url
   * @param {any} body
   * @param {string[]} [scopes]
   */
  async function patch(url, body, scopes) {
    return request("PATCH", url, { body: body, scopes: scopes });
  }

  /** Convenience: GET the signed-in user's basic profile. */
  async function getMe() {
    return get(
      "/me?$select=id,displayName,mail,userPrincipalName,jobTitle,department",
      PTOConfig.scopes.graphMe
    );
  }

  // --- SharePoint discovery (Phase 1B) -------------------------------------
  // All use the siteRead scope (User.Read + Sites.Read.All). A 403 here almost
  // always means Sites.Read.All is missing or not admin-consented.

  function requireSharePointConfig() {
    var sp = PTOConfig.sharePoint;
    if (!sp || !sp.hostname || !sp.sitePath || !sp.listName) {
      throw new Error(
        "PTOConfig.sharePoint is incomplete — need hostname, sitePath, and listName in js/config.js."
      );
    }
    return sp;
  }

  /**
   * Resolve the configured SharePoint site.
   * Graph: GET /sites/{hostname}:{sitePath}
   * @returns {Promise<object>} site resource (id, displayName, webUrl, ...)
   */
  async function getSiteByPath() {
    var sp = requireSharePointConfig();
    // Colon-addressing: /sites/{hostname}:/sites/{site} (sitePath already
    // begins with "/sites/...").
    var path = "/sites/" + sp.hostname + ":" + sp.sitePath;
    return get(path, PTOConfig.scopes.siteRead);
  }

  /**
   * List the configured site's lists.
   * Graph: GET /sites/{siteId}/lists
   * @param {string} [siteId] - optional; resolved via getSiteByPath() if omitted.
   * @returns {Promise<object>} collection ({ value: [...] })
   */
  async function getListsForConfiguredSite(siteId) {
    if (!siteId) {
      var site = await getSiteByPath();
      siteId = site.id;
    }
    return get(
      "/sites/" + siteId + "/lists?$select=id,name,displayName,webUrl",
      PTOConfig.scopes.siteRead
    );
  }

  /**
   * Find the list whose displayName === PTOConfig.sharePoint.listName.
   * @param {string} [siteId] - optional; resolved if omitted.
   * @returns {Promise<{siteId: string, list: object}>}
   */
  async function getConfiguredList(siteId) {
    var sp = requireSharePointConfig();
    if (!siteId) {
      var site = await getSiteByPath();
      siteId = site.id;
    }
    var lists = await getListsForConfiguredSite(siteId);
    var items = (lists && lists.value) || [];
    var match = items.filter(function (l) {
      return l.displayName === sp.listName;
    })[0];
    if (!match) {
      var names = items
        .map(function (l) {
          return l.displayName;
        })
        .join(", ");
      throw new Error(
        'SharePoint list "' + sp.listName + '" not found on the site. Lists found: ' + (names || "(none)")
      );
    }
    return { siteId: siteId, list: match };
  }

  /**
   * Read a list's columns.
   * Graph: GET /sites/{siteId}/lists/{listId}/columns
   * @returns {Promise<object>} collection ({ value: [...] })
   */
  async function getListColumns(siteId, listId) {
    if (!siteId || !listId) {
      throw new Error("getListColumns requires both siteId and listId.");
    }
    var path = "/sites/" + siteId + "/lists/" + listId + "/columns";
    console.log("[PTOGraph] getListColumns → GET", buildUrl(path));
    var res = await get(path, PTOConfig.scopes.siteRead);
    var count = res && res.value ? res.value.length : 0;
    console.log("[PTOGraph] getListColumns ← columns returned:", count);
    return res;
  }

  // --- List item read/write (Phase 1D) -------------------------------------
  // Cache the resolved site/list context so item operations don't re-discover
  // on every call. createListItem needs the siteWrite scope (Sites.ReadWrite.All).

  var _ctx = { siteId: null, listId: null };

  /**
   * Resolve and cache { siteId, listId } for the configured PTO Requests list.
   * @param {boolean} [force] - re-resolve even if cached.
   */
  async function resolveContext(force) {
    if (!force && _ctx.siteId && _ctx.listId) return _ctx;
    var r = await getConfiguredList(_ctx.siteId);
    _ctx.siteId = r.siteId;
    _ctx.listId = r.list.id;
    console.log("[PTOGraph] resolveContext → siteId:", _ctx.siteId, "listId:", _ctx.listId);
    return _ctx;
  }

  /** The currently cached { siteId, listId } (may be nulls until resolved). */
  function getContext() {
    return { siteId: _ctx.siteId, listId: _ctx.listId };
  }

  /**
   * Create a list item.
   * Graph: POST /sites/{siteId}/lists/{listId}/items   body: { fields: {...} }
   * @param {object} fields - SharePoint field internal-name → value map.
   * @returns {Promise<object>} the created item (includes id; expand fields on read-back).
   */
  async function createListItem(fields) {
    var ctx = await resolveContext();
    var path = "/sites/" + ctx.siteId + "/lists/" + ctx.listId + "/items";
    console.log("[PTOGraph] createListItem → POST", buildUrl(path), fields);
    var res = await post(path, { fields: fields }, PTOConfig.scopes.siteWrite);
    console.log("[PTOGraph] createListItem ← id:", res && res.id);
    return res;
  }

  /**
   * Read a single list item, expanding its fields.
   * Graph: GET /sites/{siteId}/lists/{listId}/items/{itemId}?$expand=fields
   * (Uses $expand — the canonical OData option — to ensure fields are returned.)
   * @param {string|number} itemId
   * @returns {Promise<object>} the item with .fields populated.
   */
  async function getListItem(itemId) {
    if (itemId === undefined || itemId === null || itemId === "") {
      throw new Error("getListItem requires an itemId.");
    }
    var ctx = await resolveContext();
    var path =
      "/sites/" + ctx.siteId + "/lists/" + ctx.listId + "/items/" + itemId + "?$expand=fields";
    console.log("[PTOGraph] getListItem → GET", buildUrl(path));
    return get(path, PTOConfig.scopes.siteRead);
  }

  /**
   * Update a list item's fields (partial PATCH).
   * Graph: PATCH /sites/{siteId}/lists/{listId}/items/{itemId}/fields
   *   body = a flat map of field internal-name → value (no { fields: ... } wrap
   *   on the /fields endpoint). Only the supplied fields are changed.
   * @param {string|number} itemId
   * @param {object} fields - field internal-name → value map
   * @returns {Promise<object>} the updated fieldValueSet
   */
  async function updateListItem(itemId, fields) {
    if (itemId === undefined || itemId === null || itemId === "") {
      throw new Error("updateListItem requires an itemId.");
    }
    var ctx = await resolveContext();
    var path = "/sites/" + ctx.siteId + "/lists/" + ctx.listId + "/items/" + itemId + "/fields";
    console.log("[PTOGraph] updateListItem → PATCH", buildUrl(path), fields);
    var res = await patch(path, fields, PTOConfig.scopes.siteWrite);
    console.log("[PTOGraph] updateListItem ← ok");
    return res;
  }

  return {
    request: request,
    get: get,
    post: post,
    patch: patch,
    getMe: getMe,
    // SharePoint discovery
    getSiteByPath: getSiteByPath,
    getListsForConfiguredSite: getListsForConfiguredSite,
    getConfiguredList: getConfiguredList,
    getListColumns: getListColumns,
    // List item read/write
    resolveContext: resolveContext,
    getContext: getContext,
    createListItem: createListItem,
    getListItem: getListItem,
    updateListItem: updateListItem,
  };
})();
