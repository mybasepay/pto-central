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

  // Status → colors (mirrors §4 status set). Inline so styles.css is untouched.
  var STATUS_COLORS = {
    "Pending": { bg: "#3a2f06", fg: "#fcd34d" },
    "Approved": { bg: "#06281a", fg: "#86efac" },
    "Auto-Approved": { bg: "#06281a", fg: "#86efac" },
    "Auto-Approved (Escalation)": { bg: "#06281a", fg: "#86efac" },
    "Rejected": { bg: "#3f1d1d", fg: "#fca5a5" },
    "Cancelled": { bg: "#1f2937", fg: "#9ca3af" },
  };

  /** A colored status badge element. */
  function statusBadge(status) {
    var c = STATUS_COLORS[status] || { bg: "#1f2937", fg: "#cbd5e1" };
    return el("span", {
      class: "pto-badge",
      style: {
        background: c.bg, color: c.fg, padding: "3px 10px", borderRadius: "999px",
        fontSize: "12px", fontWeight: "700", letterSpacing: ".02em",
      },
      text: status || "—",
    });
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

  return {
    qs: qs, qsa: qsa, el: el, setText: setText, show: show,
    statusBadge: statusBadge, formatDateOnly: formatDateOnly, formatRange: formatRange,
    toast: toast,
  };
})();
