(function () {
  "use strict";

  var PREVIEW_ITEMS = [
    {
      id: "preview-1",
      requestKey: "PTO-20260729-081512-A01X",
      ptoType: "Sick",
      notes: "Sick leave",
      startDate: "2026-08-01",
      endDate: "2026-08-01",
      status: "Auto-Approved",
      approverName: "Michelle Approver",
      approverEmail: "michelle.approver@example.test",
      backupContacts: [{ name: "Jamie Backup", email: "jamie.backup@example.test" }],
      submittedAt: "2026-07-29T08:15:12.000Z",
      requesterName: "Rod D.",
      requesterEmail: "rod.doe@mybasepay.com",
      fields: { AuditLog: "[2026-07-29T08:15:12.000Z] Created by Rod D. — Auto-Approved" },
      etag: 'W/"preview-1"',
    },
    {
      id: "preview-2",
      requestKey: "PTO-20260729-091244-B71M",
      ptoType: "PTO",
      notes: "Short-notice personal appointment",
      startDate: "2026-08-03",
      endDate: "2026-08-03",
      status: "Pending",
      approverName: "Michelle Approver",
      approverEmail: "michelle.approver@example.test",
      backupContacts: [
        { name: "Jamie Backup", email: "jamie.backup@example.test" },
        { name: "Sam Backup", email: "sam.backup@example.test" },
      ],
      submittedAt: "2026-07-29T09:12:44.000Z",
      requesterName: "Rod D.",
      requesterEmail: "rod.doe@mybasepay.com",
      fields: { AuditLog: "[2026-07-29T09:12:44.000Z] Created by Rod D. — Pending" },
      etag: 'W/"preview-2"',
    },
    {
      id: "preview-3",
      requestKey: "PTO-20260728-111026-C11J",
      ptoType: "PTO",
      notes: "Pending request cancellation review demo",
      startDate: "2026-08-06",
      endDate: "2026-08-06",
      status: "Cancellation Requested",
      statusBeforeCancellationRequest: "Approved",
      cancellationRequestReason: "Plans changed",
      cancellationRequestedAt: "2026-07-30T14:05:00.000Z",
      approverName: "Michelle Approver",
      approverEmail: "michelle.approver@example.test",
      backupContacts: [{ name: "Jamie Backup", email: "jamie.backup@example.test" }],
      submittedAt: "2026-07-28T11:10:26.000Z",
      requesterName: "Rod D.",
      requesterEmail: "rod.doe@mybasepay.com",
      fields: {
        AuditLog:
          "[2026-07-28T11:10:26.000Z] Created by Rod D. — Pending\n" +
          "[2026-07-30T14:05:00.000Z] Cancellation Requested by Rod D. — Employee self-service request — reason: Plans changed",
      },
      etag: 'W/"preview-3"',
    },
    {
      id: "preview-4",
      requestKey: "PTO-20260726-164002-D42N",
      ptoType: "PTO",
      notes: "Family trip",
      startDate: "2026-08-10",
      endDate: "2026-08-12",
      status: "Pending",
      approverName: "Michelle Approver",
      approverEmail: "michelle.approver@example.test",
      backupContacts: [{ name: "Jamie Backup", email: "jamie.backup@example.test" }],
      submittedAt: "2026-07-26T16:40:02.000Z",
      requesterName: "Rod D.",
      requesterEmail: "rod.doe@mybasepay.com",
      fields: { AuditLog: "[2026-07-26T16:40:02.000Z] Created by Rod D. — Pending" },
      etag: 'W/"preview-4"',
    },
    {
      id: "preview-5",
      requestKey: "PTO-20260729-172045-E18K",
      ptoType: "PTO",
      notes: "Managerless employee demo route",
      startDate: "2026-08-24",
      endDate: "2026-08-25",
      status: "Pending",
      approverName: "Maggie Mondragon",
      approverEmail: "maggie@mybasepay.com",
      backupContacts: [{ name: "Jamie Backup", email: "jamie.backup@example.test" }],
      submittedAt: "2026-07-29T17:20:45.000Z",
      requesterName: "Rod D.",
      requesterEmail: "rod.doe@mybasepay.com",
      fields: { AuditLog: "[2026-07-29T17:20:45.000Z] Created by Rod D. — Pending" },
      etag: 'W/"preview-5"',
    },
    {
      id: "preview-6",
      requestKey: "PTO-20260727-101530-F55Q",
      ptoType: "PTO",
      notes: "Original plans changed",
      startDate: "2026-08-28",
      endDate: "2026-08-28",
      status: "Cancellation Requested",
      statusBeforeCancellationRequest: "Pending",
      cancellationRequestReason: "No longer needed",
      cancellationRequestedAt: "2026-07-30T09:24:00.000Z",
      approverName: "Michelle Approver",
      approverEmail: "michelle.approver@example.test",
      backupContacts: [
        { name: "Jamie Backup", email: "jamie.backup@example.test" },
        { name: "Sam Backup", email: "sam.backup@example.test" },
      ],
      submittedAt: "2026-07-27T10:15:30.000Z",
      requesterName: "Rod D.",
      requesterEmail: "rod.doe@mybasepay.com",
      fields: {
        AuditLog:
          "[2026-07-27T10:15:30.000Z] Created by Rod D. — Pending\n" +
          "[2026-07-30T09:24:00.000Z] Cancellation Requested by Rod D. — Employee self-service request — reason: No longer needed",
      },
      etag: 'W/"preview-6"',
    },
    {
      id: "preview-7",
      requestKey: "PTO-20260725-094210-G09P",
      ptoType: "PTO",
      notes: "Legacy single-backup compatibility demo",
      startDate: "2026-09-02",
      endDate: "2026-09-02",
      status: "Pending",
      approverName: "Michelle Approver",
      approverEmail: "michelle.approver@example.test",
      backupContacts: [{ name: "Jamie Backup", email: "jamie.backup@example.test" }],
      submittedAt: "2026-07-25T09:42:10.000Z",
      requesterName: "Rod D.",
      requesterEmail: "rod.doe@mybasepay.com",
      fields: { AuditLog: "[2026-07-25T09:42:10.000Z] Created by Rod D. — Pending" },
      etag: 'W/"preview-7"',
    },
    {
      id: "preview-8",
      requestKey: "PTO-20260724-144311-H82L",
      ptoType: "PTO",
      notes: "Already-started pending cancellation",
      startDate: "2026-07-28",
      endDate: "2026-07-28",
      status: "Pending",
      approverName: "Michelle Approver",
      approverEmail: "michelle.approver@example.test",
      backupContacts: [{ name: "Jamie Backup", email: "jamie.backup@example.test" }],
      submittedAt: "2026-07-24T14:43:11.000Z",
      requesterName: "Rod D.",
      requesterEmail: "rod.doe@mybasepay.com",
      fields: { AuditLog: "[2026-07-24T14:43:11.000Z] Created by Rod D. — Pending" },
      etag: 'W/"preview-8"',
    },
    {
      id: "preview-9",
      requestKey: "PTO-20260720-082500-I33A",
      ptoType: "Sick",
      notes: "Cold / Flu",
      startDate: "2026-07-20",
      endDate: "2026-07-20",
      status: "Auto-Approved",
      approverName: "Michelle Approver",
      approverEmail: "michelle.approver@example.test",
      backupContacts: [{ name: "Jamie Backup", email: "jamie.backup@example.test" }],
      submittedAt: "2026-07-20T08:25:00.000Z",
      requesterName: "Rod D.",
      requesterEmail: "rod.doe@mybasepay.com",
      fields: { AuditLog: "[2026-07-20T08:25:00.000Z] Created by Rod D. — Auto-Approved" },
      etag: 'W/"preview-9"',
    },
    {
      id: "preview-10",
      requestKey: "PTO-20260715-132015-J10R",
      ptoType: "PTO",
      notes: "Family vacation",
      startDate: "2026-07-16",
      endDate: "2026-07-17",
      status: "Approved",
      approverName: "Michelle Approver",
      approverEmail: "michelle.approver@example.test",
      backupContacts: [
        { name: "Jamie Backup", email: "jamie.backup@example.test" },
        { name: "Sam Backup", email: "sam.backup@example.test" },
      ],
      submittedAt: "2026-07-15T13:20:15.000Z",
      requesterName: "Rod D.",
      requesterEmail: "rod.doe@mybasepay.com",
      fields: { AuditLog: "[2026-07-15T13:20:15.000Z] Created by Rod D. — Approved" },
      etag: 'W/"preview-10"',
    },
  ];

  var STATUS_OPTIONS = [
    "All",
    "Pending",
    "Approved",
    "Auto-Approved",
    "Auto-Approved (Escalation)",
    "Cancellation Requested",
    "Rejected",
    "Cancelled",
  ];

  var CLOSED_STATUSES = {
    Rejected: true,
    Cancelled: true,
  };

  var CANCEL_PENDING_STATUS =
    (window.PTORequests && PTORequests.CANCELLATION_REQUEST_PENDING_STATUS) || "Cancellation Requested";

  function $(id) {
    return document.getElementById(id);
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  var query = new URLSearchParams(window.location.search || "");
  var state = {
    // ?preview=1 only activates on localhost/loopback — see PTOUI.isLocalDevHost().
    preview: query.get("preview") === "1" && PTOUI.isLocalDevHost(),
    entry: query.get("entry") || "",
    viewportMode: query.get("viewport") || "",
    openCancelReview: query.get("openCancel") === "1",
    autoSubmitCancelReview: query.get("autoSubmitCancel") === "1",
    cancelReviewReason: query.get("cancelReason") || "Need to move the dates",
    all: [],
    me: null,
    page: 1,
    pageSize: 10,
    cancelTargetId: null,
    cancelSubmitting: false,
  };

  var els = {
    signin: $("signin"),
    signout: $("signout"),
    account: $("account"),
    userChip: $("user-chip"),
    userChipName: $("user-chip-name"),
    refresh: $("refresh"),
    search: $("search"),
    statusFilter: $("statusFilter"),
    typeFilter: $("typeFilter"),
    dateRangeFilter: $("dateRangeFilter"),
    statTotal: $("stat-total"),
    statPending: $("stat-pending"),
    statApproved: $("stat-approved"),
    pageMessage: $("pageMessage"),
    table: $("requestsTable"),
    tableBody: $("requestsTableBody"),
    mobileList: $("mobileList"),
    emptyState: $("emptyState"),
    emptyStateText: $("emptyStateText"),
    count: $("count"),
    pageSize: $("pageSize"),
    pagePrev: $("pagePrev"),
    pageNext: $("pageNext"),
    pageLabel: $("pageLabel"),
    cancelModal: $("cancelRequestModal"),
    cancelModalAlert: $("cancelModalAlert"),
    cancelSummaryType: $("cancelSummaryType"),
    cancelSummaryDates: $("cancelSummaryDates"),
    cancelSummaryStatus: $("cancelSummaryStatus"),
    cancelSummaryApprover: $("cancelSummaryApprover"),
    cancelReason: $("cancelReason"),
    cancelSubmit: $("cancelSubmit"),
    year: $("year"),
  };

  function createFallbackModal(modalEl) {
    var backdrop = null;
    var lastFocus = null;

    function focusableNodes() {
      return Array.prototype.slice.call(
        modalEl.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter(function (node) {
        return node.offsetParent !== null;
      });
    }

    function onKeydown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeCancellationModal();
        return;
      }
      if (event.key !== "Tab") return;
      var nodes = focusableNodes();
      if (!nodes.length) return;
      var first = nodes[0];
      var last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    return {
      show: function () {
        lastFocus = document.activeElement;
        modalEl.classList.add("manage-modal-fallback", "show");
        modalEl.style.display = "block";
        modalEl.setAttribute("aria-hidden", "false");
        document.body.classList.add("modal-open");
        backdrop = document.createElement("div");
        backdrop.className = "modal-backdrop fade show manage-modal-backdrop";
        document.body.appendChild(backdrop);
        modalEl.addEventListener("keydown", onKeydown);
        var nodes = focusableNodes();
        if (nodes.length) nodes[0].focus();
      },
      hide: function () {
        modalEl.classList.remove("show");
        modalEl.style.display = "none";
        modalEl.setAttribute("aria-hidden", "true");
        document.body.classList.remove("modal-open");
        modalEl.removeEventListener("keydown", onKeydown);
        if (backdrop && backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        backdrop = null;
        if (lastFocus && typeof lastFocus.focus === "function") {
          lastFocus.focus();
        }
      },
    };
  }

  var cancelModal = null;
  if (els.cancelModal) {
    cancelModal =
      window.bootstrap && window.bootstrap.Modal
        ? new bootstrap.Modal(els.cancelModal)
        : createFallbackModal(els.cancelModal);
  }

  if (els.year) {
    els.year.textContent = new Date().getFullYear();
  }

  if (state.viewportMode === "tablet" || state.viewportMode === "mobile") {
    document.body.classList.add("is-" + state.viewportMode);
  }

  function friendly(err) {
    return err && (err.message || err.errorMessage) ? (err.message || err.errorMessage) : String(err);
  }

  function showPageMessage(type, message) {
    if (!els.pageMessage) return;
    if (!message) {
      els.pageMessage.className = "alert manage-alert";
      els.pageMessage.textContent = "";
      return;
    }
    var alertType = type === "error" ? "alert-danger" : type === "success" ? "alert-success" : "alert-info";
    els.pageMessage.className = "alert manage-alert is-visible " + alertType;
    els.pageMessage.textContent = message;
  }

  function showModalMessage(type, message) {
    if (!els.cancelModalAlert) return;
    if (!message) {
      els.cancelModalAlert.className = "alert d-none";
      els.cancelModalAlert.textContent = "";
      return;
    }
    var alertType = type === "error" ? "alert-danger" : "alert-info";
    els.cancelModalAlert.className = "alert " + alertType;
    els.cancelModalAlert.textContent = message;
  }

  function renderAuth() {
    var acct = PTOAuth.getAccount();
    var signedIn = !!acct;
    if (els.signin) {
      els.signin.disabled = signedIn;
      els.signin.style.display = signedIn ? "none" : "";
    }
    if (els.signout) {
      els.signout.disabled = !signedIn;
    }
    if (els.refresh) {
      els.refresh.disabled = !signedIn && !state.preview;
    }
    if (els.userChip) {
      els.userChip.classList.toggle("show", signedIn || state.preview);
    }
    if (els.userChipName) {
      if (state.preview && !signedIn) {
        els.userChipName.textContent = "Rod D.";
      } else {
        els.userChipName.textContent = signedIn
          ? (acct.name || acct.username || acct.homeAccountId)
          : "—";
      }
    }
    if (els.account) {
      els.account.classList.toggle("show-text", !signedIn && !state.preview);
      els.account.textContent =
        signedIn
          ? "Signed in as " + (acct.username || acct.name || acct.homeAccountId)
          : state.preview
            ? ""
            : "Not signed in.";
    }
  }

  function isApprovedStatus(status) {
    return (
      status === "Approved" ||
      status === "Auto-Approved" ||
      status === "Auto-Approved (Escalation)"
    );
  }

  function statusVariant(status) {
    if (status === "Pending") return "is-pending";
    if (status === "Cancellation Requested") return "is-cancel-requested";
    if (status === "Auto-Approved (Escalation)") return "is-escalated";
    if (status === "Approved" || status === "Auto-Approved") return "is-approved";
    if (status === "Rejected") return "is-rejected";
    if (status === "Cancelled") return "is-cancelled";
    return "is-pending";
  }

  function statusIcon(status) {
    if (status === "Pending") return "bi-hourglass-split";
    if (status === "Cancellation Requested") return "bi-stars";
    if (status === "Approved" || status === "Auto-Approved") return "bi-check2-circle";
    if (status === "Auto-Approved (Escalation)") return "bi-arrow-up-right-circle";
    if (status === "Rejected" || status === "Cancelled") return "bi-slash-circle";
    return "bi-dot";
  }

  function buildStatusBadge(status) {
    var badge = document.createElement("span");
    badge.className = "status-badge " + statusVariant(status);
    var icon = document.createElement("i");
    icon.className = "bi " + statusIcon(status);
    icon.setAttribute("aria-hidden", "true");
    badge.appendChild(icon);
    badge.appendChild(document.createTextNode(status || "—"));
    return badge;
  }

  function formatDate(value) {
    return PTOUI.formatDateOnly(value);
  }

  function formatDateRange(item) {
    return PTOUI.formatRange(item.startDate, item.endDate);
  }

  function dayCount(item) {
    if (!item.startDate || !item.endDate) return "";
    var start = new Date(item.startDate + "T00:00:00");
    var end = new Date(item.endDate + "T00:00:00");
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return "";
    var diff = Math.round((end - start) / 86400000) + 1;
    if (diff <= 0) return "";
    return diff + " day" + (diff === 1 ? "" : "s");
  }

  function formatSubmittedDate(item) {
    if (!item.submittedAt) return "—";
    var value = new Date(item.submittedAt);
    if (isNaN(value.getTime())) return String(item.submittedAt);
    return value.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  function backupSummary(item) {
    if (!item.backupContacts || !item.backupContacts.length) return [];
    return item.backupContacts.map(function (entry) {
      if (entry.name && entry.email && entry.name !== entry.email) {
        return {
          primary: entry.name,
          secondary: entry.email,
        };
      }
      return {
        primary: entry.name || entry.email || "—",
        secondary: entry.name && entry.email && entry.name === entry.email ? "" : (entry.email || ""),
      };
    });
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function updateSummary() {
    var total = state.all.length;
    var pending = 0;
    var approved = 0;
    state.all.forEach(function (item) {
      if (item.status === "Pending") pending++;
      if (isApprovedStatus(item.status)) approved++;
    });
    if (els.statTotal) els.statTotal.textContent = total;
    if (els.statPending) els.statPending.textContent = pending;
    if (els.statApproved) els.statApproved.textContent = approved;
  }

  function syncStatusFilterOptions() {
    if (!els.statusFilter) return;
    var current = els.statusFilter.value || "All";
    els.statusFilter.innerHTML = "";
    STATUS_OPTIONS.forEach(function (status) {
      var option = document.createElement("option");
      option.value = status;
      option.textContent = status === "All" ? "All Statuses" : status;
      els.statusFilter.appendChild(option);
    });
    els.statusFilter.value = STATUS_OPTIONS.indexOf(current) !== -1 ? current : "All";
  }

  function syncTypeFilterOptions() {
    if (!els.typeFilter) return;
    var current = els.typeFilter.value || "All";
    var types = {};
    state.all.forEach(function (item) {
      if (item.ptoType) types[item.ptoType] = true;
    });
    var sorted = Object.keys(types).sort();
    els.typeFilter.innerHTML = "";
    var allOption = document.createElement("option");
    allOption.value = "All";
    allOption.textContent = "All Types";
    els.typeFilter.appendChild(allOption);
    sorted.forEach(function (type) {
      var option = document.createElement("option");
      option.value = type;
      option.textContent = type;
      els.typeFilter.appendChild(option);
    });
    els.typeFilter.value = types[current] || current === "All" ? current : "All";
  }

  function matchesStatus(item) {
    var filter = els.statusFilter ? els.statusFilter.value : "All";
    if (!filter || filter === "All") return true;
    return item.status === filter;
  }

  function matchesType(item) {
    var filter = els.typeFilter ? els.typeFilter.value : "All";
    if (!filter || filter === "All") return true;
    return item.ptoType === filter;
  }

  function matchesDateRange(item) {
    var filter = els.dateRangeFilter ? els.dateRangeFilter.value : "all";
    if (!filter || filter === "all") return true;
    var today = "2026-07-31";
    var inThirty = "2026-08-30";
    var yearPrefix = "2026-";
    var start = String(item.startDate || "");
    var end = String(item.endDate || item.startDate || "");
    if (filter === "upcoming") return end >= today;
    if (filter === "past") return end < today;
    if (filter === "next30") return start >= today && start <= inThirty;
    if (filter === "thisYear") return start.indexOf(yearPrefix) === 0 || end.indexOf(yearPrefix) === 0;
    return true;
  }

  function searchBlob(item) {
    var backup = (item.backupContacts || [])
      .map(function (entry) { return (entry.name || "") + " " + (entry.email || ""); })
      .join(" ");
    return [
      item.requestKey,
      item.ptoType,
      item.notes,
      item.status,
      item.approverName,
      item.approverEmail,
      item.requesterName,
      item.requesterEmail,
      item.statusBeforeCancellationRequest,
      item.cancellationRequestReason,
      formatDateRange(item),
      formatSubmittedDate(item),
      backup,
    ]
      .join(" ")
      .toLowerCase();
  }

  function matchesSearch(item) {
    var term = els.search ? String(els.search.value || "").trim().toLowerCase() : "";
    if (!term) return true;
    return searchBlob(item).indexOf(term) !== -1;
  }

  function filteredRows() {
    return state.all.filter(function (item) {
      return matchesStatus(item) && matchesType(item) && matchesDateRange(item) && matchesSearch(item);
    });
  }

  function pageContext(rows) {
    var total = rows.length;
    var size = state.pageSize === Infinity ? Infinity : state.pageSize;
    var pageCount = size === Infinity ? 1 : Math.max(1, Math.ceil(total / size));
    if (state.page > pageCount) state.page = pageCount;
    if (state.page < 1) state.page = 1;
    var startIdx = size === Infinity ? 0 : (state.page - 1) * size;
    var endIdx = size === Infinity ? total : Math.min(total, startIdx + size);
    return {
      total: total,
      pageCount: pageCount,
      startIdx: startIdx,
      endIdx: endIdx,
      rows: rows.slice(startIdx, endIdx),
    };
  }

  function isUpcomingGroup(item) {
    var end = String(item.endDate || item.startDate || "");
    if (item.status === CANCEL_PENDING_STATUS) return true;
    if (CLOSED_STATUSES[item.status]) return false;
    return end >= "2026-07-31";
  }

  function sectionBuckets(rows) {
    return rows.reduce(
      function (acc, item) {
        if (isUpcomingGroup(item)) acc.active.push(item);
        else acc.past.push(item);
        return acc;
      },
      { active: [], past: [] }
    );
  }

  // Explicit opt-in: a missing PTOConfig.features (or a missing
  // employeeCancellation key within it) means OFF, never an accidental
  // default-on. This is the single choke point every employee-facing
  // cancellation entry point (My Requests button/modal, the ?openCancel=1
  // direct link, and the home page card via cancel-request.html) reads
  // through — see canRequestCancellation() below.
  function cancellationEnabled() {
    var features = window.PTOConfig && PTOConfig.features;
    return !!(features && features.employeeCancellation === true);
  }

  function canRequestCancellation(item) {
    if (!cancellationEnabled()) return false;
    var eligible =
      window.PTORequests && PTORequests.CANCELLABLE_STATUSES
        ? PTORequests.CANCELLABLE_STATUSES
        : ["Pending", "Approved", "Auto-Approved", "Auto-Approved (Escalation)"];
    return eligible.indexOf(item.status) !== -1;
  }

  function renderTextCell(primary, secondary) {
    var wrap = document.createElement("div");
    var top = document.createElement("span");
    top.className = "row-primary wrap-clean";
    top.textContent = primary || "—";
    wrap.appendChild(top);
    if (secondary) {
      var bottom = document.createElement("span");
      bottom.className = "row-secondary wrap-clean";
      bottom.textContent = secondary;
      wrap.appendChild(bottom);
    }
    return wrap;
  }

  function renderPtoCell(item) {
    return renderTextCell(item.ptoType || "—", item.notes || "");
  }

  function renderDatesCell(item) {
    var secondary = dayCount(item);
    return renderTextCell(formatDateRange(item), secondary);
  }

  function renderStatusCell(item) {
    var wrap = document.createElement("div");
    wrap.appendChild(buildStatusBadge(item.status));
    if (item.status === CANCEL_PENDING_STATUS) {
      var note = document.createElement("span");
      note.className = "row-secondary";
      note.textContent = "Pending HR review";
      wrap.appendChild(note);
    }
    return wrap;
  }

  function renderApproverCell(item) {
    var secondary = item.approverEmail && item.approverEmail !== item.approverName ? item.approverEmail : "";
    return renderTextCell(item.approverName || "Not assigned", secondary);
  }

  function renderBackupCell(item) {
    var contacts = backupSummary(item);
    if (!contacts.length) return renderTextCell("None", "");
    var wrap = document.createElement("div");
    contacts.forEach(function (entry) {
      wrap.appendChild(renderTextCell(entry.primary, entry.secondary));
    });
    return wrap;
  }

  function renderSubmittedCell(item) {
    return renderTextCell(formatSubmittedDate(item), item.requestKey || "");
  }

  function renderActionsCell(item) {
    var wrap = document.createElement("div");
    if (canRequestCancellation(item)) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-outline-primary table-action";
      button.setAttribute("data-action", "cancel");
      button.setAttribute("data-request-id", item.id);
      button.textContent = "Request cancellation";
      button.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        openCancellationModal(item.id);
      });
      wrap.appendChild(button);
      return wrap;
    }
    if (item.status === CANCEL_PENDING_STATUS) {
      var note = document.createElement("span");
      note.className = "action-note";
      note.textContent = "Pending HR review";
      wrap.appendChild(note);
      return wrap;
    }
    wrap.appendChild(document.createTextNode("—"));
    return wrap;
  }

  function appendGroupHeader(tbody, label, count) {
    var row = document.createElement("tr");
    row.className = "group-row";
    var cell = document.createElement("th");
    cell.scope = "colgroup";
    cell.colSpan = 7;
    cell.textContent = label;
    var pill = document.createElement("span");
    pill.className = "group-row__count";
    pill.textContent = count + " request" + (count === 1 ? "" : "s");
    cell.appendChild(pill);
    row.appendChild(cell);
    tbody.appendChild(row);
  }

  function appendDesktopRow(tbody, item) {
    var row = document.createElement("tr");
    [
      renderPtoCell(item),
      renderDatesCell(item),
      renderStatusCell(item),
      renderApproverCell(item),
      renderBackupCell(item),
      renderSubmittedCell(item),
      renderActionsCell(item),
    ].forEach(function (content) {
      var cell = document.createElement("td");
      cell.appendChild(content);
      row.appendChild(cell);
    });
    tbody.appendChild(row);
  }

  function renderDesktop(rows) {
    if (!els.tableBody) return;
    els.tableBody.innerHTML = "";
    var sections = sectionBuckets(rows);
    if (sections.active.length) {
      appendGroupHeader(els.tableBody, "Active & Upcoming", sections.active.length);
      sections.active.forEach(function (item) { appendDesktopRow(els.tableBody, item); });
    }
    if (sections.past.length) {
      appendGroupHeader(els.tableBody, "Past & Closed", sections.past.length);
      sections.past.forEach(function (item) { appendDesktopRow(els.tableBody, item); });
    }
  }

  function cardSummaryHtml(item) {
    var backups = backupSummary(item);
    var backupHtml = backups.length
      ? backups
          .map(function (entry) {
            return (
              '<div class="wrap-clean"><strong>' +
              escapeHtml(entry.primary) +
              "</strong>" +
              (entry.secondary ? '<div class="text-muted small">' + escapeHtml(entry.secondary) + "</div>" : "") +
              "</div>"
            );
          })
          .join("")
      : "None";

    var actionHtml = canRequestCancellation(item)
      ? '<button type="button" class="btn btn-outline-primary table-action mt-2" data-action="cancel" data-request-id="' +
        escapeHtml(item.id) +
        '">Request cancellation</button>'
      : item.status === CANCEL_PENDING_STATUS
        ? '<span class="action-note mt-2 d-inline-block">Pending HR review</span>'
        : '<span class="action-note mt-2 d-inline-block">No action available</span>';

    return [
      '<article class="mobile-card">',
      '  <div class="d-flex align-items-start justify-content-between gap-3">',
      '    <div>',
      '      <div class="row-primary">' + escapeHtml(item.ptoType || "—") + "</div>",
      item.notes ? '      <div class="row-secondary wrap-clean">' + escapeHtml(item.notes) + "</div>" : "",
      "    </div>",
      '    <div class="text-end"></div>',
      "  </div>",
      '  <div class="mt-3"></div>',
      '  <div class="mb-3"></div>',
      '  <div class="mobile-status"></div>',
      '  <dl class="mobile-meta">',
      '    <div><dt>Dates</dt><dd>' + escapeHtml(formatDateRange(item)) + (dayCount(item) ? "<br>" + escapeHtml(dayCount(item)) : "") + "</dd></div>",
      '    <div><dt>Submitted</dt><dd>' + escapeHtml(formatSubmittedDate(item)) + "</dd></div>",
      '    <div><dt>Approver</dt><dd class="wrap-clean"><strong>' + escapeHtml(item.approverName || "Not assigned") + "</strong>" + (item.approverEmail ? "<br>" + escapeHtml(item.approverEmail) : "") + "</dd></div>",
      '    <div><dt>Backup Contact(s)</dt><dd class="wrap-clean">' + backupHtml + "</dd></div>",
      "  </dl>",
      "  " + actionHtml,
      "</article>",
    ].join("");
  }

  function renderMobile(rows) {
    if (!els.mobileList) return;
    els.mobileList.innerHTML = "";
    var sections = sectionBuckets(rows);

    function appendMobileSection(label, items) {
      if (!items.length) return;
      var heading = document.createElement("div");
      heading.className = "mobile-group-label";
      heading.innerHTML =
        '<span>' + label + '</span><span class="group-row__count">' +
        items.length +
        " request" +
        (items.length === 1 ? "" : "s") +
        "</span>";
      els.mobileList.appendChild(heading);

      items.forEach(function (item) {
        var block = document.createElement("div");
        block.innerHTML = cardSummaryHtml(item);
        var card = block.firstChild;
        var statusHolder = card.querySelector(".mobile-status");
        if (statusHolder) {
          statusHolder.appendChild(buildStatusBadge(item.status));
          if (item.status === CANCEL_PENDING_STATUS) {
            var helper = document.createElement("div");
            helper.className = "row-secondary";
            helper.textContent = "Pending HR review";
            statusHolder.appendChild(helper);
          }
        }
        els.mobileList.appendChild(card);
      });
    }

    appendMobileSection("Active & Upcoming", sections.active);
    appendMobileSection("Past & Closed", sections.past);
  }

  function renderEmpty(totalLoaded, filteredCount) {
    var isEmpty = filteredCount === 0;
    if (els.table) els.table.style.display = isEmpty ? "none" : "";
    if (els.mobileList) els.mobileList.style.display = isEmpty ? "none" : "";
    if (els.emptyState) {
      els.emptyState.classList.toggle("is-visible", isEmpty);
    }
    if (els.emptyStateText) {
      els.emptyStateText.textContent = totalLoaded
        ? "No requests match your current search or filters."
        : "No PTO requests were found for this account.";
    }
  }

  function renderCount(total, startIdx, endIdx, pageCount) {
    if (els.count) {
      if (!total) {
        els.count.textContent = "";
      } else {
        els.count.textContent =
          "Showing " +
          (startIdx + 1) +
          " to " +
          endIdx +
          " of " +
          total +
          " request" +
          (total === 1 ? "" : "s");
      }
    }
    if (els.pageLabel) {
      els.pageLabel.textContent = "Page " + (total ? state.page : 0) + " of " + pageCount;
    }
    if (els.pagePrev) els.pagePrev.disabled = !total || state.page <= 1;
    if (els.pageNext) els.pageNext.disabled = !total || state.page >= pageCount;
  }

  function render() {
    syncStatusFilterOptions();
    syncTypeFilterOptions();
    updateSummary();

    var rows = filteredRows();
    var paged = pageContext(rows);
    renderDesktop(paged.rows);
    renderMobile(paged.rows);
    renderEmpty(state.all.length, paged.total);
    renderCount(paged.total, paged.startIdx, paged.endIdx, paged.pageCount);
  }

  function resetPagination() {
    state.page = 1;
    render();
  }

  function firstEligibleCancellationItem() {
    for (var i = 0; i < state.all.length; i++) {
      if (canRequestCancellation(state.all[i])) return state.all[i];
    }
    return null;
  }

  function resetCancellationModalState() {
    state.cancelTargetId = null;
    state.cancelSubmitting = false;
    showModalMessage(null, "");
    if (els.cancelSubmit) els.cancelSubmit.disabled = false;
    if (els.cancelReason) els.cancelReason.value = "";
  }

  function forceCloseModalSurface() {
    if (!els.cancelModal) return;
    els.cancelModal.classList.remove("show", "manage-modal-fallback");
    els.cancelModal.style.display = "none";
    els.cancelModal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    Array.prototype.slice.call(document.querySelectorAll(".modal-backdrop")).forEach(function (node) {
      if (node && node.parentNode) node.parentNode.removeChild(node);
    });
  }

  function currentItem() {
    if (!state.cancelTargetId) return null;
    for (var i = 0; i < state.all.length; i++) {
      if (String(state.all[i].id) === String(state.cancelTargetId)) return state.all[i];
    }
    return null;
  }

  function openCancellationModal(itemId) {
    state.cancelTargetId = itemId;
    var item = currentItem();
    if (!item) return;
    if (els.cancelReason) els.cancelReason.value = "";
    showModalMessage(null, "");
    if (els.cancelSummaryType) els.cancelSummaryType.textContent = item.ptoType || "—";
    if (els.cancelSummaryDates) els.cancelSummaryDates.textContent = formatDateRange(item);
    if (els.cancelSummaryStatus) {
      els.cancelSummaryStatus.textContent = "";
      els.cancelSummaryStatus.appendChild(buildStatusBadge(item.status));
    }
    if (els.cancelSummaryApprover) {
      els.cancelSummaryApprover.textContent =
        item.approverName || item.approverEmail
          ? (item.approverName || "Approver") + (item.approverEmail ? " · " + item.approverEmail : "")
          : "Not assigned";
    }
    if (cancelModal) cancelModal.show();
  }

  function closeCancellationModal() {
    resetCancellationModalState();
    if (cancelModal) cancelModal.hide();
    forceCloseModalSurface();
  }

  function previewCancellation(item, reason) {
    var previousStatus = item.status;
    item.status = CANCEL_PENDING_STATUS;
    item.statusBeforeCancellationRequest = previousStatus;
    item.cancellationRequestReason = reason;
    item.cancellationRequestedAt = new Date().toISOString();
    item.fields = item.fields || {};
    var line = PTORules.buildAuditLine(
      "Cancellation Requested",
      "Rod D.",
      "Employee self-service request — reason: " + reason
    );
    item.fields.AuditLog = item.fields.AuditLog ? item.fields.AuditLog + "\n" + line : line;
  }

  async function submitCancellation() {
    var item = currentItem();
    if (!item || state.cancelSubmitting) return;
    // Defense in depth: re-check the flag + status right before the write,
    // in case the modal was reached any way other than the gated button/link.
    if (!canRequestCancellation(item)) {
      showModalMessage("error", "Cancellation is not available for this request.");
      return;
    }
    var reason = String((els.cancelReason && els.cancelReason.value) || "").trim();
    if (!reason) {
      showModalMessage("error", "A cancellation reason is required.");
      if (els.cancelReason) els.cancelReason.focus();
      return;
    }

    state.cancelSubmitting = true;
    if (els.cancelSubmit) els.cancelSubmit.disabled = true;
    showModalMessage(null, "");

    try {
      if (state.preview) {
        previewCancellation(item, reason);
      } else {
        var result = await PTORequests.requestCancellation(item.id, {
          actor: state.me,
          reason: reason,
          currentStatus: item.status,
          existingAuditLog: item.fields && item.fields.AuditLog,
          ifMatch: item.etag,
        });
        item.statusBeforeCancellationRequest = result.statusBeforeCancellationRequest || item.status;
        item.status = CANCEL_PENDING_STATUS;
        item.cancellationRequestReason = reason;
        item.cancellationRequestedAt = result.cancellationRequestedAt || new Date().toISOString();
        item.fields = Object.assign({}, item.fields || {}, result.fields || {});
      }
      render();
      closeCancellationModal();
      showPageMessage("success", "Cancellation request submitted. The item now shows Pending HR review.");
    } catch (err) {
      showModalMessage("error", friendly(err));
      if (els.cancelSubmit) els.cancelSubmit.disabled = false;
      state.cancelSubmitting = false;
      return;
    }

    state.cancelSubmitting = false;
  }

  function previewItems() {
    return clone(PREVIEW_ITEMS);
  }

  async function maybeRunReviewScenario() {
    if (!(state.preview || window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost")) {
      return;
    }
    if (!state.openCancelReview) return;
    var target = firstEligibleCancellationItem();
    if (!target) return;
    openCancellationModal(target.id);
    if (!state.autoSubmitCancelReview) return;
    if (els.cancelReason) els.cancelReason.value = state.cancelReviewReason;
    await submitCancellation();
    forceCloseModalSurface();
  }

  async function loadRequests() {
    showPageMessage(null, "");
    if (els.count) els.count.textContent = "Loading…";
    if (els.refresh) els.refresh.disabled = true;

    try {
      if (state.preview) {
        state.all = previewItems();
        renderAuth();
      } else {
        var me = await PTODirectory.getMe();
        state.me = me;
        var email = me.mail || me.userPrincipalName;
        if (!email) throw new Error("Could not determine your email from your profile.");
        var authz = await PTOAuthz.enforce(me);
        if (!authz.authorized) {
          state.all = [];
          render();
          return;
        }
        var result = await PTORequests.listMyRequests(email);
        state.all = result.items || [];
        if (result.warning) {
          showPageMessage("info", result.warning + (result.usedFallback ? " (client-side fallback in use)" : ""));
        }
      }

      if (state.entry === "cancel") {
        showPageMessage("info", "Select an eligible request below to submit a cancellation request.");
      }

      state.page = 1;
      render();
      await maybeRunReviewScenario();
    } catch (err) {
      state.all = [];
      render();
      showPageMessage("error", "Could not load your requests: " + friendly(err));
    } finally {
      if (els.refresh) els.refresh.disabled = !PTOAuth.getAccount() && !state.preview;
    }
  }

  var AUTO_LOGIN_FLAG = "manage_requests_auto_login_attempted";

  function autoLoginAttempted() {
    try {
      return sessionStorage.getItem(AUTO_LOGIN_FLAG) === "1";
    } catch (err) {
      return true;
    }
  }

  function markAutoLoginAttempted() {
    try {
      sessionStorage.setItem(AUTO_LOGIN_FLAG, "1");
      return sessionStorage.getItem(AUTO_LOGIN_FLAG) === "1";
    } catch (err) {
      return false;
    }
  }

  function clearAutoLoginFlag() {
    try {
      sessionStorage.removeItem(AUTO_LOGIN_FLAG);
    } catch (err) {}
  }

  if (els.statusFilter) els.statusFilter.addEventListener("change", resetPagination);
  if (els.typeFilter) els.typeFilter.addEventListener("change", resetPagination);
  if (els.dateRangeFilter) els.dateRangeFilter.addEventListener("change", resetPagination);
  if (els.search) els.search.addEventListener("input", resetPagination);

  if (els.pageSize) {
    els.pageSize.addEventListener("change", function () {
      var value = els.pageSize.value;
      state.pageSize = value === "all" ? Infinity : (parseInt(value, 10) || 10);
      resetPagination();
    });
  }

  if (els.pagePrev) {
    els.pagePrev.addEventListener("click", function () {
      if (state.page > 1) {
        state.page--;
        render();
      }
    });
  }

  if (els.pageNext) {
    els.pageNext.addEventListener("click", function () {
      state.page++;
      render();
    });
  }

  if (els.refresh) {
    els.refresh.addEventListener("click", loadRequests);
  }

  if (els.signin) {
    els.signin.addEventListener("click", async function () {
      showPageMessage(null, "");
      els.signin.disabled = true;
      try {
        await PTOAuth.signIn();
        clearAutoLoginFlag();
        renderAuth();
        await loadRequests();
      } catch (err) {
        showPageMessage("error", "Sign-in failed: " + friendly(err));
      } finally {
        renderAuth();
      }
    });
  }

  if (els.signout) {
    els.signout.addEventListener("click", async function () {
      showPageMessage(null, "");
      try {
        await PTOAuth.signOut();
      } catch (err) {
        showPageMessage("error", friendly(err));
      }
      state.all = [];
      state.me = null;
      renderAuth();
      render();
    });
  }

  function bindActionDelegates(root) {
    if (!root) return;
    root.addEventListener("click", function (event) {
      var trigger = event.target && event.target.closest("[data-action='cancel']");
      if (!trigger) return;
      event.preventDefault();
      openCancellationModal(trigger.getAttribute("data-request-id"));
    });
  }

  bindActionDelegates(els.tableBody);
  bindActionDelegates(els.mobileList);

  if (els.cancelSubmit) {
    els.cancelSubmit.addEventListener("click", submitCancellation);
  }

  if (els.cancelModal) {
    els.cancelModal.addEventListener("click", function (event) {
      if (
        !(window.bootstrap && window.bootstrap.Modal) &&
        (event.target === els.cancelModal || event.target.closest("[data-bs-dismiss='modal']"))
      ) {
        event.preventDefault();
        closeCancellationModal();
      }
    });
    els.cancelModal.addEventListener("hidden.bs.modal", function () {
      resetCancellationModalState();
    });
  }

  if (state.preview || window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost") {
    window.__ptoManageDebug = {
      openCancellationModal: openCancellationModal,
      submitCancellation: submitCancellation,
      getRows: function () { return state.all; },
      getState: function () { return state; },
    };
  }

  (async function boot() {
    try {
      if (state.preview) {
        renderAuth();
        state.pageSize = 10;
        syncStatusFilterOptions();
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
        if (els.account) {
          els.account.textContent = "Redirecting to Microsoft sign-in…";
          els.account.classList.add("show-text");
        }
        try {
          await PTOAuth.signInRedirect();
          return;
        } catch (err) {
          console.warn("[my-requests.page] auto sign-in redirect failed:", friendly(err));
        }
      }

      renderAuth();
      if (els.account) {
        els.account.textContent = "Not signed in — click Sign in to continue.";
        els.account.classList.add("show-text");
      }
      render();
    } catch (err) {
      showPageMessage("error", "Initialization failed: " + friendly(err));
    }
  })();
})();
