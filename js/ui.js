/*
 * ui.js — Shared UI/DOM helpers. Namespace: window.PTOUI
 *
 * Responsibility (per PTO_CENTRAL_ARCHITECTURE.md §7):
 *   Small, reusable presentation helpers so page controllers stay thin.
 *   No business logic, no Graph calls.
 *     - qs / qsa / el : tiny DOM helpers
 *     - setText / show : update/toggle nodes
 *     - statusBadge    : colored badge element for a request Status (§4)
 *     - formatDateOnly / formatRange : consistent date display
 *     - toast          : transient feedback (console for now)
 *
 * Keeps the dark theme from styles.css; inline styles here avoid editing the
 * shared stylesheet. Dependency direction (§7): depends on nothing app-specific.
 */

window.PTOUI = (function () {
  "use strict";

  function qs(selector, root) { return (root || document).querySelector(selector); }
  function qsa(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  /**
   * Create an element. props supports: class/className, text, html, style{},
   * on<Event> handlers, and any other attribute. children: node|string|array.
   */
  function el(tag, props, children) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (k === "class" || k === "className") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k === "html") node.innerHTML = v;
        else if (k === "style" && v && typeof v === "object") Object.assign(node.style, v);
        else if (k.indexOf("on") === 0 && typeof v === "function") {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (v !== null && v !== undefined) {
          node.setAttribute(k, v);
        }
      });
    }
    if (children !== null && children !== undefined) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c === null || c === undefined) return;
        node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
      });
    }
    return node;
  }

  /** Set textContent by element or id; blank/nullish renders as "—". */
  function setText(elOrId, value) {
    var n = typeof elOrId === "string" ? document.getElementById(elOrId) : elOrId;
    if (n) n.textContent = (value === undefined || value === null || value === "") ? "—" : value;
  }

  /**
   * Show/hide by element or id.
   * When showing, set an EXPLICIT `display: block` rather than `""`. Clearing the
   * inline value (`""`) only falls back to the cascade, so it cannot reveal an
   * element a stylesheet hides with `display: none` (e.g. `.result`, `.note`) —
   * that was the Phase 3B visibility bug. An inline value wins over the sheet.
   * All current call sites target block-level <div>s, so "block" is correct.
   */
  function show(elOrId, on) {
    var n = typeof elOrId === "string" ? document.getElementById(elOrId) : elOrId;
    if (n) n.style.display = on ? "block" : "none";
  }

  // Status → badge theme. Keep this centralized so pages can reuse a safe
  // fallback for any newer production statuses without hardcoding colors in
  // multiple renderers.
  var STATUS_COLORS = {
    "Pending": {
      bg: "rgba(255, 244, 214, 0.96)",
      fg: "#b7791f",
      bd: "rgba(234, 179, 8, 0.28)",
      dot: "#f2b940",
    },
    "Approved": {
      bg: "rgba(221, 248, 237, 0.96)",
      fg: "#15803d",
      bd: "rgba(34, 197, 94, 0.22)",
      dot: "#20b46a",
    },
    "Auto-Approved": {
      bg: "rgba(221, 248, 237, 0.96)",
      fg: "#15803d",
      bd: "rgba(34, 197, 94, 0.22)",
      dot: "#20b46a",
    },
    "Auto-Approved (Escalation)": {
      bg: "rgba(221, 248, 237, 0.96)",
      fg: "#15803d",
      bd: "rgba(34, 197, 94, 0.22)",
      dot: "#20b46a",
    },
    "Rejected": {
      bg: "rgba(255, 231, 231, 0.98)",
      fg: "#dc2626",
      bd: "rgba(239, 68, 68, 0.2)",
      dot: "#ef4444",
    },
    "Cancellation Requested": {
      bg: "rgba(240, 233, 255, 0.98)",
      fg: "#7c3aed",
      bd: "rgba(167, 139, 250, 0.28)",
      dot: "#8b5cf6",
    },
    "Cancelled": {
      bg: "rgba(236, 241, 247, 0.98)",
      fg: "#64748b",
      bd: "rgba(148, 163, 184, 0.26)",
      dot: "#94a3b8",
    },
  };

  /** A colored status badge element. */
  function statusBadge(status) {
    var c = STATUS_COLORS[status] || {
      bg: "rgba(237, 242, 248, 0.98)",
      fg: "#475569",
      bd: "rgba(148, 163, 184, 0.28)",
      dot: "#94a3b8",
    };
    var dot = el("span", {
      "aria-hidden": "true",
      style: {
        width: "7px",
        height: "7px",
        borderRadius: "999px",
        background: c.dot,
        boxShadow: "0 0 0 2px rgba(255,255,255,0.82)",
      },
    });
    return el("span", {
      class: "pto-badge",
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: "7px",
        background: c.bg,
        color: c.fg,
        padding: "4px 11px",
        borderRadius: "999px",
        border: "1px solid " + c.bd,
        fontSize: "12px",
        fontWeight: "700",
        letterSpacing: ".01em",
        whiteSpace: "nowrap",
      },
    }, [dot, status || "—"]);
  }

  /** "YYYY-MM-DD" (or Date) → e.g. "Jun 12, 2026" (local). */
  function formatDateOnly(value) {
    if (!value) return "—";
    var d;
    var m = typeof value === "string" && /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  /** "start – end" display; collapses to a single date when equal. */
  function formatRange(start, end) {
    var s = formatDateOnly(start);
    var e = formatDateOnly(end);
    return s === e ? s : s + " – " + e;
  }

  function toast(message, type) {
    console.log("[ui:toast]", type || "info", message);
  }

  // Demo/QA "?preview=1" fixture mode is a designed-in bypass of MSAL sign-in
  // and every Graph write (approve/reject/cancel/submit route into in-memory
  // state instead). That is safe on a developer's machine, but these pages
  // are published on public GitHub Pages — a bare query-string check would
  // let anyone reach an admin-shaped demo UI on the production URL. Gate it
  // to loopback hosts so it only ever activates during local development.
  function isLocalDevHost() {
    var host = (window.location && window.location.hostname) || "";
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "";
  }

  return {
    qs: qs, qsa: qsa, el: el, setText: setText, show: show,
    statusBadge: statusBadge, formatDateOnly: formatDateOnly, formatRange: formatRange,
    toast: toast, isLocalDevHost: isLocalDevHost,
  };
})();
