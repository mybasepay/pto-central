/*
 * directory.js — Entra ID (employee directory) helpers via Graph.
 * Namespace: window.PTODirectory
 *
 * Responsibility (per PTO_CENTRAL_ARCHITECTURE.md §5, §10 rules 13-15):
 *   Real-time directory lookups so we NEVER maintain manual employee or manager
 *   lists (a core failure of the old system). All identity/manager data is
 *   pulled live from Entra ID and snapshotted onto the request at submit time.
 *
 *     - getMe()                     signed-in user's profile
 *     - getMyManager()              the signed-in user's manager (/me/manager)
 *     - getUserManager(userId)      any user's manager (/users/{id}/manager)
 *     - getManagerChainForUser(id)  { manager, managersManager }
 *
 * Scopes (see js/config.js):
 *   - getMe / getMyManager use graphMe (User.Read) — your own profile/manager.
 *   - getUserManager (other users) uses directoryRead (User.Read.All) and needs
 *     admin consent. If that's missing, a CLEAR error is surfaced.
 *
 * Dependency direction (§7): directory.js → graph.js → auth.js → config.js.
 *
 * Phase 2A: getMe + manager lookups implemented. searchUsers (on-behalf) later.
 */

window.PTODirectory = (function () {
  "use strict";

  /**
   * Call a manager relationship endpoint, normalizing the two expected
   * "soft" outcomes:
   *   - 404 / "does not exist" => the user simply has NO manager => returns null.
   *   - 403 / authorization    => permission/consent problem => throws a clear,
   *     actionable error (need delegated User.Read.All + admin consent).
   * Any other error is rethrown unchanged.
   */
  async function fetchManager(path, scopes) {
    try {
      return await PTOGraph.get(path, scopes);
    } catch (e) {
      var msg = (e && e.message) || String(e);
      if (/\b404\b|does not exist|ResourceNotFound|not found/i.test(msg)) {
        return null; // no manager assigned — a normal, non-error condition
      }
      if (/\b403\b|Authorization_RequestDenied|Access denied|insufficient privileges/i.test(msg)) {
        throw new Error(
          "Manager lookup was denied. This needs Microsoft Graph delegated " +
            "User.Read.All with admin consent. Add it to the Entra app registration, " +
            "grant admin consent, then sign out and sign in again. (Original: " + msg + ")"
        );
      }
      throw e;
    }
  }

  /**
   * Signed-in user's profile.
   * Graph: GET /me?$select=id,displayName,mail,userPrincipalName,jobTitle,department
   */
  async function getMe() {
    // PTOGraph.getMe() already selects exactly these fields with the graphMe scope.
    return PTOGraph.getMe();
  }

  /**
   * The signed-in user's manager. Returns null if they have no manager.
   * Graph: GET /me/manager?$select=id,displayName,mail,userPrincipalName
   * Uses graphMe (User.Read) — reading your OWN manager does not need User.Read.All.
   */
  async function getMyManager() {
    return fetchManager(
      "/me/manager?$select=id,displayName,mail,userPrincipalName",
      PTOConfig.scopes.graphMe
    );
  }

  /**
   * A specific user's manager. Returns null if none.
   * Graph: GET /users/{userId}/manager?$select=id,displayName,mail,userPrincipalName
   * Uses directoryRead (User.Read.All) — reading OTHER users' managers needs it.
   * @param {string} userId
   */
  async function getUserManager(userId) {
    if (!userId) throw new Error("getUserManager requires a userId.");
    return fetchManager(
      "/users/" + encodeURIComponent(userId) + "/manager?$select=id,displayName,mail,userPrincipalName",
      PTOConfig.scopes.directoryRead
    );
  }

  /**
   * Resolve a user's manager and that manager's manager (for escalation).
   * Both hops use getUserManager (User.Read.All). `managersManager` is null if
   * the manager has no manager (or the user has no manager at all).
   * @param {string} userId
   * @returns {Promise<{manager: object|null, managersManager: object|null}>}
   */
  async function getManagerChainForUser(userId) {
    if (!userId) throw new Error("getManagerChainForUser requires a userId.");
    var manager = await getUserManager(userId);
    var managersManager = null;
    if (manager && manager.id) {
      managersManager = await getUserManager(manager.id);
    }
    return { manager: manager, managersManager: managersManager };
  }

  /**
   * Search employees for the on-behalf flow (§8.2, §10 rule 15).
   * Not needed for Phase 2A self-service; implemented when on-behalf UI lands.
   */
  async function searchUsers(query) {
    throw new Error("[directory] searchUsers() not implemented yet (on-behalf flow).");
  }

  return {
    getMe: getMe,
    getMyManager: getMyManager,
    getUserManager: getUserManager,
    getManagerChainForUser: getManagerChainForUser,
    searchUsers: searchUsers,
  };
})();
