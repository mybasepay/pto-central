/*
 * config.js — Central configuration for PTO Central. Namespace: window.PTOConfig
 *
 * Responsibility (per PTO_CENTRAL_ARCHITECTURE.md §6, §7):
 *   The single place that holds environment/tenant constants. Other modules
 *   (auth.js, graph.js) read from here — no magic strings elsewhere.
 *
 * These are PUBLIC identifiers for a Single-Page Application using MSAL
 * Authorization Code flow + PKCE. There is NO client secret in a SPA — do not
 * add one here or anywhere client-side.
 *
 * Phase 1A: real Entra app registration values for the /me smoke test, scopes
 * limited to User.Read. Broader app scopes + SharePoint/HR/flow constants are
 * (re)introduced per phase; they live in the architecture + provisioning docs
 * until the phase that needs them.
 */

window.PTOConfig = {
  tenantId: "e1a27c94-fb0c-4728-b71d-3766f21a3acb",
  clientId: "7ccca5f6-d9be-4a17-b09e-8af2db1a48f1",

  auth: {
    authority: "https://login.microsoftonline.com/e1a27c94-fb0c-4728-b71d-3766f21a3acb",
    // Dynamic redirect: each page registers itself as its own redirect URI.
    // Works identically on localhost (dev) and GitHub Pages (prod) with no edits.
    // pathname excludes the hash, so approve.html#itemId=20 → .../approve.html
    // Each page URL must be registered as a SPA redirect URI in Entra.
    redirectUri: window.location.origin + window.location.pathname,
  },

  graph: {
    baseUrl: "https://graph.microsoft.com/v1.0",
  },

  // --- SharePoint List "PTO Requests" (source of truth) ---
  // Phase 1B: confirmed site + list for discovery. The PTO request CRUD
  // (Phase 1C+) resolves siteId/listId at runtime from these values.
  sharePoint: {
    hostname: "mybasepaycom.sharepoint.com",
    sitePath: "/sites/InformationTechnology",
    listName: "PTO Requests",
    // Phase 3B-authz: minimal role gate (js/authz.js) reads this list.
    authzListName: "PTO Authorized Users",
    appFolderPath: "/Shared Documents/General/PTO Central",
  },

  scopes: {
    login: ["User.Read"],
    graphMe: ["User.Read"],
    // SharePoint site/list discovery (Phase 1B). Requires Microsoft Graph
    // delegated Sites.Read.All + admin consent.
    siteRead: ["User.Read", "Sites.Read.All"],
    // SharePoint list item create/update (Phase 1D). Requires Microsoft Graph
    // delegated Sites.ReadWrite.All + admin consent.
    siteWrite: ["User.Read", "Sites.ReadWrite.All"],
    // Directory reads — other users' manager chain (Phase 2A). Requires
    // Microsoft Graph delegated User.Read.All + admin consent. (Reading your
    // OWN manager via /me/manager only needs User.Read / graphMe.)
    directoryRead: ["User.Read", "User.Read.All"],
  },
};
