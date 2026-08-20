/*
 * hr.page.js — Controller for hr.html (HR Center).
 *
 * Production behavior preserved:
 *   - Microsoft sign-in + PTOAuthz HR/Admin gate
 *   - Live PTO Requests load through PTORequests.listAllRequests
 *   - Export uses the real filtered dataset
 *   - Approval links, row details, and cancellation logic stay on existing
 *     domain modules
 *
 * This file primarily updates the presentation layer:
 *   - light production layout
 *   - column-header contextual filtering
 *   - compact pagination
 *   - direct record highlighting via itemId query/hash
 */

(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var query = new URLSearchParams(window.location.search || "");

  var PREVIEW_ITEMS = [
    {
      id: "preview-1",
      requestKey: "PTO-20260729-083000-A01A",
      ptoType: "PTO",
      startDate: "2026-08-03",
      endDate: "2026-08-03",
      status: "Pending",
      requesterName: "Ana Employee",
      requesterEmail: "ana.employee@example.test",
      managerName: "Michelle Approver",
      managerEmail: "michelle.approver@example.test",
      approverName: "Michelle Approver",
      approverEmail: "michelle.approver@example.test",
      submittedByName: "Rod Demo",
      submittedByEmail: "rod.demo@example.test",
      submittedAt: "2026-07-29T08:30:00.000Z",
      noticeDays: 5,
      isShortNotice: true,
      onBehalf: true,
      fields: {
        Reason: "Team coverage already aligned.",
        BackupContactName: "Jamie Backup",
        BackupContactEmail: "jamie.backup@example.test",
        RequestMode: "On behalf of",
        OnBehalf: true,
        SubmittedByName: "Rod Demo",
        SubmittedByEmail: "rod.demo@example.test",
        ApproverName: "Michelle Approver",
        ApproverEmail: "michelle.approver@example.test",
        AuditLog: "[2026-07-29T08:30:00.000Z] Created by Rod Demo — Pending",
      },
    },
    {
      id: "preview-2",
      requestKey: "PTO-20260729-091500-B02B",
      ptoType: "Sick",
      startDate: "2026-08-01",
      endDate: "2026-08-01",
      status: "Auto-Approved",
      requesterName: "Rod Demo",
      requesterEmail: "rod.demo@example.test",
      managerName: "Michelle Approver",
      managerEmail: "michelle.approver@example.test",
      approverName: "Michelle Approver",
      approverEmail: "michelle.approver@example.test",
      submittedByName: "Rod Demo",
      submittedByEmail: "rod.demo@example.test",
      submittedAt: "2026-07-29T09:15:00.000Z",
      noticeDays: 1,
      isShortNotice: true,
      onBehalf: false,
      fields: {
        Reason: "Out sick.",
        BackupContactName: "",
        BackupContactEmail: "",
        RequestMode: "Self",
        OnBehalf: false,
        SubmittedByName: "Rod Demo",
        SubmittedByEmail: "rod.demo@example.test",
        ApproverName: "Michelle Approver",
        ApproverEmail: "michelle.approver@example.test",
        AuditLog: "[2026-07-29T09:15:00.000Z] Created by Rod Demo — Auto-Approved",
      },
    },
    {
      id: "preview-3",
      requestKey: "PTO-20260729-102200-C03C",
      ptoType: "PTO",
      startDate: "2026-08-24",
      endDate: "2026-08-25",
      status: "Pending",
      requesterName: "No Manager Demo",
      requesterEmail: "no.manager.demo@example.test",
      managerName: "Maggie Mondragon",
      managerEmail: "maggie@mylascopy.com",
      approverName: "Maggie Mondragon",
      approverEmail: "maggie@mylascopy.com",
      submittedByName: "Rod Demo",
      submittedByEmail: "rod.demo@example.test",
      submittedAt: "2026-07-29T10:22:00.000Z",
      noticeDays: 24,
      isShortNotice: false,
      onBehalf: true,
      fields: {
        Reason: "Coverage coordinated with payroll.",
        BackupContactName: "Jamie Backup",
        BackupContactEmail: "jamie.backup@example.test",
        RequestMode: "On behalf of",
        OnBehalf: true,
        SubmittedByName: "Rod Demo",
        SubmittedByEmail: "rod.demo@example.test",
        ApproverName: "Maggie Mondragon",
        ApproverEmail: "maggie@mylascopy.com",
        AuditLog: "[2026-07-29T10:22:00.000Z] Created by Rod Demo — Pending",
      },
    },
    {
      id: "preview-4",
      requestKey: "PTO-20260728-083000-D04D",
      ptoType: "PTO",
      startDate: "2026-08-06",
      endDate: "2026-08-06",
      status: "Cancellation Requested",
      statusBeforeCancellationRequest: "Approved",
      requesterName: "Rod Demo",
      requesterEmail: "rod.demo@example.test",
      managerName: "Michelle Approver",
      managerEmail: "michelle.approver@example.test",
      approverName: "Michelle Approver",
      approverEmail: "michelle.approver@example.test",
      submittedByName: "Rod Demo",
      submittedByEmail: "rod.demo@example.test",
      submittedAt: "2026-07-28T08:30:00.000Z",
      noticeDays: 9,
      isShortNotice: false,
      onBehalf: false,
      fields: {
        Reason: "Original plans changed.",
        BackupContactName: "Jamie Backup",
        BackupContactEmail: "jamie.backup@example.test",
        RequestMode: "Self",
        OnBehalf: false,
        SubmittedByName: "Rod Demo",
        SubmittedByEmail: "rod.demo@example.test",
        ApproverName: "Michelle Approver",
        ApproverEmail: "michelle.approver@example.test",
        AuditLog:
          "[2026-07-28T08:30:00.000Z] Created by Rod Demo — Approved\n" +
          "[2026-07-30T09:15:00.000Z] Cancellation Requested by Rod Demo — Employee self-service request — reason: Plans changed",
      },
    },
    {
      id: "preview-5",
      requestKey: "PTO-20260727-083000-E05E",
      ptoType: "PTO",
      startDate: "2026-08-28",
      endDate: "2026-08-28",
      status: "Cancellation Requested",
      statusBeforeCancellationRequest: "Pending",
      requesterName: "Rod Demo",
      requesterEmail: "rod.demo@example.test",
      managerName: "Michelle Approver",
      managerEmail: "michelle.approver@example.test",
      approverName: "Michelle Approver",
      approverEmail: "michelle.approver@example.test",
      submittedByName: "Rod Demo",
      submittedByEmail: "rod.demo@example.test",
      submittedAt: "2026-07-27T08:30:00.000Z",
      noticeDays: 32,
      isShortNotice: false,
      onBehalf: false,
      fields: {
        Reason: "Need to cancel after travel change.",
        BackupContactName: "Jamie Backup; Sam Backup",
        BackupContactEmail: "jamie.backup@example.test; sam.backup@example.test",
        RequestMode: "Self",
        OnBehalf: false,
        SubmittedByName: "Rod Demo",
        SubmittedByEmail: "rod.demo@example.test",
        ApproverName: "Michelle Approver",
        ApproverEmail: "michelle.approver@example.test",
        AuditLog:
          "[2026-07-27T08:30:00.000Z] Created by Rod Demo — Pending\n" +
          "[2026-07-30T11:45:00.000Z] Cancellation Requested by Rod Demo — Employee self-service request — reason: Need to cancel after travel change",
      },
    },
    {
      id: "preview-6",
      requestKey: "PTO-20260726-083000-F06F",
      ptoType: "PTO",
      startDate: "2026-08-10",
      endDate: "2026-08-12",
      status: "Pending",
      requesterName: "Rod Demo",
      requesterEmail: "rod.demo@example.test",
      managerName: "Michelle Approver",
      managerEmail: "michelle.approver@example.test",
      approverName: "Michelle Approver",
      approverEmail: "michelle.approver@example.test",
      submittedByName: "Rod Demo",
      submittedByEmail: "rod.demo@example.test",
      submittedAt: "2026-07-26T08:30:00.000Z",
      noticeDays: 15,
      isShortNotice: false,
      onBehalf: false,
      fields: {
        Reason: "Family trip.",
        BackupContactName: "Jamie Backup",
        BackupContactEmail: "jamie.backup@example.test",
        RequestMode: "Self",
        OnBehalf: false,
        SubmittedByName: "Rod Demo",
        SubmittedByEmail: "rod.demo@example.test",
        ApproverName: "Michelle Approver",
        ApproverEmail: "michelle.approver@example.test",
        AuditLog: "[2026-07-26T08:30:00.000Z] Created by Rod Demo — Pending",
      },
    },
    {
      id: "preview-7",
      requestKey: "PTO-20260725-083000-G07G",
      ptoType: "PTO",
      startDate: "2026-09-02",
      endDate: "2026-09-02",
      status: "Pending",
      requesterName: "Rod Demo",
      requesterEmail: "rod.demo@example.test",
      managerName: "Michelle Approver",
      managerEmail: "michelle.approver@example.test",
      approverName: "Michelle Approver",
      approverEmail: "michelle.approver@example.test",
      submittedByName: "Rod Demo",
      submittedByEmail: "rod.demo@example.test",
      submittedAt: "2026-07-25T08:30:00.000Z",
      noticeDays: 39,
      isShortNotice: false,
      onBehalf: false,
      fields: {
        Reason: "Single day event.",
        BackupContactName: "Jamie Backup",
        BackupContactEmail: "jamie.backup@example.test",
        RequestMode: "Self",
        OnBehalf: false,
        SubmittedByName: "Rod Demo",
        SubmittedByEmail: "rod.demo@example.test",
        ApproverName: "Michelle Approver",
        ApproverEmail: "michelle.approver@example.test",
        AuditLog: "[2026-07-25T08:30:00.000Z] Created by Rod Demo — Pending",
      },
    },
    {
      id: "preview-8",
      requestKey: "PTO-20260724-083000-H08H",
      ptoType: "PTO",
      startDate: "2026-07-28",
      endDate: "2026-07-28",
      status: "Pending",
      requesterName: "Rod Demo",
      requesterEmail: "rod.demo@example.test",
      managerName: "Michelle Approver",
      managerEmail: "michelle.approver@example.test",
      approverName: "Michelle Approver",
      approverEmail: "michelle.approver@example.test",
      submittedByName: "Rod Demo",
      submittedByEmail: "rod.demo@example.test",
      submittedAt: "2026-07-24T08:30:00.000Z",
      noticeDays: 4,
      isShortNotice: true,
      onBehalf: false,
      fields: {
        Reason: "Already-started pending cancellation example.",
        BackupContactName: "Jamie Backup",
        BackupContactEmail: "jamie.backup@example.test",
        RequestMode: "Self",
        OnBehalf: false,
        SubmittedByName: "Rod Demo",
        SubmittedByEmail: "rod.demo@example.test",
        ApproverName: "Michelle Approver",
        ApproverEmail: "michelle.approver@example.test",
        AuditLog: "[2026-07-24T08:30:00.000Z] Created by Rod Demo — Pending",
      },
    },
    {
      id: "preview-9",
      requestKey: "PTO-20260723-083000-I09I",
      ptoType: "PTO",
      startDate: "2026-08-19",
      endDate: "2026-08-19",
      status: "Approved",
      requesterName: "Jamie Backup",
      requesterEmail: "jamie.backup@example.test",
      managerName: "Michelle Approver",
      managerEmail: "michelle.approver@example.test",
      approverName: "Michelle Approver",
      approverEmail: "michelle.approver@example.test",
      submittedByName: "Jamie Backup",
      submittedByEmail: "jamie.backup@example.test",
      submittedAt: "2026-07-23T08:30:00.000Z",
      noticeDays: 27,
      isShortNotice: false,
      onBehalf: false,
      fields: {
        Reason: "Personal day.",
        BackupContactName: "",
        BackupContactEmail: "",
        RequestMode: "Self",
        OnBehalf: false,
        SubmittedByName: "Jamie Backup",
        SubmittedByEmail: "jamie.backup@example.test",
        ApproverName: "Michelle Approver",
        ApproverEmail: "michelle.approver@example.test",
        AuditLog: "[2026-07-23T08:30:00.000Z] Created by Jamie Backup — Approved",
      },
    },
    {
      id: "preview-10",
      requestKey: "PTO-20260722-083000-J10J",
      ptoType: "PTO",
      startDate: "2026-08-14",
      endDate: "2026-08-14",
      status: "Cancelled",
      requesterName: "Ana Employee",
      requesterEmail: "ana.employee@example.test",
      managerName: "Michelle Approver",
      managerEmail: "michelle.approver@example.test",
      approverName: "Michelle Approver",
      approverEmail: "michelle.approver@example.test",
      submittedByName: "Ana Employee",
      submittedByEmail: "ana.employee@example.test",
      submittedAt: "2026-07-22T08:30:00.000Z",
      noticeDays: 23,
      isShortNotice: false,
      onBehalf: false,
      fields: {
        Reason: "Cancelled sample.",
        BackupContactName: "",
        BackupContactEmail: "",
        RequestMode: "Self",
        OnBehalf: false,
        SubmittedByName: "Ana Employee",
        SubmittedByEmail: "ana.employee@example.test",
        ApproverName: "Michelle Approver",
        ApproverEmail: "michelle.approver@example.test",
        AuditLog: "[2026-07-22T08:30:00.000Z] Created by Ana Employee — Cancelled",
      },
    },
    {
      id: "preview-11",
      requestKey: "PTO-20260720-083000-K11K",
      ptoType: "Other Leave",
      startDate: "2026-08-05",
      endDate: "2026-08-05",
      status: "Rejected",
      requesterName: "Ana Employee",
      requesterEmail: "ana.employee@example.test",
      managerName: "Michelle Approver",
      managerEmail: "michelle.approver@example.test",
      approverName: "Michelle Approver",
      approverEmail: "michelle.approver@example.test",
      submittedByName: "Ana Employee",
      submittedByEmail: "ana.employee@example.test",
      submittedAt: "2026-07-20T08:30:00.000Z",
      noticeDays: 16,
      isShortNotice: false,
      onBehalf: false,
      fields: {
        Reason: "Rejected sample.",
        BackupContactName: "",
        BackupContactEmail: "",
        RequestMode: "Self",
        OnBehalf: false,
        SubmittedByName: "Ana Employee",
        SubmittedByEmail: "ana.employee@example.test",
        ApproverName: "Michelle Approver",
        ApproverEmail: "michelle.approver@example.test",
        AuditLog: "[2026-07-20T08:30:00.000Z] Created by Ana Employee — Rejected",
      },
    },
    {
      id: "preview-12",
      requestKey: "PTO-20260715-083000-L12L",
      ptoType: "PTO",
      startDate: "2026-07-16",
      endDate: "2026-07-17",
      status: "Approved",
      requesterName: "Rod Demo",
      requesterEmail: "rod.demo@example.test",
      managerName: "Michelle Approver",
      managerEmail: "michelle.approver@example.test",
      approverName: "Michelle Approver",
      approverEmail: "michelle.approver@example.test",
      submittedByName: "Rod Demo",
      submittedByEmail: "rod.demo@example.test",
      submittedAt: "2026-07-15T08:30:00.000Z",
      noticeDays: 1,
      isShortNotice: true,
      onBehalf: false,
      fields: {
        Reason: "Past approved sample.",
        BackupContactName: "Jamie Backup; Sam Backup",
        BackupContactEmail: "jamie.backup@example.test; sam.backup@example.test",
        RequestMode: "Self",
        OnBehalf: false,
        SubmittedByName: "Rod Demo",
        SubmittedByEmail: "rod.demo@example.test",
        ApproverName: "Michelle Approver",
        ApproverEmail: "michelle.approver@example.test",
        AuditLog: "[2026-07-15T08:30:00.000Z] Created by Rod Demo — Approved",
      },
    }
  ];

  var els = {
    signin: $("signin"),
    signout: $("signout"),
    account: $("account"),
    userChip: $("user-chip"),
    userChipName: $("user-chip-name"),
    hrNotice: $("hr-notice"),
    dismissNotice: $("dismiss-notice"),
    toggleFilters: $("toggle-filters"),
    filterToggleLabel: $("filter-toggle-label"),
    filtersPanelBody: $("filters-panel-body"),
    refresh: $("refresh"),
    applyFilters: $("apply-filters"),
    clearFilters: $("clear-filters"),
    exportReport: $("export-report"),
    count: $("count"),
    fSearch: $("f-search"),
    fStatus: $("f-status"),
    fType: $("f-type"),
    fFrom: $("f-from"),
    fTo: $("f-to"),
    fShort: $("f-short"),
    fObo: $("f-obo"),
    ok: $("ok"),
    warn: $("warn"),
    error: $("error"),
    empty: $("empty"),
    table: $("reqs-table"),
    body: $("reqs-body"),
    detailsModal: $("details-modal"),
    detailsModalTitle: $("details-modal-title"),
    detailsModalSubtitle: $("details-modal-subtitle"),
    detailsModalBody: $("details-modal-body"),
    detailsModalClose: $("details-modal-close"),
    cancelPanel: $("cancel-panel"),
    cancelTitle: $("cancel-title"),
    cancelMeta: $("cancel-meta"),
    cancelReasonLabel: $("cancel-reason-label"),
    cancelReason: $("cancel-reason"),
    cancelNote: $("cancel-note"),
    cancelConfirm: $("cancel-confirm"),
    cancelAbort: $("cancel-abort"),
    cancelStatus: $("cancel-status"),
    rowMenu: $("row-menu"),
    pager: $("pager"),
    pageSize: $("page-size"),
    pageRange: $("page-range"),
    pagePrev: $("page-prev"),
    pageNext: $("page-next"),
    pageNums: $("page-nums"),
    activeColumnFilters: $("active-column-filters"),
    filterPopover: $("column-filter-popover"),
    filterPopoverTitle: $("column-filter-title"),
    filterPopoverBody: $("column-filter-body"),
    filterPopoverClose: $("column-filter-close"),
    headerFilterButtons: Array.prototype.slice.call(document.querySelectorAll("[data-column-filter]")),
  };

  var state = {
    // ?preview=1 only activates on localhost/loopback — see PTOUI.isLocalDevHost().
    preview: query.get("preview") === "1" && PTOUI.isLocalDevHost(),
    me: null,
    authorized: false,
    all: [],
    detailsTarget: null,
    detailsReturnFocus: null,
    cancelTarget: null,
    cancelling: false,
    page: 1,
    pageSize: 10,
    menuRequest: null,
    menuAnchor: null,
    popoverColumn: null,
    popoverAnchor: null,
    highlightedId: null,
    linkedRowAligned: false,
    linkedRowRevealed: false,
    directLinkItemId: readLinkedItemId(),
    columnFilters: emptyColumnFilters(),
  };

  var PAST_START_REASON = "Unavailable after PTO start date";
  var COLUMN_FILTERS = {
    requester: {
      title: "Requester",
      kind: "text",
      key: "requester",
      placeholder: "Filter by requester name or email",
    },
    type: {
      title: "Type",
      kind: "select",
      key: "type",
      options: function () { return uniqueValues(state.all, function (r) { return r.ptoType; }); },
    },
    dates: {
      title: "Dates",
      kind: "daterange",
      fromKey: "datesFrom",
      toKey: "datesTo",
      fromLabel: "From",
      toLabel: "To",
    },
    requested: {
      title: "Requested",
      kind: "daterange",
      fromKey: "requestedFrom",
      toKey: "requestedTo",
      fromLabel: "Submitted from",
      toLabel: "Submitted to",
    },
    approver: {
      title: "Approver",
      kind: "text",
      key: "approver",
      placeholder: "Filter by approver name or email",
    },
    status: {
      title: "Status",
      kind: "select",
      key: "status",
      options: function () { return uniqueValues(state.all, function (r) { return r.status; }); },
    },
    notice: {
      title: "Notice",
      kind: "select",
      key: "notice",
      options: function () {
        return [
          { value: "short", label: "Short" },
          { value: "standard", label: "Standard" },
          { value: "blank", label: "Blank" },
        ];
      },
    },
    mode: {
      title: "Mode",
      kind: "select",
      key: "mode",
      options: function () {
        return [
          { value: "self", label: "Self" },
          { value: "on-behalf", label: "On behalf" },
        ];
      },
    },
    submittedBy: {
      title: "Submitted by",
      kind: "text",
      key: "submittedBy",
      placeholder: "Filter by submitter name or email",
    },
  };

  var yearEl = $("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  function emptyColumnFilters() {
    return {
      requester: "",
      type: "",
      datesFrom: "",
      datesTo: "",
      requestedFrom: "",
      requestedTo: "",
      approver: "",
      status: "",
      notice: "",
      mode: "",
      submittedBy: "",
    };
  }

  function friendly(e) {
    return (e && (e.message || e.errorMessage)) ? (e.message || e.errorMessage) : String(e);
  }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  function todayDateOnly() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function truthy(v) {
    return v === true || v === "Yes" || v === "yes" || v === "true" || v === 1;
  }

  function normalizeText(v) {
    return String(v || "").trim().toLowerCase();
  }

  function initials(name, email) {
    var source = String(name || email || "").trim();
    if (!source) return "—";
    var words = source.replace(/[^A-Za-z0-9 ]+/g, " ").trim().split(/\s+/).filter(Boolean);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return source.slice(0, 2).toUpperCase();
  }

  function dateOnly(value) {
    if (!value) return "";
    if (typeof value === "string") {
      var iso = value.slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    }
    var d = new Date(value);
    if (isNaN(d.getTime())) return "";
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function fmtDateTime(value) {
    if (!value) return "—";
    var d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function formatBackupContacts(nameValue, emailValue) {
    var names = String(nameValue || "").split(/\s*;\s*/).filter(Boolean);
    var emails = String(emailValue || "").split(/\s*;\s*/).filter(Boolean);
    if (!names.length && !emails.length) return "";
    if (names.length <= 1 && emails.length <= 1) {
      return (names[0] || "") + (emails[0] ? " <" + emails[0] + ">" : "");
    }
    var out = [];
    var len = Math.max(names.length, emails.length);
    for (var i = 0; i < len; i++) {
      var name = names[i] || "";
      var email = emails[i] || "";
      out.push((name || email) + (email && name ? " <" + email + ">" : ""));
    }
    return out.join("; ");
  }

  function showError(msg) {
    els.error.textContent = msg;
    els.error.style.display = "block";
  }

  function clearError() {
    els.error.textContent = "";
    els.error.style.display = "none";
  }

  function showOk(msg) {
    els.ok.textContent = msg || "";
    els.ok.style.display = msg ? "block" : "none";
  }

  function showWarn(msg) {
    els.warn.textContent = msg || "";
    els.warn.style.display = msg ? "block" : "none";
  }

  function metaOf(r) { return PTORequests.readSubmitMetadata(r.fields); }
  function approverOf(r) { return PTORequests.readApproverMetadata(r.fields); }

  function approverOverrideTruthy(am) {
    return am.ApproverOverride === true || am.ApproverOverride === "Yes" ||
      am.ApproverOverride === "yes" || am.ApproverOverride === 1;
  }

  function getApproverDisplay(r) {
    var am = approverOf(r);
    return {
      name: am.ApproverName || r.approverName || r.managerName || "",
      email: am.ApproverEmail || r.approverEmail || r.managerEmail || "",
    };
  }

  function submittedByDisplay(r) {
    var meta = metaOf(r);
    return {
      name: meta.SubmittedByName || r.submittedByName || "",
      email: meta.SubmittedByEmail || r.submittedByEmail || "",
    };
  }

  function modeValueOf(r) {
    var meta = metaOf(r);
    var onBehalf = truthy(meta.OnBehalf) || meta.RequestMode === "On behalf of" || truthy(r.onBehalf);
    return onBehalf ? "on-behalf" : "self";
  }

  function modeLabelOf(r) {
    return modeValueOf(r) === "on-behalf" ? "On behalf" : "Self";
  }

  function noticeCategory(r) {
    if (truthy(r.isShortNotice)) return "short";
    if (r.noticeDays === undefined || r.noticeDays === null || r.noticeDays === "") return "blank";
    return "standard";
  }

  function daysLabel(start, end) {
    var s = new Date(start);
    var e = new Date(end || start);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return "";
    var startMid = new Date(s.getFullYear(), s.getMonth(), s.getDate());
    var endMid = new Date(e.getFullYear(), e.getMonth(), e.getDate());
    var diff = Math.round((endMid - startMid) / 86400000) + 1;
    if (diff <= 0) return "";
    return diff + " day" + (diff === 1 ? "" : "s");
  }

  function isPastStart(r) {
    var start = String(r.startDate || "").slice(0, 10);
    if (!start) return false;
    return start <= todayDateOnly();
  }

  // HR/Admin direct cancellation is an operational override: it applies to
  // Approved / Auto-Approved / Auto-Approved (Escalation) regardless of
  // StartDate/EndDate. Pending is excluded — it's resolved via the approval
  // action instead. See PTORequests.HR_CANCELLABLE_STATUSES.
  function cancellable(r) {
    return PTORequests.HR_CANCELLABLE_STATUSES.indexOf(String(r.status || "").trim()) !== -1;
  }

  // A request sits in "Cancellation Requested" until HR either confirms it
  // (-> Cancelled) or declines it (-> restored to StatusBeforeCancellationRequest).
  // Not gated on isPastStart(): resolving a request HR is already reviewing
  // should not depend on whether the PTO start date has since passed.
  function pendingCancellationResolution(r) {
    return String(r.status || "").trim() === PTORequests.CANCELLATION_REQUEST_PENDING_STATUS;
  }

  // HISTORICAL RECORDS ONLY. PTO Central stopped auto-approving Sick (and
  // everything else) on 2026-08-19 — no NEW request can match this. It is kept
  // so Sick requests auto-approved BEFORE that date still render correctly in
  // HR Center: there is no approval decision to link to on such a record, so
  // the row's "Approval" action stays hidden. Read-side only; writes nothing.
  function isSickAutoApproved(r) {
    return String(r.ptoType || "").trim().toLowerCase() === "sick" && r.status === "Auto-Approved";
  }

  function requestOverlapsRange(start, end, from, to) {
    var startValue = dateOnly(start);
    var endValue = dateOnly(end || start);
    if (!startValue && !endValue) return false;
    if (!startValue) startValue = endValue;
    if (!endValue) endValue = startValue;
    if (from && endValue < from) return false;
    if (to && startValue > to) return false;
    return true;
  }

  function matchesTextFilter(query, parts) {
    if (!query) return true;
    var hay = parts.map(function (part) { return normalizeText(part); }).join(" | ");
    return hay.indexOf(query) !== -1;
  }

  function matchesFilters(r) {
    var q = normalizeText(els.fSearch.value);
    if (q) {
      if (!matchesTextFilter(q, [
        r.requestKey,
        r.requesterName,
        r.requesterEmail,
        r.submittedByName,
        r.submittedByEmail,
      ])) return false;
    }

    var status = els.fStatus.value;
    if (status !== "All" && String(r.status || "") !== status) return false;

    var type = els.fType.value;
    if (type !== "All" && String(r.ptoType || "") !== type) return false;

    var start = dateOnly(r.startDate);
    if (els.fFrom.value && (!start || start < els.fFrom.value)) return false;
    if (els.fTo.value && (!start || start > els.fTo.value)) return false;

    if (els.fShort.checked && !truthy(r.isShortNotice)) return false;
    if (els.fObo.checked && modeValueOf(r) !== "on-behalf") return false;

    var cf = state.columnFilters;
    if (cf.requester && !matchesTextFilter(normalizeText(cf.requester), [r.requesterName, r.requesterEmail])) return false;
    if (cf.type && String(r.ptoType || "") !== cf.type) return false;
    if ((cf.datesFrom || cf.datesTo) && !requestOverlapsRange(r.startDate, r.endDate, cf.datesFrom, cf.datesTo)) return false;

    var submitted = dateOnly(r.submittedAt);
    if (cf.requestedFrom && (!submitted || submitted < cf.requestedFrom)) return false;
    if (cf.requestedTo && (!submitted || submitted > cf.requestedTo)) return false;

    var approver = getApproverDisplay(r);
    if (cf.approver && !matchesTextFilter(normalizeText(cf.approver), [approver.name, approver.email])) return false;
    if (cf.status && String(r.status || "") !== cf.status) return false;
    if (cf.notice && noticeCategory(r) !== cf.notice) return false;
    if (cf.mode && modeValueOf(r) !== cf.mode) return false;

    var submittedBy = submittedByDisplay(r);
    if (cf.submittedBy && !matchesTextFilter(normalizeText(cf.submittedBy), [submittedBy.name, submittedBy.email])) return false;

    return true;
  }

  function renderAuth() {
    var acct = PTOAuth.getAccount();
    var signedIn = !!acct;
    var previewSignedIn = state.preview && !signedIn;
    var effectiveSignedIn = signedIn || previewSignedIn;
    var name = signedIn
      ? (acct.name || acct.username || acct.homeAccountId || "Signed in")
      : previewSignedIn
        ? "Rod Demo"
        : "Not signed in";
    els.signin.disabled = signedIn || state.preview;
    els.signout.disabled = !signedIn;
    els.refresh.disabled = !effectiveSignedIn || !state.authorized;
    els.exportReport.disabled = !effectiveSignedIn || !state.authorized;
    els.account.textContent = signedIn
      ? "Signed in as " + (acct.username || acct.name || acct.homeAccountId)
      : previewSignedIn
        ? "Preview mode"
        : "Not signed in.";

    if (els.userChip) {
      els.userChip.classList.toggle("show", effectiveSignedIn);
      els.userChip.setAttribute("aria-hidden", effectiveSignedIn ? "false" : "true");
    }
    if (els.userChipName) els.userChipName.textContent = name;
  }

  function clonePreviewItems() {
    return JSON.parse(JSON.stringify(PREVIEW_ITEMS)).map(function (item) {
      item.webUrl = item.webUrl || ("https://example.test/pto-request/" + item.id);
      item.etag = item.etag || ('W/"' + item.id + '"');
      return item;
    });
  }

  function uniqueValues(items, picker) {
    var seen = {};
    items.forEach(function (item) {
      var value = String((picker(item) || "")).trim();
      if (!value) return;
      seen[value] = true;
    });
    return Object.keys(seen).sort(function (a, b) { return a.localeCompare(b); }).map(function (value) {
      return { value: value, label: value };
    });
  }

  function replaceSelectOptions(select, options, selected, allLabel) {
    var current = selected || select.value || "All";
    select.innerHTML = "";
    if (allLabel) {
      select.appendChild(PTOUI.el("option", { value: "All" }, allLabel));
    }
    options.forEach(function (option) {
      select.appendChild(PTOUI.el("option", { value: option.value }, option.label));
    });
    select.value = current;
    if (select.value !== current && allLabel) select.value = "All";
  }

  function populateFilterOptions() {
    replaceSelectOptions(els.fStatus, uniqueValues(state.all, function (r) { return r.status; }), els.fStatus.value, "All");
    replaceSelectOptions(els.fType, uniqueValues(state.all, function (r) { return r.ptoType; }), els.fType.value, "All");
  }

  function renderHeaderFilterState() {
    els.headerFilterButtons.forEach(function (button) {
      var column = button.getAttribute("data-column-filter");
      var active = columnHasValue(column);
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function columnHasValue(column) {
    var def = COLUMN_FILTERS[column];
    if (!def) return false;
    if (def.kind === "daterange") {
      return !!(state.columnFilters[def.fromKey] || state.columnFilters[def.toKey]);
    }
    return !!state.columnFilters[def.key];
  }

  function clearColumnFilter(column) {
    var def = COLUMN_FILTERS[column];
    if (!def) return;
    if (def.kind === "daterange") {
      state.columnFilters[def.fromKey] = "";
      state.columnFilters[def.toKey] = "";
    } else {
      state.columnFilters[def.key] = "";
    }
  }

  function columnFilterSummary(column) {
    var def = COLUMN_FILTERS[column];
    if (!def || !columnHasValue(column)) return "";
    if (def.kind === "daterange") {
      var from = state.columnFilters[def.fromKey];
      var to = state.columnFilters[def.toKey];
      if (from && to) return def.title + ": " + from + " to " + to;
      if (from) return def.title + ": from " + from;
      return def.title + ": through " + to;
    }
    var raw = state.columnFilters[def.key];
    var label = raw;
    if (column === "mode") label = raw === "on-behalf" ? "On behalf" : "Self";
    if (column === "notice") {
      label = raw === "short" ? "Short" : raw === "standard" ? "Standard" : "Blank";
    }
    return def.title + ": " + label;
  }

  function renderActiveColumnFilterChips() {
    els.activeColumnFilters.innerHTML = "";
    var activeColumns = Object.keys(COLUMN_FILTERS).filter(columnHasValue);
    els.activeColumnFilters.classList.toggle("show", activeColumns.length > 0);
    activeColumns.forEach(function (column) {
      var chip = PTOUI.el("span", { class: "filter-chip" }, [
        columnFilterSummary(column),
        PTOUI.el("button", {
          type: "button",
          "aria-label": "Clear " + COLUMN_FILTERS[column].title + " filter",
          onClick: function () {
            clearColumnFilter(column);
            resetToFirstPage();
          },
        }, "×"),
      ]);
      els.activeColumnFilters.appendChild(chip);
    });
  }

  function personCell(name, email, withAvatar) {
    var primary = PTOUI.el("span", { class: "table-primary" }, name || email || "—");
    var secondary = email && name ? PTOUI.el("span", { class: "table-secondary" }, email) : null;
    if (!withAvatar) {
      return PTOUI.el("td", null, PTOUI.el("div", { class: "table-stack" }, [primary, secondary]));
    }
    return PTOUI.el("td", null, PTOUI.el("div", { class: "table-person" }, [
      PTOUI.el("span", { class: "table-person__avatar", "aria-hidden": "true" }, initials(name, email)),
      PTOUI.el("div", { class: "table-person__body" }, [primary, secondary]),
    ]));
  }

  function stackCell(primaryText, secondaryText, className) {
    return PTOUI.el("td", className ? { class: className } : null, PTOUI.el("div", { class: "table-stack" }, [
      PTOUI.el("span", { class: "table-primary" }, primaryText || "—"),
      secondaryText ? PTOUI.el("span", { class: "table-secondary" }, secondaryText) : null,
    ]));
  }

  function detailsContent(r) {
    var f = r.fields || {};
    var meta = metaOf(r);
    var am = approverOf(r);
    var approverEmail = am.ApproverEmail || r.approverEmail || r.managerEmail || "";
    var approverName = am.ApproverName || r.approverName || r.managerName || "";

    var dl = PTOUI.el("dl", { class: "details-grid" });

    function item(label, value, spanAll) {
      var wrap = PTOUI.el("div", spanAll ? { class: "span-all" } : null);
      wrap.appendChild(PTOUI.el("dt", null, label));
      var dd = PTOUI.el("dd", null);
      if (value instanceof Node) dd.appendChild(value);
      else dd.textContent = (value === undefined || value === null || value === "") ? "—" : String(value);
      wrap.appendChild(dd);
      dl.appendChild(wrap);
    }

    item("Request key", r.requestKey || ("#" + r.id));
    item("Reason / notes", f.Reason);
    item("Backup contact", formatBackupContacts(f.BackupContactName, f.BackupContactEmail).trim() || "—");
    item("Partial day / hours", f.IsPartialDay ? ("Yes" + (f.Hours ? " (" + f.Hours + " hrs)" : "")) : "No");
    item("Notice days", (r.noticeDays === undefined || r.noticeDays === null) ? "—" : r.noticeDays);
    item("Urgent", truthy(r.isUrgent) ? "Yes" : "No");
    item("Request mode", meta.RequestMode || (truthy(meta.OnBehalf) ? "On behalf of" : "Self"));
    item("On-behalf reason", meta.OnBehalfReason);
    item("Submitted by", ((meta.SubmittedByName || "") + (meta.SubmittedByEmail ? " <" + meta.SubmittedByEmail + ">" : "")).trim() || "—");
    item("Decision", f.DecisionByName
      ? f.Status + " by " + f.DecisionByName + (f.DecisionDate ? " on " + fmtDateTime(f.DecisionDate) : "")
      : "—");
    item("Approver", ((approverName || "") + (approverEmail ? " <" + approverEmail + ">" : "")).trim() || "—");

    if (approverOverrideTruthy(am)) {
      var originalMgr = ((am.OriginalManagerName || r.managerName || "") +
        (am.OriginalManagerEmail ? " <" + am.OriginalManagerEmail + ">" : "")).trim() || "—";
      item("Approver override", "Yes — routed from manager " + originalMgr +
        (am.ApproverOverrideReason ? " — reason: " + am.ApproverOverrideReason : ""), true);
    }

    if (r.webUrl) {
      item("SharePoint item", PTOUI.el("a", { href: r.webUrl, target: "_blank", rel: "noopener noreferrer" }, "Open list item"));
    }

    var auditWrap = PTOUI.el("div", { class: "span-all" });
    auditWrap.appendChild(PTOUI.el("dt", null, "Audit log"));
    auditWrap.appendChild(PTOUI.el("pre", { class: "audit" }, f.AuditLog || "—"));
    dl.appendChild(auditWrap);

    return dl;
  }

  function modalFocusables() {
    if (!els.detailsModal) return [];
    return Array.prototype.filter.call(
      els.detailsModal.querySelectorAll(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), ' +
        'select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ),
      function (node) {
        return !node.hidden && node.getAttribute("aria-hidden") !== "true";
      }
    );
  }

  function openDetailsModal(r, triggerEl) {
    if (!r || !els.detailsModal) return;
    state.detailsTarget = r;
    state.detailsReturnFocus =
      triggerEl ||
      state.menuAnchor ||
      document.activeElement ||
      state.detailsReturnFocus ||
      null;
    if (els.detailsModalTitle) {
      els.detailsModalTitle.textContent = r.requestKey || "PTO request";
    }
    if (els.detailsModalSubtitle) {
      els.detailsModalSubtitle.textContent =
        (r.requesterName || r.requesterEmail || "Unknown requester") +
        " · " + (r.ptoType || "PTO") +
        " · " + PTOUI.formatRange(r.startDate, r.endDate);
    }
    if (els.detailsModalBody) {
      els.detailsModalBody.innerHTML = "";
      els.detailsModalBody.appendChild(detailsContent(r));
    }
    els.detailsModal.hidden = false;
    els.detailsModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    if (els.detailsModalClose) els.detailsModalClose.focus();
  }

  function closeDetailsModal() {
    if (!els.detailsModal) return;
    els.detailsModal.hidden = true;
    els.detailsModal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    state.detailsTarget = null;
    var returnFocus = state.detailsReturnFocus;
    state.detailsReturnFocus = null;
    if (returnFocus && typeof returnFocus.focus === "function" && document.contains(returnFocus)) {
      returnFocus.focus();
    }
  }

  var KEBAB_SVG =
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
    '<circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>';

  function rowKebab(r) {
    var btn = PTOUI.el("button", {
      class: "kebab",
      type: "button",
      "aria-haspopup": "menu",
      "aria-expanded": "false",
      "aria-label": "Actions for " + (r.requestKey || ("#" + r.id)),
      html: KEBAB_SVG,
    });
    btn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      toggleRowMenu(btn, r);
    });
    return btn;
  }

  function renderTable() {
    closeRowMenu();
    closeColumnPopover();

    var filtered = state.all.filter(matchesFilters);
    var total = filtered.length;

    if (state.highlightedId) {
      var highlightedIndex = filtered.findIndex(function (r) { return String(r.id) === String(state.highlightedId); });
      if (highlightedIndex >= 0 && state.pageSize !== Infinity) {
        var desiredPage = Math.floor(highlightedIndex / state.pageSize) + 1;
        if (!state.linkedRowAligned || state.page !== desiredPage) {
          state.page = desiredPage;
          state.linkedRowAligned = true;
        }
      }
    }

    var size = state.pageSize;
    var pageCount = size === Infinity ? 1 : Math.max(1, Math.ceil(total / size));
    if (state.page > pageCount) state.page = pageCount;
    if (state.page < 1) state.page = 1;
    var startIdx = size === Infinity ? 0 : (state.page - 1) * size;
    var endIdx = size === Infinity ? total : Math.min(total, startIdx + size);
    var pageRows = filtered.slice(startIdx, endIdx);

    els.body.innerHTML = "";
    pageRows.forEach(function (r) {
      var approver = getApproverDisplay(r);
      var submittedBy = submittedByDisplay(r);
      var requestedSecondary = r.requestKey ? r.requestKey : "";
      var dateSecondary = daysLabel(r.startDate, r.endDate);

      var tr = PTOUI.el("tr", state.highlightedId && String(state.highlightedId) === String(r.id) ? {
        class: "row-highlight",
        "data-row-id": r.id,
      } : { "data-row-id": r.id }, [
        personCell(r.requesterName, r.requesterEmail, true),
        stackCell(r.ptoType || "—", ""),
        stackCell(PTOUI.formatRange(r.startDate, r.endDate), dateSecondary, "cell-tight"),
        stackCell(fmtDateTime(r.submittedAt), requestedSecondary, "cell-tight"),
        personCell(approver.name, approver.email, false),
        PTOUI.el("td", { class: "cell-status" }, PTOUI.statusBadge(r.status)),
        truthy(r.isShortNotice)
          ? PTOUI.el("td", { class: "flag-short" }, "Short")
          : PTOUI.el("td", { class: "flag-none" }, "—"),
        PTOUI.el("td", { class: modeValueOf(r) === "on-behalf" ? "mode-obo" : "mode-self" }, modeLabelOf(r)),
        personCell(submittedBy.name, submittedBy.email, false),
        PTOUI.el("td", { class: "cell-actions" }, rowKebab(r)),
      ]);

      els.body.appendChild(tr);
    });

    els.table.style.display = total ? "" : "none";
    els.empty.style.display = total ? "none" : "block";
    els.empty.textContent = state.all.length
      ? "No requests match the current filters."
      : "No PTO requests found.";
    els.count.textContent = state.all.length
      ? total + " filtered from " + state.all.length + " live requests"
      : "";

    renderPager(total, startIdx, endIdx, pageCount);
    renderHeaderFilterState();
    renderActiveColumnFilterChips();
    revealLinkedRowIfNeeded();
  }

  function pageWindow(cur, totalPages) {
    var out = [];
    if (totalPages <= 7) {
      for (var i = 1; i <= totalPages; i++) out.push(i);
      return out;
    }
    out.push(1);
    var s = Math.max(2, cur - 1);
    var e = Math.min(totalPages - 1, cur + 1);
    if (s > 2) out.push("…");
    for (var j = s; j <= e; j++) out.push(j);
    if (e < totalPages - 1) out.push("…");
    out.push(totalPages);
    return out;
  }

  function renderPager(total, startIdx, endIdx, pageCount) {
    if (!total) {
      els.pager.style.display = "none";
      els.pageRange.textContent = "";
      return;
    }
    els.pager.style.display = "flex";
    els.pageRange.textContent = "Showing " + (startIdx + 1) + "–" + endIdx + " of " + total + " requests";
    els.pagePrev.disabled = state.page <= 1;
    els.pageNext.disabled = state.page >= pageCount;

    els.pageNums.innerHTML = "";
    pageWindow(state.page, pageCount).forEach(function (p) {
      if (p === "…") {
        els.pageNums.appendChild(PTOUI.el("span", { class: "page-ellipsis" }, "…"));
        return;
      }
      var b = PTOUI.el("button", {
        class: "page-btn" + (p === state.page ? " active" : ""),
        type: "button",
        "aria-label": "Page " + p,
        "aria-current": p === state.page ? "page" : null,
      }, String(p));
      b.addEventListener("click", function () { goToPage(p); });
      els.pageNums.appendChild(b);
    });
  }

  function goToPage(page) {
    state.page = page;
    renderTable();
  }

  function resetToFirstPage() {
    state.page = 1;
    state.linkedRowAligned = false;
    renderTable();
  }

  var EXPORT_HEADERS = [
    "Request Key", "Requester Name", "Requester Email", "PTO Type",
    "Start Date", "End Date", "Date Requested", "Approver Name", "Approver Email",
    "Status", "Short Notice", "Notice Days", "Request Mode",
    "Submitted By Name", "Submitted By Email", "Backup Contact", "Reason",
    "On Behalf Reason", "SharePoint Item Link",
    "Original Manager Name", "Original Manager Email",
  ];

  function csvField(value) {
    var s = (value === undefined || value === null) ? "" : String(value);
    if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function exportRowToCsv(r) {
    var f = r.fields || {};
    var meta = metaOf(r);
    var approver = getApproverDisplay(r);
    var am = approverOf(r);
    var backup = formatBackupContacts(f.BackupContactName, f.BackupContactEmail).trim();

    return [
      r.requestKey || ("#" + r.id),
      r.requesterName || "",
      r.requesterEmail || "",
      r.ptoType || "",
      String(r.startDate || "").slice(0, 10),
      String(r.endDate || "").slice(0, 10),
      fmtDateTime(r.submittedAt),
      approver.name || "",
      approver.email || "",
      r.status || "",
      truthy(r.isShortNotice) ? "Yes" : "No",
      (r.noticeDays === undefined || r.noticeDays === null) ? "" : r.noticeDays,
      meta.RequestMode || (modeValueOf(r) === "on-behalf" ? "On behalf of" : "Self"),
      meta.SubmittedByName || r.submittedByName || "",
      meta.SubmittedByEmail || r.submittedByEmail || "",
      backup,
      f.Reason || "",
      meta.OnBehalfReason || "",
      r.webUrl || "",
      am.OriginalManagerName || r.managerName || "",
      am.OriginalManagerEmail || r.managerEmail || "",
    ].map(csvField).join(",");
  }

  function exportReport() {
    clearError();
    var rows = state.all.filter(matchesFilters);
    var lines = [EXPORT_HEADERS.map(csvField).join(",")];
    rows.forEach(function (r) { lines.push(exportRowToCsv(r)); });
    var csv = lines.join("\r\n");
    var blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);

    var a = document.createElement("a");
    a.href = url;
    a.download = "PTO-Central-HR-Report-" + todayDateOnly() + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    showOk("Exported " + rows.length + " request(s) matching the current filters.");
  }

  function menuItem(act) {
    return els.rowMenu.querySelector('[data-act="' + act + '"]');
  }

  function setMenuItemDisabled(node, disabled, reason) {
    if (disabled) {
      node.setAttribute("aria-disabled", "true");
      node.setAttribute("title", reason || PAST_START_REASON);
      if ("disabled" in node) node.disabled = true;
    } else {
      node.removeAttribute("aria-disabled");
      node.removeAttribute("title");
      if ("disabled" in node) node.disabled = false;
    }
  }

  function toggleRowMenu(anchor, r) {
    if (!els.rowMenu.hidden && state.menuAnchor === anchor) {
      closeRowMenu(true);
      return;
    }
    openRowMenu(anchor, r);
  }

  function openRowMenu(anchor, r) {
    closeColumnPopover();
    state.menuRequest = r;
    state.menuAnchor = anchor;

    var past = isPastStart(r);
    var sickAutoApproved = isSickAutoApproved(r);
    var approvalEl = menuItem("approval");
    var cancelEl = menuItem("cancel");
    var cancelSepEl = menuItem("cancel-sep");
    var canCancel = cancellable(r);
    var pendingCancellation = pendingCancellationResolution(r);
    var resolveSepEl = menuItem("resolve-sep");
    var resolveConfirmEl = menuItem("resolve-confirm");
    var resolveDeclineEl = menuItem("resolve-decline");

    approvalEl.style.display = sickAutoApproved ? "none" : "";
    if (sickAutoApproved) {
      approvalEl.removeAttribute("href");
      setMenuItemDisabled(approvalEl, false);
    } else if (past) {
      approvalEl.removeAttribute("href");
      setMenuItemDisabled(approvalEl, true);
    } else {
      approvalEl.setAttribute("href", PTOLinks.relativeApprovalUrl(r.id));
      setMenuItemDisabled(approvalEl, false);
    }

    cancelEl.style.display = canCancel ? "" : "none";
    cancelSepEl.style.display = canCancel ? "" : "none";
    // HR/Admin cancellation is an operational override — never disabled by
    // StartDate/EndDate (unlike the approval action above).
    if (canCancel) setMenuItemDisabled(cancelEl, false);

    resolveSepEl.style.display = pendingCancellation ? "" : "none";
    resolveConfirmEl.style.display = pendingCancellation ? "" : "none";
    resolveDeclineEl.style.display = pendingCancellation ? "" : "none";
    if (pendingCancellation) {
      setMenuItemDisabled(resolveConfirmEl, false);
      setMenuItemDisabled(resolveDeclineEl, false);
    }

    els.rowMenu.hidden = false;
    positionFloatingPanel(els.rowMenu, anchor, 8);
    anchor.setAttribute("aria-expanded", "true");

    var first = firstVisibleMenuItem();
    if (first) first.focus();
  }

  function closeRowMenu(refocus) {
    if (els.rowMenu.hidden) return;
    els.rowMenu.hidden = true;
    var anchor = state.menuAnchor;
    if (anchor) anchor.setAttribute("aria-expanded", "false");
    state.menuAnchor = null;
    state.menuRequest = null;
    if (refocus && anchor && document.contains(anchor)) anchor.focus();
  }

  function visibleMenuItems() {
    return Array.prototype.filter.call(
      els.rowMenu.querySelectorAll(".row-menu-item"),
      function (n) { return n.style.display !== "none" && n.getAttribute("aria-disabled") !== "true"; }
    );
  }

  function firstVisibleMenuItem() {
    return visibleMenuItems()[0] || null;
  }

  function positionFloatingPanel(panel, anchor, gutter) {
    gutter = gutter || 8;
    panel.hidden = false;
    var rect = anchor.getBoundingClientRect();
    var width = panel.offsetWidth;
    var height = panel.offsetHeight;
    var left = Math.max(gutter, Math.min(rect.left, window.innerWidth - width - gutter));
    var top = rect.bottom + 8;
    if (top + height > window.innerHeight - gutter) {
      top = Math.max(gutter, rect.top - height - 8);
    }
    panel.style.left = left + "px";
    panel.style.top = top + "px";
  }

  var CANCEL_PANEL_COPY = {
    "cancel": {
      title: "Cancel this PTO request",
      reasonLabel: "Cancellation reason (recorded in the audit log)",
      reasonPlaceholder: "Explain why this request is being cancelled",
      confirmLabel: "Confirm cancellation",
      note: "This updates the request status to Cancelled and appends the audit log. " +
        "The existing calendar-cancellation flow will remove any available events automatically. " +
        "HR/Admin can cancel approved PTO requests regardless of the scheduled dates.",
    },
    "resolve-confirm": {
      title: "Complete this cancellation request?",
      reasonLabel: "Note for the audit log (optional)",
      reasonPlaceholder: "Optional note about completing this cancellation",
      confirmLabel: "Complete cancellation",
      note: "This updates the request status to Cancelled and appends the audit log. " +
        "Approved requests continue using the existing calendar-cancellation flow.",
    },
    "resolve-decline": {
      title: "Decline this cancellation request?",
      reasonLabel: "Note for the audit log (optional)",
      reasonPlaceholder: "Optional note about declining this cancellation request",
      confirmLabel: "Decline & restore",
      note: "This restores the request to its status before the cancellation request " +
        "and appends the audit log. Existing calendar events and notifications are left untouched.",
    },
  };

  function openCancelPanel(r, mode) {
    mode = CANCEL_PANEL_COPY[mode] ? mode : "cancel";
    state.cancelTarget = r;
    state.cancelMode = mode;
    var copy = CANCEL_PANEL_COPY[mode];

    var restoreNote = mode === "resolve-decline"
      ? " · will restore to " + (r.statusBeforeCancellationRequest || "the prior status")
      : "";
    els.cancelTitle.textContent = copy.title;
    els.cancelReasonLabel.textContent = copy.reasonLabel;
    els.cancelReason.placeholder = copy.reasonPlaceholder;
    els.cancelConfirm.textContent = copy.confirmLabel;
    if (els.cancelNote) els.cancelNote.textContent = copy.note;
    els.cancelMeta.textContent =
      (r.requestKey || ("#" + r.id)) + " — " +
      (r.requesterName || r.requesterEmail || "unknown requester") + " · " +
      (r.ptoType || "?") + " · " + PTOUI.formatRange(r.startDate, r.endDate) +
      " · current status: " + (r.status || "?") + restoreNote;
    els.cancelReason.value = "";
    els.cancelStatus.textContent = "";
    els.cancelPanel.style.display = "block";
    els.cancelPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    els.cancelReason.focus();
  }

  function closeCancelPanel() {
    state.cancelTarget = null;
    state.cancelMode = null;
    els.cancelPanel.style.display = "none";
    els.cancelStatus.textContent = "";
  }

  async function onConfirmCancel() {
    var r = state.cancelTarget;
    var mode = state.cancelMode || "cancel";
    if (!r || state.cancelling) return;

    clearError();
    showOk("");

    if (mode === "cancel") {
      // HR/Admin cancellation is an operational override — deliberately not
      // gated on StartDate/EndDate here (past, present, or future PTO all
      // cancel the same way). Only status eligibility is re-checked.
      if (!cancellable(r)) {
        showError("This request can no longer be cancelled (status: " + r.status + ").");
        closeCancelPanel();
        return;
      }
    } else if (!pendingCancellationResolution(r)) {
      showError(
        (r.requestKey || ("#" + r.id)) + " is no longer pending cancellation review (status: " + r.status + ")."
      );
      closeCancelPanel();
      return;
    }

    state.cancelling = true;
    els.cancelConfirm.disabled = true;
    els.cancelAbort.disabled = true;
    els.cancelStatus.textContent = mode === "cancel" ? "Cancelling…" : "Saving…";
    try {
      if (mode === "cancel") {
        if (state.preview) {
          var previewLine = "[" + new Date().toISOString() + "] Cancelled by Rod Demo — HR Center cancellation — reason: " +
            (els.cancelReason.value || "no reason given");
          r.status = "Cancelled";
          r.fields = Object.assign({}, r.fields, {
            Status: "Cancelled",
            AuditLog: (r.fields && r.fields.AuditLog ? r.fields.AuditLog + "\n" : "") + previewLine,
          });
        } else {
          var result = await PTORequests.cancelRequest(r.id, {
            actor: state.me,
            reason: els.cancelReason.value,
            currentStatus: r.status,
            existingAuditLog: (r.fields && r.fields.AuditLog) || "",
          });
          r.status = "Cancelled";
          r.fields = Object.assign({}, r.fields, result.fields);
        }
        closeCancelPanel();
        renderTable();
        showOk(
          (r.requestKey || ("#" + r.id)) + " cancelled. Audit log updated. " +
          "If it was approved, the calendar events will be removed automatically by the existing cancellation flow."
        );
      } else {
        var action = mode === "resolve-confirm" ? "confirm" : "decline";
        if (state.preview) {
          var actorLabel = "Rod Demo";
          var reasonText = els.cancelReason.value || "";
          if (action === "confirm") {
            var confirmLine = "[" + new Date().toISOString() + "] Cancelled by " + actorLabel +
              " — HR confirmed employee cancellation request" + (reasonText ? " — " + reasonText : "");
            r.status = "Cancelled";
            r.fields = Object.assign({}, r.fields, {
              Status: "Cancelled",
              AuditLog: (r.fields && r.fields.AuditLog ? r.fields.AuditLog + "\n" : "") + confirmLine,
            });
          } else {
            var restoreStatus = r.statusBeforeCancellationRequest || "Approved";
            var declineLine = "[" + new Date().toISOString() + "] " + restoreStatus + " by " + actorLabel +
              " — HR declined employee cancellation request — restored to " + restoreStatus +
              (reasonText ? " — " + reasonText : "");
            r.status = restoreStatus;
            r.fields = Object.assign({}, r.fields, {
              Status: restoreStatus,
              AuditLog: (r.fields && r.fields.AuditLog ? r.fields.AuditLog + "\n" : "") + declineLine,
            });
          }
        } else {
          var resolveResult = await PTORequests.resolveCancellationRequest(r.id, {
            action: action,
            actor: state.me,
            reason: els.cancelReason.value,
            currentStatus: r.status,
            statusBeforeCancellationRequest: r.statusBeforeCancellationRequest,
            existingAuditLog: (r.fields && r.fields.AuditLog) || "",
            ifMatch: r.etag,
          });
          r.status = resolveResult.fields.Status;
          r.fields = Object.assign({}, r.fields, resolveResult.fields);
        }
        closeCancelPanel();
        renderTable();
        showOk(
          action === "confirm"
            ? (r.requestKey || ("#" + r.id)) + " cancelled. Audit log updated. " +
              "The existing cancellation flow will remove any calendar events automatically."
            : (r.requestKey || ("#" + r.id)) + " restored to " + r.status + ". Audit log updated. " +
              "Existing calendar events and notifications are untouched."
        );
      }
    } catch (e) {
      els.cancelStatus.textContent = "";
      showError(
        (mode === "cancel" ? "Could not cancel " : "Could not resolve ") +
        (r.requestKey || ("#" + r.id)) + ": " + friendly(e)
      );
    } finally {
      state.cancelling = false;
      els.cancelConfirm.disabled = false;
      els.cancelAbort.disabled = false;
    }
  }

  function readLinkedItemId() {
    var loc = window.location;
    var id = null;
    try { id = new URLSearchParams(loc.search || "").get("itemId"); } catch (e) { id = null; }
    if (!id && loc.hash) {
      var hash = loc.hash.replace(/^#/, "").replace(/^\?/, "");
      try { id = new URLSearchParams(hash).get("itemId"); } catch (e2) { id = null; }
      if (!id) {
        var m = /^itemId=(.+)$/.exec(hash);
        if (m) id = decodeURIComponent(m[1]);
      }
    }
    return id ? String(id).trim() : "";
  }

  async function ensureDirectLinkedRequestLoaded() {
    if (!state.directLinkItemId) return;

    var existing = state.all.filter(function (item) {
      return String(item.id) === String(state.directLinkItemId);
    })[0];

    if (!existing) {
      try {
        var raw = await PTORequests.getRequestById(state.directLinkItemId);
        if (raw) {
          var normalized = PTORequests.normalizeRequestItem(raw);
          state.all = [normalized].concat(state.all.filter(function (item) {
            return String(item.id) !== String(normalized.id);
          }));
          existing = normalized;
        }
      } catch (e) {
        showWarn("The linked request " + state.directLinkItemId + " could not be loaded directly: " + friendly(e));
      }
    }

    if (existing) {
      state.highlightedId = existing.id;
      state.linkedRowAligned = false;
      state.linkedRowRevealed = false;
      openDetailsModal(existing);
      showOk("Opened linked record " + (existing.requestKey || ("#" + existing.id)) + ".");
    } else {
      showWarn("Linked request " + state.directLinkItemId + " was not found in the current PTO Requests list.");
    }
  }

  function revealLinkedRowIfNeeded() {
    if (!state.highlightedId || state.linkedRowRevealed) return;
    var row = els.body.querySelector('[data-row-id="' + String(state.highlightedId) + '"]');
    if (!row) return;
    state.linkedRowRevealed = true;
    row.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  }

  async function loadRequests() {
    clearError();
    showOk("");
    showWarn("");
    els.refresh.disabled = true;
    els.count.textContent = "Loading…";
    try {
      if (state.preview) {
        state.me = {
          id: "preview-hr-admin",
          displayName: "Rod Demo",
          mail: "rod.demo@example.test",
          userPrincipalName: "rod.demo@example.test",
        };
        state.authorized = true;
        state.all = clonePreviewItems();
        showWarn("Preview mode: showing sample PTO requests for layout review.");
      } else {
        state.me = await PTODirectory.getMe();
        var az = await PTOAuthz.enforce(state.me);
        state.authorized = az.authorized;
        if (!az.authorized) {
          els.count.textContent = "";
          renderAuth();
          return;
        }

        try { await PTORequests.resolveMetadataFieldMap(); } catch (e) {}
        try { await PTORequests.resolveApproverFieldMap(); } catch (e2) {}
        try { await PTORequests.resolveCancellationRequestFieldMap(); } catch (e3) {}

        var result = await PTORequests.listAllRequests({ top: 200, maxPages: 10 });
        state.all = result.items || [];
        if (result.truncated) {
          showWarn("Showing the " + state.all.length + " most recent requests. Older items beyond the page cap were not loaded.");
        }
      }

      closeDetailsModal();
      populateFilterOptions();
      await ensureDirectLinkedRequestLoaded();
      state.page = 1;
      closeCancelPanel();
      renderTable();
    } catch (e) {
      state.all = [];
      renderTable();
      showError("Could not load requests: " + friendly(e));
    } finally {
      renderAuth();
    }
  }

  function openColumnPopover(anchor, column) {
    var def = COLUMN_FILTERS[column];
    if (!def) return;
    if (state.popoverColumn === column && !els.filterPopover.hidden) {
      closeColumnPopover(true);
      return;
    }

    closeRowMenu();
    state.popoverColumn = column;
    state.popoverAnchor = anchor;
    els.filterPopoverTitle.textContent = def.title;
    els.filterPopoverBody.innerHTML = "";

    if (def.kind === "text") {
      var textWrap = PTOUI.el("div", { class: "popover-grid" }, [
        PTOUI.el("label", { class: "fld" }, [
          PTOUI.el("span", { class: "fld-label" }, def.title),
          PTOUI.el("input", {
            type: "text",
            value: state.columnFilters[def.key] || "",
            placeholder: def.placeholder || "",
            "data-filter-input": "text",
          }),
        ]),
      ]);
      els.filterPopoverBody.appendChild(textWrap);
    } else if (def.kind === "select") {
      var options = def.options();
      var select = PTOUI.el("select", { "data-filter-input": "select" }, [
        PTOUI.el("option", { value: "" }, "All"),
      ]);
      options.forEach(function (option) {
        select.appendChild(PTOUI.el("option", { value: option.value }, option.label));
      });
      select.value = state.columnFilters[def.key] || "";
      els.filterPopoverBody.appendChild(PTOUI.el("div", { class: "popover-grid" }, [
        PTOUI.el("label", { class: "fld" }, [
          PTOUI.el("span", { class: "fld-label" }, def.title),
          select,
        ]),
      ]));
    } else if (def.kind === "daterange") {
      els.filterPopoverBody.appendChild(PTOUI.el("div", { class: "popover-grid" }, [
        PTOUI.el("label", { class: "fld" }, [
          PTOUI.el("span", { class: "fld-label" }, def.fromLabel),
          PTOUI.el("input", {
            type: "date",
            value: state.columnFilters[def.fromKey] || "",
            "data-filter-input": "from",
          }),
        ]),
        PTOUI.el("label", { class: "fld" }, [
          PTOUI.el("span", { class: "fld-label" }, def.toLabel),
          PTOUI.el("input", {
            type: "date",
            value: state.columnFilters[def.toKey] || "",
            "data-filter-input": "to",
          }),
        ]),
      ]));
    }

    var clearBtn = PTOUI.el("button", {
      type: "button",
      class: "popover-action linkish",
      onClick: function () {
        clearColumnFilter(column);
        closeColumnPopover();
        resetToFirstPage();
      },
    }, "Clear");

    var applyBtn = PTOUI.el("button", {
      type: "button",
      class: "popover-action primary",
      onClick: function () {
        applyColumnPopover(column);
      },
    }, "Apply");

    els.filterPopoverBody.appendChild(PTOUI.el("div", { class: "popover-actions" }, [
      clearBtn,
      applyBtn,
    ]));

    els.filterPopover.hidden = false;
    els.filterPopover.setAttribute("aria-hidden", "false");
    positionFloatingPanel(els.filterPopover, anchor, 12);

    var first = els.filterPopoverBody.querySelector("input, select, button");
    if (first) first.focus();
  }

  function applyColumnPopover(column) {
    var def = COLUMN_FILTERS[column];
    if (!def) return;
    if (def.kind === "text") {
      state.columnFilters[def.key] = els.filterPopoverBody.querySelector('[data-filter-input="text"]').value.trim();
    } else if (def.kind === "select") {
      state.columnFilters[def.key] = els.filterPopoverBody.querySelector('[data-filter-input="select"]').value;
    } else if (def.kind === "daterange") {
      state.columnFilters[def.fromKey] = els.filterPopoverBody.querySelector('[data-filter-input="from"]').value;
      state.columnFilters[def.toKey] = els.filterPopoverBody.querySelector('[data-filter-input="to"]').value;
    }
    closeColumnPopover();
    resetToFirstPage();
  }

  function closeColumnPopover(refocus) {
    if (els.filterPopover.hidden) return;
    els.filterPopover.hidden = true;
    els.filterPopover.setAttribute("aria-hidden", "true");
    var anchor = state.popoverAnchor;
    state.popoverAnchor = null;
    state.popoverColumn = null;
    if (refocus && anchor && document.contains(anchor)) anchor.focus();
  }

  function toggleFiltersPanel() {
    var expanded = els.toggleFilters.getAttribute("aria-expanded") !== "false";
    expanded = !expanded;
    els.toggleFilters.setAttribute("aria-expanded", expanded ? "true" : "false");
    els.filterToggleLabel.textContent = expanded ? "Hide filters" : "Show filters";
    if (expanded) els.filtersPanelBody.removeAttribute("hidden");
    else els.filtersPanelBody.setAttribute("hidden", "hidden");
  }

  menuItem("details").addEventListener("click", function () {
    var r = state.menuRequest;
    var returnFocus = state.menuAnchor;
    closeRowMenu();
    if (r) openDetailsModal(r, returnFocus);
  });

  menuItem("approval").addEventListener("click", function (e) {
    if (this.getAttribute("aria-disabled") === "true") {
      e.preventDefault();
      return;
    }
    closeRowMenu();
  });

  menuItem("cancel").addEventListener("click", function () {
    if (this.disabled || this.getAttribute("aria-disabled") === "true") return;
    var r = state.menuRequest;
    closeRowMenu();
    if (r) openCancelPanel(r, "cancel");
  });

  menuItem("resolve-confirm").addEventListener("click", function () {
    if (this.disabled || this.getAttribute("aria-disabled") === "true") return;
    var r = state.menuRequest;
    closeRowMenu();
    if (r) openCancelPanel(r, "resolve-confirm");
  });

  menuItem("resolve-decline").addEventListener("click", function () {
    if (this.disabled || this.getAttribute("aria-disabled") === "true") return;
    var r = state.menuRequest;
    closeRowMenu();
    if (r) openCancelPanel(r, "resolve-decline");
  });

  els.headerFilterButtons.forEach(function (button) {
    button.addEventListener("click", function (e) {
      var column = button.getAttribute("data-column-filter");
      if (!column || button.disabled) return;
      e.preventDefault();
      openColumnPopover(button, column);
    });
  });

  document.addEventListener("click", function (e) {
    if (!els.rowMenu.hidden) {
      if (!els.rowMenu.contains(e.target) && !(state.menuAnchor && state.menuAnchor.contains(e.target))) {
        closeRowMenu();
      }
    }

    if (!els.filterPopover.hidden) {
      if (!els.filterPopover.contains(e.target) && !(state.popoverAnchor && state.popoverAnchor.contains(e.target))) {
        closeColumnPopover();
      }
    }
  });

  document.addEventListener("keydown", function (e) {
    if (els.detailsModal && !els.detailsModal.hidden) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeDetailsModal();
        return;
      }

      if (e.key === "Tab") {
        var focusable = modalFocusables();
        if (!focusable.length) {
          e.preventDefault();
          if (els.detailsModalClose) els.detailsModalClose.focus();
          return;
        }

        var first = focusable[0];
        var last = focusable[focusable.length - 1];
        var active = document.activeElement;
        if (e.shiftKey) {
          if (active === first || active === els.detailsModal) {
            e.preventDefault();
            last.focus();
          }
        } else if (active === last) {
          e.preventDefault();
          first.focus();
        }
        return;
      }
    }

    if (!els.filterPopover.hidden && e.key === "Escape") {
      e.preventDefault();
      closeColumnPopover(true);
      return;
    }

    if (!els.rowMenu.hidden && e.key === "Escape") {
      e.preventDefault();
      closeRowMenu(true);
      return;
    }

    if (!els.rowMenu.hidden && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      var items = visibleMenuItems();
      if (!items.length) return;
      var idx = items.indexOf(document.activeElement);
      e.preventDefault();
      idx = e.key === "ArrowDown"
        ? (idx + 1) % items.length
        : (idx - 1 + items.length) % items.length;
      items[idx].focus();
      return;
    }

    if (!els.filterPopover.hidden && e.key === "Enter") {
      var tag = document.activeElement && document.activeElement.tagName;
      if (tag === "INPUT") {
        e.preventDefault();
        applyColumnPopover(state.popoverColumn);
      }
    }
  });

  window.addEventListener("scroll", function () {
    closeRowMenu();
    closeColumnPopover();
  }, true);
  window.addEventListener("resize", function () {
    closeRowMenu();
    closeColumnPopover();
  });

  if (els.detailsModal) {
    els.detailsModal.addEventListener("click", function (e) {
      if (e.target === els.detailsModal) closeDetailsModal();
    });
  }
  if (els.detailsModalClose) {
    els.detailsModalClose.addEventListener("click", closeDetailsModal);
  }

  [els.fSearch].forEach(function (el) {
    el.addEventListener("input", resetToFirstPage);
  });
  [els.fStatus, els.fType, els.fFrom, els.fTo, els.fShort, els.fObo].forEach(function (el) {
    el.addEventListener("change", resetToFirstPage);
  });

  els.applyFilters.addEventListener("click", resetToFirstPage);
  els.clearFilters.addEventListener("click", function () {
    els.fSearch.value = "";
    els.fStatus.value = "All";
    els.fType.value = "All";
    els.fFrom.value = "";
    els.fTo.value = "";
    els.fShort.checked = false;
    els.fObo.checked = false;
    state.columnFilters = emptyColumnFilters();
    resetToFirstPage();
  });
  els.exportReport.addEventListener("click", exportReport);
  els.refresh.addEventListener("click", loadRequests);
  els.cancelConfirm.addEventListener("click", onConfirmCancel);
  els.cancelAbort.addEventListener("click", closeCancelPanel);
  if (els.dismissNotice) {
    els.dismissNotice.addEventListener("click", function () {
      if (els.hrNotice) els.hrNotice.hidden = true;
    });
  }
  if (els.toggleFilters) els.toggleFilters.addEventListener("click", toggleFiltersPanel);
  if (els.filterPopoverClose) els.filterPopoverClose.addEventListener("click", function () {
    closeColumnPopover(true);
  });

  els.pageSize.addEventListener("change", function () {
    var value = els.pageSize.value;
    state.pageSize = value === "all" ? Infinity : parseInt(value, 10) || 10;
    state.page = 1;
    renderTable();
  });
  els.pagePrev.addEventListener("click", function () {
    if (state.page > 1) goToPage(state.page - 1);
  });
  els.pageNext.addEventListener("click", function () {
    goToPage(state.page + 1);
  });

  els.signin.addEventListener("click", async function () {
    clearError();
    els.signin.disabled = true;
    try {
      await PTOAuth.signIn();
      clearAutoLoginFlag();
      renderAuth();
      await loadRequests();
    } catch (e) {
      showError("Sign-in failed: " + friendly(e));
    } finally {
      renderAuth();
    }
  });

  els.signout.addEventListener("click", async function () {
    clearError();
    try { await PTOAuth.signOut(); } catch (e) { showError(friendly(e)); }
    state.all = [];
    state.authorized = false;
    state.highlightedId = null;
    closeRowMenu();
    closeColumnPopover();
    closeDetailsModal();
    closeCancelPanel();
    renderTable();
    renderAuth();
  });

  var AUTO_LOGIN_FLAG = "hr_auto_login_attempted";

  function autoLoginAttempted() {
    try { return sessionStorage.getItem(AUTO_LOGIN_FLAG) === "1"; } catch (e) { return true; }
  }

  function markAutoLoginAttempted() {
    try {
      sessionStorage.setItem(AUTO_LOGIN_FLAG, "1");
      return sessionStorage.getItem(AUTO_LOGIN_FLAG) === "1";
    } catch (e) {
      return false;
    }
  }

  function clearAutoLoginFlag() {
    try { sessionStorage.removeItem(AUTO_LOGIN_FLAG); } catch (e) {}
  }

  (async function boot() {
    try {
      if (state.preview) {
        state.pageSize = 10;
        renderAuth();
        await loadRequests();
        return;
      }

      await PTOAuth.initialize();
      renderAuth();

      if (PTOAuth.getAccount()) {
        clearAutoLoginFlag();
        await loadRequests();
        return;
      }

      if (!autoLoginAttempted() && markAutoLoginAttempted()) {
        els.signin.disabled = true;
        els.account.textContent = "Redirecting to Microsoft sign-in…";
        try {
          await PTOAuth.signInRedirect();
          return;
        } catch (e) {
          console.warn("[hr.page] auto sign-in redirect failed:", friendly(e));
        }
      }

      renderAuth();
      els.account.textContent = "Not signed in — click Sign in to continue.";
    } catch (e) {
      showError("Initialization failed: " + friendly(e));
    }
  })();
})();
