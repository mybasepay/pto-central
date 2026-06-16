/*
 * requests.js — Data-access layer for the "PTO Requests" SharePoint List.
 * Namespace: window.PTORequests
 *
 * Responsibility (per PTO_CENTRAL_ARCHITECTURE.md §4, §5):
 *   Maps between the app's request objects and the SharePoint List field schema
 *   (canonical internal names live in docs/SHAREPOINT_LIST_PROVISIONING.md), and
 *   performs create / read through Graph.
 *
 *     - buildCreateRequestFields(input, context) -> SharePoint fields object
 *     - createRequest(fields)                    -> PTOGraph.createListItem
 *     - getRequest(itemId)                       -> PTOGraph.getListItem
 *
 * IMPORTANT: keep the SharePoint internal field NAMES (Title, RequesterId,
 * PtoType, Status, EscalationLevel, ...) confined to THIS module so a schema
 * change touches one file (architecture §1 design principle).
 *
 * Dependency direction (§7): requests.js → graph.js (I/O) and rules.js (pure
 * business logic). Pages call requests.js, never Graph directly.
 *
 * Phase 2A: create + read implemented. update/listForUser/appendAudit later.
 */

window.PTORequests = (function () {
  "use strict";

  /** Best email for a Graph user object. */
  function pickEmail(user) {
    return (user && (user.mail || user.userPrincipalName)) || "";
  }

  /**
   * Build the SharePoint `fields` object for a NEW request.
   *
   * @param {object} input - request details from the form:
   *   { ptoType, startDate, endDate, reason, backupContactName, backupContactEmail,
   *     isPartialDay, hours, isUrgent?, requestKey? }
   * @param {object} context - resolved identities + options:
   *   { requester, submitter, manager, managersManager, onBehalf, submittedAt? }
   *   - requester      : Graph user the PTO is FOR (id, displayName, mail/UPN, department, jobTitle)
   *   - submitter      : Graph user who submitted (defaults to requester)
   *   - manager        : requester's manager (or null)
   *   - managersManager: manager's manager (or null)
   *   - onBehalf       : true if submitter !== requester
   *   - submittedAt    : optional ISO string override (defaults to now)
   * @returns {object} fields keyed by SharePoint internal name.
   */
  function buildCreateRequestFields(input, context) {
    input = input || {};
    context = context || {};

    var requester = context.requester || {};
    var submitter = context.submitter || requester;
    var manager = context.manager || null;
    var managersManager = context.managersManager || null;
    var onBehalf = !!context.onBehalf;

    var submittedAtIso = context.submittedAt
      ? new Date(context.submittedAt).toISOString()
      : new Date().toISOString();

    var startDate = PTORules.formatDateOnly(input.startDate);
    var endDate = PTORules.formatDateOnly(input.endDate || input.startDate);

    var noticeDays = PTORules.calculateNoticeDays(startDate, submittedAtIso);
    var isShort = PTORules.isShortNotice(noticeDays);
    var status = PTORules.getInitialStatus(input.ptoType);
    var requestKey = input.requestKey || PTORules.generateRequestKey();

    var actorName = submitter.displayName || requester.displayName || "Unknown";
    var auditDetails =
      "PTO Central app — " +
      (onBehalf ? "on behalf of " + (requester.displayName || pickEmail(requester)) : "self-service") +
      " (" + status + ")";
    var auditLine = PTORules.buildAuditLine("Created", actorName, auditDetails);

    var fields = {
      Title: requestKey,

      // Requester snapshot (from Graph/Entra)
      RequesterId: requester.id || "",
      RequesterEmail: pickEmail(requester),
      RequesterName: requester.displayName || "",
      RequesterDepartment: requester.department || "",
      RequesterJobTitle: requester.jobTitle || "",

      // Submitter snapshot
      SubmittedById: submitter.id || "",
      SubmittedByEmail: pickEmail(submitter),
      SubmittedByName: submitter.displayName || "",
      OnBehalf: onBehalf,

      // Request details
      PtoType: input.ptoType,
      StartDate: startDate,
      EndDate: endDate,
      IsPartialDay: !!input.isPartialDay,
      Reason: input.reason || "",
      BackupContactName: input.backupContactName || "",
      BackupContactEmail: input.backupContactEmail || "",

      // Approval / manager chain snapshot
      Status: status,
      ManagerId: manager ? manager.id || "" : "",
      ManagerEmail: manager ? pickEmail(manager) : "",
      ManagerName: manager ? manager.displayName || "" : "",
      SkipManagerManagerId: managersManager ? managersManager.id || "" : "",
      SkipManagerManagerEmail: managersManager ? pickEmail(managersManager) : "",
      SkipManagerManagerName: managersManager ? managersManager.displayName || "" : "",

      // Notice / urgency
      SubmittedAt: submittedAtIso,
      NoticeDays: noticeDays,
      IsShortNotice: isShort,
      ShortNoticeResolved: false,
      IsUrgent: !!input.isUrgent,

      // Escalation
      EscalationLevel: 0,

      // Audit
      AuditLog: auditLine,
    };

    // Hours only when a partial-day value was actually provided.
    if (input.isPartialDay && input.hours !== undefined && input.hours !== null && input.hours !== "") {
      fields.Hours = Number(input.hours);
    }

    return fields;
  }

  /**
   * Create the request item in SharePoint.
   * @param {object} fields - from buildCreateRequestFields().
   * @returns {Promise<object>} created item (includes id, webUrl).
   */
  async function createRequest(fields) {
    if (!fields || !fields.Title) {
      throw new Error("createRequest: fields object with at least a Title is required.");
    }
    return PTOGraph.createListItem(fields);
  }

  /**
   * Read a single request (expands fields).
   * @param {string|number} itemId
   */
  async function getRequest(itemId) {
    return PTOGraph.getListItem(itemId);
  }

  /** Alias — read a single request by list item id (approval page, detail view). */
  async function getRequestById(itemId) {
    return PTOGraph.getListItem(itemId);
  }

  /**
   * Record a manager (or HR) decision on a request (Phase 3A).
   * PATCHes ONLY the decision fields — partial update, nothing else touched:
   *   Status, DecisionById, DecisionByEmail, DecisionByName, DecisionDate,
   *   DecisionComment, AuditLog.
   * AuditLog is APPENDED to (existing value preserved), never overwritten blindly.
   *
   * @param {string|number} itemId
   * @param {object} decision
   *   { status: "Approved"|"Rejected",
   *     actor: { id, displayName, mail|userPrincipalName },
   *     comment: string,
   *     existingAuditLog: string }
   * @returns {Promise<{fields: object, response: any}>} the patched fields (so the
   *   page can render the new status + appended AuditLog) and the Graph response.
   */
  async function updateRequestDecision(itemId, decision) {
    if (!itemId) throw new Error("updateRequestDecision requires an itemId.");
    decision = decision || {};
    var status = decision.status;
    if (status !== "Approved" && status !== "Rejected") {
      throw new Error("updateRequestDecision: status must be 'Approved' or 'Rejected'.");
    }

    var actor = decision.actor || {};
    var actorEmail = actor.mail || actor.userPrincipalName || "";
    var actorName = actor.displayName || actorEmail || "Unknown";
    var comment = decision.comment || "";
    var nowIso = new Date().toISOString();

    // Append (do not overwrite) the audit trail. Handle null/undefined/empty
    // (or non-string) existing logs safely before appending.
    var newLine = PTORules.buildAuditLine(status, actorName, comment ? "comment: " + comment : "no comment");
    var existingRaw = decision.existingAuditLog;
    var existing = (existingRaw === null || existingRaw === undefined) ? "" : String(existingRaw);
    var auditLog = existing.trim() ? existing + "\n" + newLine : newLine;

    var fields = {
      Status: status,
      DecisionById: actor.id || "",
      DecisionByEmail: actorEmail,
      DecisionByName: actorName,
      DecisionDate: nowIso,
      DecisionComment: comment,
      AuditLog: auditLog,
    };

    var response = await PTOGraph.updateListItem(itemId, fields);
    return { fields: fields, response: response };
  }

  /** Normalize a Graph list item into a friendly request shape. */
  function normalizeRequestItem(item) {
    var f = item.fields || {};
    var submittedAt = f.SubmittedAt || item.createdDateTime || "";
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
      isShortNotice: f.IsShortNotice,
      noticeDays: f.NoticeDays,
      submittedAt: submittedAt,
      requesterEmail: f.RequesterEmail, // used by the fallback filter
      _sortKey: submittedAt, // ISO strings sort lexicographically
    };
  }

  /**
   * List the signed-in user's own requests.
   * Primary: server-side $filter on fields/RequesterEmail (RequesterEmail is an
   *   indexed column). Sent with the Prefer "HonorNonIndexedQueries…" header so
   *   it degrades rather than hard-fails on tenants that are fussy about filters.
   * Fallback: if the filtered query throws, read recent items ($top=200) and
   *   filter client-side, returning a warning. Structured so we can optimize later.
   *
   * @param {string} userEmail
   * @returns {Promise<{items: object[], warning: string|null, usedFallback: boolean, raw: any}>}
   *   items[] are normalized (id, webUrl, fields, requestKey, ptoType, startDate,
   *   endDate, status, managerEmail, isShortNotice, noticeDays, submittedAt),
   *   sorted by submittedAt (then Created) descending.
   */
  async function listMyRequests(userEmail) {
    if (!userEmail) throw new Error("listMyRequests requires a userEmail.");
    var ctx = await PTOGraph.resolveContext();
    var base = "/sites/" + ctx.siteId + "/lists/" + ctx.listId + "/items?$expand=fields";

    // OData: escape single quotes by doubling; then URL-encode spaces + quotes
    // (leave the property-path slash intact).
    var safe = String(userEmail).replace(/'/g, "''");
    var filter = "fields/RequesterEmail eq '" + safe + "'";
    var filteredUrl = base + "&$filter=" + filter.replace(/ /g, "%20").replace(/'/g, "%27");

    var warning = null;
    var usedFallback = false;
    var raw = null;

    try {
      raw = await PTOGraph.request("GET", filteredUrl, {
        scopes: PTOConfig.scopes.siteRead,
        headers: { Prefer: "HonorNonIndexedQueriesWarningMayFailRandomly" },
      });
    } catch (e) {
      // Fallback: read recent items and filter client-side (dev-friendly).
      usedFallback = true;
      warning =
        "Server-side filter on RequesterEmail failed (" + ((e && e.message) || e) + "). " +
        "Falling back to client-side filtering of the 200 most recent items — results may be incomplete.";
      var fallbackUrl = base + "&$top=200";
      raw = await PTOGraph.request("GET", fallbackUrl, { scopes: PTOConfig.scopes.siteRead });
    }

    var items = (((raw && raw.value) || [])).map(normalizeRequestItem);

    if (usedFallback) {
      var target = String(userEmail).toLowerCase();
      items = items.filter(function (r) {
        return String(r.requesterEmail || "").toLowerCase() === target;
      });
    }

    // Sort by submittedAt (fallback Created) descending.
    items.sort(function (a, b) {
      return String(b._sortKey || "").localeCompare(String(a._sortKey || ""));
    });

    return { items: items, warning: warning, usedFallback: usedFallback, raw: raw };
  }

  // --- Later phases (kept as labeled stubs) --------------------------------

  /** Patch fields (approve/reject/escalate/cancel/HR edit) (Phase 2D+). */
  async function update(itemId, fields) {
    throw new Error("[requests] update() not implemented yet (Phase 2D+).");
  }

  /** Append a line to an append-only log column (Phase 2D+). */
  async function appendAudit(itemId, column, line) {
    throw new Error("[requests] appendAudit() not implemented yet (Phase 2D+).");
  }

  return {
    buildCreateRequestFields: buildCreateRequestFields,
    createRequest: createRequest,
    getRequest: getRequest,
    getRequestById: getRequestById,
    updateRequestDecision: updateRequestDecision,
    listMyRequests: listMyRequests,
    // later
    update: update,
    appendAudit: appendAudit,
  };
})();
