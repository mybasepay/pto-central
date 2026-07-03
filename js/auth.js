/*
 * auth.js — Authentication (MSAL.js) wrapper. Namespace: window.PTOAuth
 *
 * Responsibility (per PTO_CENTRAL_ARCHITECTURE.md §6, §7):
 *   - Owns the single shared MSAL PublicClientApplication instance.
 *   - initialize(): build the instance, handle any redirect, set active account.
 *   - signIn() / signOut() / getAccount().
 *   - getToken(scopes): silent-first, popup fallback.
 *
 * Dependency direction (§7): auth.js → config.js (window.PTOConfig). Requires
 * the MSAL browser library (window.msal) to be loaded BEFORE this file.
 *
 * Phase 1A: implemented for the /me smoke test. Uses popup flow (simplest
 * for a static dev page). HR-group gating and page guards come later.
 */

window.PTOAuth = (function () {
  "use strict";

  var msalInstance = null;
  var initialized = false;

  /** Friendly guard: config must be filled in before we can auth. */
  function assertConfigured() {
    var cfg = window.PTOConfig;
    if (
      !cfg ||
      !cfg.clientId ||
      cfg.clientId.indexOf("<") === 0 ||
      !cfg.tenantId ||
      cfg.tenantId.indexOf("<") === 0 ||
      !cfg.auth ||
      !cfg.auth.authority ||
      cfg.auth.authority.indexOf("<") !== -1
    ) {
      throw new Error(
        "Config not set: fill in clientId, tenantId, and auth.authority in js/config.js " +
          "(replace any <PLACEHOLDER> values with the real Entra app GUIDs)."
      );
    }
  }

  function buildMsalConfig() {
    return {
      auth: {
        clientId: PTOConfig.clientId,
        authority: PTOConfig.auth.authority,
        redirectUri: PTOConfig.auth.redirectUri,
      },
      cache: {
        // sessionStorage: token cleared when the tab closes (good for shared
        // machines). Switch to "localStorage" if cross-tab persistence is wanted.
        cacheLocation: "sessionStorage",
        storeAuthStateInCookie: false,
      },
    };
  }

  function ensureReady() {
    if (!initialized || !msalInstance) {
      throw new Error("PTOAuth.initialize() must be awaited before use.");
    }
  }

  /**
   * Initialize MSAL once per page load. Safe to call multiple times.
   * Handles a returning redirect (if ever used) and restores the active
   * account from cache so a refreshed page stays "signed in".
   */
  async function initialize() {
    if (initialized) return;

    if (typeof msal === "undefined" || !msal.PublicClientApplication) {
      throw new Error(
        "MSAL library not loaded. Include lib/msal-browser.min.js before js/auth.js " +
          "(see lib/README.md for how to install it)."
      );
    }
    assertConfigured();

    msalInstance = new msal.PublicClientApplication(buildMsalConfig());
    await msalInstance.initialize();

    // If we returned from a redirect, capture the account. (We use popups in
    // Phase 1A, but this keeps the path safe if we switch to redirect later.)
    try {
      var redirectResult = await msalInstance.handleRedirectPromise();
      if (redirectResult && redirectResult.account) {
        msalInstance.setActiveAccount(redirectResult.account);
      }
    } catch (e) {
      // Non-fatal: log and continue; sign-in can still be attempted.
      console.warn("[PTOAuth] handleRedirectPromise:", e && e.message);
    }

    // Restore an existing cached account as the active one.
    if (!msalInstance.getActiveAccount()) {
      var accounts = msalInstance.getAllAccounts();
      if (accounts && accounts.length) {
        msalInstance.setActiveAccount(accounts[0]);
      }
    }

    initialized = true;
  }

  /** Interactive sign-in via popup. Returns the active account. */
  async function signIn() {
    ensureReady();
    try {
      var result = await msalInstance.loginPopup({ scopes: PTOConfig.scopes.login });
      if (result && result.account) {
        msalInstance.setActiveAccount(result.account);
      }
      return getAccount();
    } catch (e) {
      throw friendlyAuthError(e, "Sign-in failed");
    }
  }

  /**
   * Interactive sign-in via FULL-PAGE REDIRECT. For automatic sign-in on page
   * load: browsers block popups that aren't triggered by a user gesture, so
   * loginPopup can never auto-run at load time — a same-tab redirect can.
   * NOTE: this NAVIGATES AWAY (the returned promise normally never resolves).
   * On return, initialize()'s handleRedirectPromise() captures the account and
   * sets it active, so callers just re-run their normal signed-in boot path.
   * Additive helper (currently used by hr.html's auto-login only); the popup
   * signIn() above is unchanged for every existing button-driven flow.
   */
  async function signInRedirect() {
    ensureReady();
    try {
      await msalInstance.loginRedirect({ scopes: PTOConfig.scopes.login });
    } catch (e) {
      throw friendlyAuthError(e, "Sign-in (redirect) failed");
    }
  }

  /** Sign the active account out (popup). */
  async function signOut() {
    ensureReady();
    var account = msalInstance.getActiveAccount();
    try {
      await msalInstance.logoutPopup({ account: account });
    } catch (e) {
      throw friendlyAuthError(e, "Sign-out failed");
    }
  }

  /** The currently signed-in account, or null. */
  function getAccount() {
    if (!msalInstance) return null;
    return msalInstance.getActiveAccount();
  }

  /**
   * Acquire a Graph access token. Silent-first, popup fallback.
   * @param {string[]} [scopes] - defaults to PTOConfig.scopes.graphMe.
   * @returns {Promise<string>} access token
   */
  async function getToken(scopes) {
    ensureReady();
    var account = getAccount();
    if (!account) {
      throw new Error("Not signed in. Call PTOAuth.signIn() first.");
    }
    var request = {
      account: account,
      scopes: scopes && scopes.length ? scopes : PTOConfig.scopes.graphMe,
    };
    try {
      var silent = await msalInstance.acquireTokenSilent(request);
      return silent.accessToken;
    } catch (silentErr) {
      // Silent failed (consent required / interaction required / expiry) →
      // fall back to an interactive popup.
      try {
        var interactive = await msalInstance.acquireTokenPopup(request);
        if (interactive && interactive.account) {
          msalInstance.setActiveAccount(interactive.account);
        }
        return interactive.accessToken;
      } catch (popupErr) {
        throw friendlyAuthError(popupErr, "Could not acquire access token");
      }
    }
  }

  /** Normalize MSAL errors into something readable for the UI. */
  function friendlyAuthError(e, prefix) {
    var detail = (e && (e.errorMessage || e.message)) || String(e);
    return new Error(prefix + ": " + detail);
  }

  return {
    initialize: initialize,
    signIn: signIn,
    signInRedirect: signInRedirect,
    signOut: signOut,
    getAccount: getAccount,
    getToken: getToken,
  };
})();
