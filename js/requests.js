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
   *     isPartialDay, hours, isUrgent?, requestKey?, onBehalfReason? }
   * @param {object} context - resolved identities + options:
   *   { requester, submitter, manager, managersManager, onBehalf, submittedAt?,
   *     approverOverride? }
   *   - requester      : Graph user the PTO is FOR (id, displayName, mail/UPN, department, jobTitle)
   *   - submitter      : Graph user who submitted (defaults to requester)
   *   - manager        : requester's manager (or null)
   *   - managersManager: manager's manager (or null)
   *   - onBehalf       : true if submitter !== requester (HR/Admin delegated submit)
   *   - submittedAt    : optional ISO string override (defaults to now)
   *   - approverOverride: optional { approver: GraphUser, reason: string } — set
   *     ONLY when an HR/Admin explicitly routes approval to someone other than
   *     the employee's manager (see docs/ALTERNATE_APPROVER_DESIGN.md). `reason`
   *     is REQUIRED whenever `approver` is provided (throws otherwise).
   *
   * On-behalf semantics (the contract the calendar/notification flows depend on):
   *   RequesterEmail/RequesterName/... always describe the EMPLOYEE the PTO is for.
   *   ManagerEmail is the EMPLOYEE's manager. SubmittedBy* records who filled the
   *   form. RequestMode is "Self" or "On behalf of"; OnBehalf (bool) mirrors it for
   *   any flow that already reads the boolean.
   *
   * Alternate-approver semantics (the contract approve.html / future notification
   * routing depend on — additive, does NOT change on-behalf or manager semantics):
   *   ManagerEmail/ManagerName ALWAYS remain the employee's real manager, exactly
   *   as before. ApproverEmail/ApproverName are WHO SHOULD APPROVE this request —
   *   default to a mirror of Manager*, or the HR/Admin-selected alternate when
   *   `context.approverOverride` is supplied. OriginalManagerEmail/Name always
   *   preserve the real manager snapshot (so it survives even if the org chart
   *   changes later), independent of whether an override was used.
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

    var override = context.approverOverride || null;
    var overrideApprover = (override && override.approver) || null;
    var overrideReason = override ? String(override.reason || "").trim() : "";
    var hasOverride = !!(overrideApprover && pickEmail(overrideApprover));
    if (overrideApprover && !overrideReason) {
      throw new Error("buildCreateRequestFields: an alternate-approver override requires a reason.");
    }

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
    // Sick is the only PTO type getInitialStatus() auto-approves — call that
    // out explicitly in the audit trail so "why was this already Approved?"
    // never requires guessing from the status word alone.
    var isSickAutoApproved = status === "Auto-Approved" && String(input.ptoType || "").trim().toLowerCase() === "sick";
    var statusNote = isSickAutoApproved
      ? "Auto-Approved — PTO Type = Sick, no manager approval required"
      : status;
    var managerEmail = manager ? pickEmail(manager) : "";
    var managerName = manager ? manager.displayName || "" : "";

    var auditDetails =
      "PTO Central app — " +
      (onBehalf ? "on behalf of " + (requester.displayName || pickEmail(requester)) : "self-service") +
      " (" + statusNote + ")";
    if (hasOverride) {
      auditDetails +=
        "; approval routed to " + (overrideApprover.displayName || pickEmail(overrideApprover)) +
        " <" + pickEmail(overrideApprover) + "> instead of manager " +
        (managerName || "(none)") + (managerEmail ? " <" + managerEmail + ">" : "") +
        " — override reason: " + overrideReason;
    }
    var auditLine = PTORules.buildAuditLine("Created", actorName, auditDetails);

    var fields = {
      Title: requestKey,

      // Requester snapshot (from Graph/Entra)
      RequesterId: requester.id || "",
      RequesterEmail: pickEmail(requester),
      RequesterName: requester.displayName || "",
      RequesterDepartment: requester.department || "",
      RequesterJobTitle: requester.jobTitle || "",

      // Submitter snapshot (who actually filled the form)
      SubmittedById: submitter.id || "",
      SubmittedByEmail: pickEmail(submitter),
      SubmittedByName: submitter.displayName || "",
      OnBehalf: onBehalf,
      RequestMode: onBehalf ? "On behalf of" : "Self",
      OnBehalfReason: onBehalf ? (input.onBehalfReason || "") : "",

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
      ManagerEmail: managerEmail,
      ManagerName: managerName,
      SkipManagerManagerId: managersManager ? managersManager.id || "" : "",
      SkipManagerManagerEmail: managersManager ? pickEmail(managersManager) : "",
      SkipManagerManagerName: managersManager ? managersManager.displayName || "" : "",

      // Alternate approver (docs/ALTERNATE_APPROVER_DESIGN.md) — ManagerEmail/Name
      // above are UNCHANGED by this feature and always stay the real manager.
      // ApproverEmail/Name default to a mirror of Manager*; OriginalManager*
      // always preserves the real-manager snapshot, override or not.
      ApproverEmail: hasOverride ? pickEmail(overrideApprover) : managerEmail,
      ApproverName: hasOverride ? (overrideApprover.displayName || "") : managerName,
      ApproverOverride: hasOverride,
      ApproverOverrideReason: hasOverride ? overrideReason : "",
      OriginalManagerEmail: managerEmail,
      OriginalManagerName: managerName,

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

  // --- Submit-metadata internal-name resolution -----------------------------
  // The six submitter/mode columns were (re)created MANUALLY on the live list,
  // so their SharePoint INTERNAL names are not guaranteed to match the canonical
  // names this module writes (e.g. a column displayed as "SubmittedByEmail" can
  // have internal name "Submitted_x0020_By_x0020_Email"; a recreated "OnBehalf"
  // can become "OnBehalf0"). Graph's item-create SILENTLY DROPS unrecognized
  // field names instead of failing — which is exactly how items 28/29 saved
  // everything except these fields (see docs/PRODUCTION_READINESS_RUNBOOK.md).
  //
  // Fix: resolve the live list's columns once per session and remap ONLY these
  // six fields onto their real internal names. The proven core columns
  // (Title, Requester*, Manager*, PtoType, dates, Status, AuditLog, ...) are
  // NEVER remapped. A field whose column genuinely doesn't exist is dropped
  // with a console warning so the create still succeeds.
  var METADATA_FIELD_CANDIDATES = {
    // canonical name → acceptable internal names / display names on the list
    SubmittedById: ["SubmittedById", "Submitted By (OID)", "Submitted By Id"],
    SubmittedByEmail: ["SubmittedByEmail", "Submitted By Email"],
    SubmittedByName: ["SubmittedByName", "Submitted By Name"],
    OnBehalf: ["OnBehalf", "On Behalf Of", "On Behalf"],
    RequestMode: ["RequestMode", "Request Mode"],
    OnBehalfReason: ["OnBehalfReason", "On-Behalf Reason", "On Behalf Reason"],
  };

  /** Loose compare: case-insensitive, ignoring spaces/dashes/underscores and
   *  SharePoint's _x0020_ space encoding (so "Submitted_x0020_By_x0020_Email",
   *  "Submitted By Email" and "SubmittedByEmail" all normalize identically). */
  function normName(s) {
    return String(s || "")
      .replace(/_x0020_/gi, "")
      .replace(/[\s\-_]/g, "")
      .toLowerCase();
  }

  // Alternate-approver columns (docs/ALTERNATE_APPROVER_DESIGN.md,
  // provisioning §3.2). New/optional — same tolerant-matching rationale as the
  // submit-metadata fields: if these are ever hand-created on the live list
  // before `provision-sharepoint-list.ps1` runs, their internal names may not
  // match the canonical ones this module writes.
  var APPROVER_FIELD_CANDIDATES = {
    ApproverEmail: ["ApproverEmail", "Approver Email"],
    ApproverName: ["ApproverName", "Approver Name"],
    ApproverOverride: ["ApproverOverride", "Approver Override"],
    ApproverOverrideReason: ["ApproverOverrideReason", "Approver Override Reason"],
    OriginalManagerEmail: ["OriginalManagerEmail", "Original Manager Email"],
    OriginalManagerName: ["OriginalManagerName", "Original Manager Name"],
  };

  // Optional HR-cancellation metadata columns (schema §3.7). Provisioned names
  // are canonical, but tolerate manually-created variants the same way.
  // NOTE: the canonical internal name is `CancelReason` (display "Cancellation
  // Reason") — "CancellationReason" is accepted as a loose candidate only.
  var CANCEL_FIELD_CANDIDATES = {
    CancelledById: ["CancelledById", "Cancelled By (OID)", "Cancelled By Id"],
    CancelledByEmail: ["CancelledByEmail", "Cancelled By Email"],
    CancelledByName: ["CancelledByName", "Cancelled By Name"],
    CancelledAt: ["CancelledAt", "Cancelled At"],
    CancelReason: ["CancelReason", "Cancellation Reason", "CancellationReason"],
  };

  var _columnsCache = null; // one live-columns fetch per session (shared)

  async function getLiveColumns() {
    if (_columnsCache) return _columnsCache;
    var ctx = await PTOGraph.resolveContext();
    var res = await PTOGraph.getListColumns(ctx.siteId, ctx.listId);
    _columnsCache = (res && res.value) || [];
    return _columnsCache;
  }

  /** Resolve a candidates map ({canonical: [names...]}) against the live list.
   *  Returns {canonical: internalName|null}. Shared by submit metadata and
   *  cancellation metadata. */
  async function resolveFieldMap(candidatesMap, label) {
    var columns = await getLiveColumns();
    var map = {};
    Object.keys(candidatesMap).forEach(function (canonical) {
      var candidates = candidatesMap[canonical];

      // 1. Exact internal-name match wins outright.
      var col = columns.filter(function (c) { return c.name === canonical; })[0];

      // 2. Otherwise match any candidate against internal OR display name,
      //    loosely normalized. Prefer internal-name hits over display hits so a
      //    mangled internal name (OnBehalf0) is only used via its display name.
      if (!col) {
        var wanted = candidates.map(normName);
        col =
          columns.filter(function (c) {
            return wanted.indexOf(normName(c.name)) !== -1;
          })[0] ||
          columns.filter(function (c) {
            return wanted.indexOf(normName(c.displayName)) !== -1;
          })[0];
      }

      map[canonical] = col ? col.name : null;
    });

    // Always log the resolved mapping — this is the ground truth of the live
    // list's internal names and the first thing to check when a field is blank.
    console.log("[PTORequests] " + (label || "field") + " column mapping (canonical → internal):", map);
    return map;
  }

  var _metaFieldMap = null; // canonical → real internal name (or null if absent)

  async function resolveMetadataFieldMap() {
    if (_metaFieldMap) return _metaFieldMap;
    _metaFieldMap = await resolveFieldMap(METADATA_FIELD_CANDIDATES, "submit-metadata");
    return _metaFieldMap;
  }

  var _approverFieldMap = null; // canonical → real internal name (or null if absent)

  /** Same pattern as resolveMetadataFieldMap, for the six approver columns. */
  async function resolveApproverFieldMap() {
    if (_approverFieldMap) return _approverFieldMap;
    _approverFieldMap = await resolveFieldMap(APPROVER_FIELD_CANDIDATES, "approver");
    return _approverFieldMap;
  }

  /**
   * READ-direction helper for the submit-metadata fields: given a raw
   * `item.fields` object, return {SubmittedById, SubmittedByEmail,
   * SubmittedByName, OnBehalf, RequestMode, OnBehalfReason} using the resolved
   * internal names (falling back to canonical names when unresolved). Callers
   * should `await resolveMetadataFieldMap()` once before bulk use; without it
   * this still works for lists whose internal names are canonical.
   */
  function readSubmitMetadata(fields) {
    fields = fields || {};
    var out = {};
    Object.keys(METADATA_FIELD_CANDIDATES).forEach(function (canonical) {
      var internal = (_metaFieldMap && _metaFieldMap[canonical]) || canonical;
      out[canonical] = fields[internal];
    });
    return out;
  }

  /**
   * READ-direction helper for the alternate-approver fields: given a raw
   * `item.fields` object, return {ApproverEmail, ApproverName, ApproverOverride,
   * ApproverOverrideReason, OriginalManagerEmail, OriginalManagerName} using the
   * resolved internal names (falling back to canonical names when unresolved,
   * which also correctly yields `undefined` for legacy requests / a
   * not-yet-provisioned list — callers must treat a blank ApproverEmail as
   * "use ManagerEmail", never as an error). Callers should
   * `await resolveApproverFieldMap()` once before bulk use.
   */
  function readApproverMetadata(fields) {
    fields = fields || {};
    var out = {};
    Object.keys(APPROVER_FIELD_CANDIDATES).forEach(function (canonical) {
      var internal = (_approverFieldMap && _approverFieldMap[canonical]) || canonical;
      out[canonical] = fields[internal];
    });
    return out;
  }

  // Groups of fields this module may need to remap onto the live list's real
  // internal names before a create/PATCH (manually-created columns can have
  // mangled internal names — see METADATA_FIELD_CANDIDATES comment above).
  var REMAPPABLE_GROUPS = [
    { candidates: METADATA_FIELD_CANDIDATES, resolve: resolveMetadataFieldMap },
    { candidates: APPROVER_FIELD_CANDIDATES, resolve: resolveApproverFieldMap },
  ];

  /**
   * Remap the submit-metadata AND alternate-approver fields onto the live
   * list's internal names. Core fields pass through untouched. If a group's
   * column resolution fails (permissions/transient), that group's fields fall
   * back to their canonical names rather than blocking the create — the two
   * groups resolve independently so one failing never affects the other.
   */
  async function applyMetadataFieldMap(fields) {
    var maps = await Promise.all(
      REMAPPABLE_GROUPS.map(function (group) {
        return group.resolve().catch(function (e) {
          console.warn(
            "[PTORequests] could not resolve some list columns; sending those canonical field names as-is.",
            e
          );
          return null; // resolution failed — signal passthrough for this group
        });
      })
    );

    var out = {};
    Object.keys(fields).forEach(function (key) {
      for (var i = 0; i < REMAPPABLE_GROUPS.length; i++) {
        if (key in REMAPPABLE_GROUPS[i].candidates) {
          var map = maps[i];
          if (!map) { out[key] = fields[key]; return; } // resolution failed — passthrough
          var internal = map[key];
          if (internal) {
            out[internal] = fields[key];
          } else {
            console.warn(
              "[PTORequests] column for '" + key + "' not found on the PTO Requests list — " +
              "field dropped from the create payload. Provision/rename the column, then retry."
            );
          }
          return;
        }
      }
      out[key] = fields[key]; // core field — never remapped
    });
    return out;
  }

  /**
   * Create the request item in SharePoint.
   * Submit-metadata fields (SubmittedBy*, OnBehalf, RequestMode, OnBehalfReason)
   * are remapped to the live list's real internal names first — see above.
   * @param {object} fields - from buildCreateRequestFields().
   * @returns {Promise<object>} created item (includes id, webUrl).
   */
  async function createRequest(fields) {
    if (!fields || !fields.Title) {
      throw new Error("createRequest: fields object with at least a Title is required.");
    }
    var mapped = await applyMetadataFieldMap(fields);
    return PTOGraph.createListItem(mapped);
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
      managerName: f.ManagerName,
      isShortNotice: f.IsShortNotice,
      isUrgent: f.IsUrgent,
      noticeDays: f.NoticeDays,
      submittedAt: submittedAt,
      requesterEmail: f.RequesterEmail, // used by the fallback filter
      requesterName: f.RequesterName,
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

  /**
   * List ALL requests (HR Center). Pages through the list via @odata.nextLink
   * up to `maxPages` × `top` items (default 10 × 200 = 2000 most recent — the
   * cap is logged and surfaced via `truncated`). Read-only; caller (hr.html)
   * is HR/Admin-gated by PTOAuthz BEFORE this is invoked — this module does
   * not re-check roles (the real boundary is SharePoint permissions).
   *
   * @param {object} [options] - { top?: number, maxPages?: number }
   * @returns {Promise<{items: object[], truncated: boolean, pages: number}>}
   *   items normalized + sorted by submittedAt (then Created) descending.
   */
  async function listAllRequests(options) {
    options = options || {};
    var top = options.top || 200;
    var maxPages = options.maxPages || 10;

    var ctx = await PTOGraph.resolveContext();
    var url = "/sites/" + ctx.siteId + "/lists/" + ctx.listId +
      "/items?$expand=fields&$top=" + top;

    var items = [];
    var pages = 0;
    while (url && pages < maxPages) {
      var res = await PTOGraph.request("GET", url, { scopes: PTOConfig.scopes.siteRead });
      items = items.concat((((res && res.value) || [])).map(normalizeRequestItem));
      url = (res && res["@odata.nextLink"]) || null; // absolute URL; PTOGraph passes it through
      pages++;
    }
    var truncated = !!url;
    if (truncated) {
      console.warn("[PTORequests] listAllRequests hit the page cap (" +
        maxPages + " × " + top + ") — older items were not loaded.");
    }

    items.sort(function (a, b) {
      return String(b._sortKey || "").localeCompare(String(a._sortKey || ""));
    });
    return { items: items, truncated: truncated, pages: pages };
  }

  // Statuses an HR cancellation may act on. Anything else is a duplicate /
  // invalid cancellation and is refused before any write.
  var CANCELLABLE_STATUSES = ["Pending", "Approved", "Auto-Approved", "Auto-Approved (Escalation)"];

  /**
   * HR/Admin cancellation of a request (hr.html).
   *
   * Writes (single partial PATCH — nothing else touched):
   *   - Status = "Cancelled"  ← the EXACT value the validated
   *     `PTO Calendar Cancellation MVP Clean` flow triggers on. The app does
   *     NOT touch EmployeeEventId/CorpEventId — event deletion is the flow's job.
   *     (Pending requests have no events; the flow safely terminates.)
   *   - AuditLog             ← APPENDED (existing preserved), with actor + reason.
   *   - Optional metadata IF the columns exist on the live list (resolved at
   *     runtime, same tolerant matching as submit metadata): CancelledById,
   *     CancelledByEmail, CancelledByName, CancelledAt, CancelReason. Missing
   *     columns are skipped — they never block the cancellation.
   *
   * @param {string|number} itemId
   * @param {object} opts
   *   { actor: {id, displayName, mail|userPrincipalName},
   *     reason: string,             // optional free text
   *     currentStatus: string,      // status as loaded — duplicate guard
   *     existingAuditLog: string }
   * @returns {Promise<{fields: object, response: any}>}
   */
  async function cancelRequest(itemId, opts) {
    if (!itemId) throw new Error("cancelRequest requires an itemId.");
    opts = opts || {};

    var current = String(opts.currentStatus || "").trim();
    if (CANCELLABLE_STATUSES.indexOf(current) === -1) {
      throw new Error(
        current === "Cancelled"
          ? "This request is already Cancelled."
          : "A request with status \"" + (current || "unknown") + "\" can't be cancelled."
      );
    }

    var actor = opts.actor || {};
    var actorEmail = actor.mail || actor.userPrincipalName || "";
    var actorName = actor.displayName || actorEmail || "Unknown";
    var reason = String(opts.reason || "").trim();
    var nowIso = new Date().toISOString();

    // Append (never overwrite) the audit trail.
    var newLine = PTORules.buildAuditLine(
      "Cancelled",
      actorName,
      "HR Center cancellation — " + (reason ? "reason: " + reason : "no reason given")
    );
    var existingRaw = opts.existingAuditLog;
    var existing = (existingRaw === null || existingRaw === undefined) ? "" : String(existingRaw);
    var auditLog = existing.trim() ? existing + "\n" + newLine : newLine;

    // Core fields — always written. These are proven-good internal names.
    var fields = {
      Status: "Cancelled",
      AuditLog: auditLog,
    };

    // Optional metadata — include ONLY columns that exist on the live list.
    // (PATCH, unlike create, errors on unknown field names — so resolve first.)
    try {
      var map = await resolveFieldMap(CANCEL_FIELD_CANDIDATES, "cancellation");
      var values = {
        CancelledById: actor.id || "",
        CancelledByEmail: actorEmail,
        CancelledByName: actorName,
        CancelledAt: nowIso,
        CancelReason: reason,
      };
      Object.keys(values).forEach(function (canonical) {
        if (map[canonical]) fields[map[canonical]] = values[canonical];
      });
    } catch (e) {
      console.warn("[PTORequests] cancellation metadata column lookup failed — " +
        "cancelling with Status + AuditLog only.", e);
    }

    var response;
    try {
      response = await PTOGraph.updateListItem(itemId, fields);
    } catch (e) {
      // Resilience: if an optional column was resolved stale and PATCH rejects
      // it, retry once with the guaranteed core fields only.
      var msg = (e && e.message) || "";
      if (/not recognized|does not exist|invalid/i.test(msg) && Object.keys(fields).length > 2) {
        console.warn("[PTORequests] cancellation PATCH rejected optional metadata — retrying core-only.", msg);
        var core = { Status: "Cancelled", AuditLog: auditLog };
        response = await PTOGraph.updateListItem(itemId, core);
        fields = core;
      } else {
        throw e;
      }
    }
    return { fields: fields, response: response };
  }

  // --- Later phases (kept as labeled stubs) --------------------------------

  /** Patch fields (approve/reject/escalate/HR edit) (Phase 2D+). */
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
    // Diagnostic: resolve + log the live internal names of the submit-metadata
    // columns (run `await PTORequests.resolveMetadataFieldMap()` in dev tools).
    resolveMetadataFieldMap: resolveMetadataFieldMap,
    readSubmitMetadata: readSubmitMetadata,
    // Alternate approver (docs/ALTERNATE_APPROVER_DESIGN.md) — same pattern as
    // the submit-metadata resolver above.
    resolveApproverFieldMap: resolveApproverFieldMap,
    readApproverMetadata: readApproverMetadata,
    // HR Center (hr.html — HR/Admin-gated by PTOAuthz before use)
    listAllRequests: listAllRequests,
    cancelRequest: cancelRequest,
    CANCELLABLE_STATUSES: CANCELLABLE_STATUSES,
    getRequest: getRequest,
    getRequestById: getRequestById,
    updateRequestDecision: updateRequestDecision,
    listMyRequests: listMyRequests,
    // later
    update: update,
    appendAudit: appendAudit,
  };
})();
