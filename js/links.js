/*
 * links.js — In-app deep-link builder. Namespace: window.PTOLinks
 *
 * Responsibility (per PTO_CENTRAL_ARCHITECTURE.md §7 — one module, one job):
 *   Build URLs that point at PTO Central's own pages. Right now that's the
 *   manager approval link for a SharePoint request item. This is a navigation /
 *   presentation concern — NOT data access and NOT business logic — so it lives
 *   on its own instead of in requests.js (which is the SharePoint field-mapping
 *   layer and must not grow page-name knowledge) or ui.js (DOM helpers with no
 *   app-specific page names).
 *
 *   Dependency direction (§7): depends on nothing app-specific. Pure string work
 *   plus an optional read of window.location for the absolute form. Pages call
 *   PTOLinks; PTOLinks calls nobody.
 *
 * Phase 3B scope: LINK GENERATION ONLY. No Teams send, no email send, no signed
 * links, no calendar/OOO, no HR dashboard. The approval page itself (approve.html)
 * and its decision logic are unchanged.
 *
 * Hash format is deliberate: Phase 3A confirmed `approve.html#itemId=<ID>` is the
 * dependable local format. A static dev server with clean URLs (e.g. `npx serve`)
 * can drop a `?itemId=` query string on a redirect before any JS runs; the hash
 * is never sent to the server, so it always survives. Production Teams/email
 * links should keep using the hash form unless the final host is confirmed to
 * preserve query strings.
 */

window.PTOLinks = (function () {
  "use strict";

  var APPROVE_PAGE = "approve.html";

  /** Coerce + validate an item id; throws on a missing/blank id. */
  function requireItemId(itemId) {
    if (itemId === null || itemId === undefined || String(itemId).trim() === "") {
      throw new Error("PTOLinks: an itemId is required to build an approval link.");
    }
    return String(itemId).trim();
  }

  /**
   * Relative approval URL using the confirmed hash format.
   * @param {string|number} itemId
   * @returns {string} e.g. "approve.html#itemId=7"
   */
  function relativeApprovalUrl(itemId) {
    var id = requireItemId(itemId);
    return APPROVE_PAGE + "#itemId=" + encodeURIComponent(id);
  }

  /**
   * Absolute approval URL based on the current origin + directory (or a supplied
   * base). Resolved with the URL API so it works at localhost, under a subpath,
   * or anywhere the relative page would resolve. Falls back to the relative form
   * if no usable base is available (e.g. exotic origins).
   * @param {string|number} itemId
   * @param {string} [baseHref] - base to resolve against; defaults to the current document URL.
   * @returns {string} e.g. "http://localhost:3000/approve.html#itemId=7"
   */
  function absoluteApprovalUrl(itemId, baseHref) {
    var rel = relativeApprovalUrl(itemId);
    var base = baseHref || (typeof window !== "undefined" && window.location && window.location.href) || "";
    if (!base) return rel;
    try {
      return new URL(rel, base).href;
    } catch (e) {
      return rel; // never throw on the absolute form — relative is always valid
    }
  }

  /**
   * Convenience: both forms in one call.
   * @param {string|number} itemId
   * @returns {{relative: string, absolute: string}}
   */
  function approvalUrls(itemId) {
    return { relative: relativeApprovalUrl(itemId), absolute: absoluteApprovalUrl(itemId) };
  }

  return {
    relativeApprovalUrl: relativeApprovalUrl,
    absoluteApprovalUrl: absoluteApprovalUrl,
    approvalUrls: approvalUrls,
  };
})();
