/*
 * ui.js — Shared UI/DOM helpers. Namespace: window.PTOUI
 *
 * Responsibility (per PTO_CENTRAL_ARCHITECTURE.md §7):
 *   Small, reusable presentation helpers so page controllers stay thin.
 *   No business logic, no Graph calls.
 *     - qs / qsa / el : tiny DOM helpers
 *     - setText / show : update/toggle nodes
 *     - statusBadge    : neutral status label for a request Status (§4)
 *     - modal          : accessible modal helper
 *     - peoplePicker   : directory-backed typeahead helper
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

  /** A neutral status label element. */
  function statusBadge(status) {
    var key = String(status || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return el("span", {
      class: "pto-status pto-status-" + key,
      "data-status": status || "Unknown",
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

  function modal(opts) {
    opts = opts || {};
    var panel = document.getElementById(opts.id);
    if (!panel) return null;
    var backdrop = panel.closest(".modal-backdrop") || panel.parentNode;
    var closeBtn = panel.querySelector("[data-modal-close]");
    var lastFocus = null;
    var open = false;

    function focusables() {
      return qsa(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), ' +
        'select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        panel
      ).filter(function (n) {
        return n.offsetParent !== null || n === document.activeElement;
      });
    }
    function close() {
      if (!open) return;
      open = false;
      backdrop.hidden = true;
      document.body.classList.remove("modal-open");
      document.removeEventListener("keydown", onKeydown);
      if (opts.onClose) opts.onClose();
      if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
    }
    function show(trigger) {
      lastFocus = trigger || document.activeElement;
      open = true;
      backdrop.hidden = false;
      document.body.classList.add("modal-open");
      document.addEventListener("keydown", onKeydown);
      if (opts.onOpen) opts.onOpen();
      var nodes = focusables();
      (nodes[0] || panel).focus();
    }
    function onKeydown(e) {
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (e.key !== "Tab") return;
      var nodes = focusables();
      if (!nodes.length) { e.preventDefault(); return; }
      var first = nodes[0];
      var last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    if (closeBtn) closeBtn.addEventListener("click", close);
    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) close();
    });
    return { open: show, close: close, isOpen: function () { return open; } };
  }

  function peoplePicker(opts) {
    opts = opts || {};
    var input = typeof opts.input === "string" ? document.getElementById(opts.input) : opts.input;
    var results = typeof opts.results === "string" ? document.getElementById(opts.results) : opts.results;
    var selected = typeof opts.selected === "string" ? document.getElementById(opts.selected) : opts.selected;
    var selectedText = typeof opts.selectedText === "string" ? document.getElementById(opts.selectedText) : opts.selectedText;
    var clearBtn = typeof opts.clear === "string" ? document.getElementById(opts.clear) : opts.clear;
    var status = typeof opts.status === "string" ? document.getElementById(opts.status) : opts.status;
    var minLength = opts.minLength || 2;
    var items = [];
    var activeIndex = -1;
    var resolved = null;
    var timer = null;

    function emailOf(u) { return (u && (u.mail || u.userPrincipalName)) || ""; }
    function labelOf(u) { return (u && (u.displayName || emailOf(u))) || ""; }
    function setMessage(text, kind) {
      if (!status) return;
      status.textContent = text || "";
      status.classList.toggle("danger", kind === "danger");
      status.style.display = text ? "block" : "none";
    }
    function closeResults() {
      if (!results) return;
      results.innerHTML = "";
      results.classList.remove("show");
      activeIndex = -1;
    }
    function renderSelected() {
      if (!selected) return;
      if (resolved) {
        if (selectedText) selectedText.textContent = "Selected: " + labelOf(resolved) + " — " + emailOf(resolved);
        selected.classList.add("show");
      } else {
        selected.classList.remove("show");
      }
    }
    function clear(notify) {
      resolved = null;
      if (input) input.value = "";
      closeResults();
      renderSelected();
      setMessage("");
      if (notify !== false && opts.onClear) opts.onClear();
    }
    function pick(user) {
      resolved = user;
      if (input) input.value = labelOf(user);
      closeResults();
      renderSelected();
      setMessage("");
      if (opts.onSelect) opts.onSelect(user);
    }
    function row(user, idx) {
      var r = el("button", {
        class: "people-result" + (idx === activeIndex ? " active" : ""),
        type: "button",
        role: "option",
        "aria-selected": idx === activeIndex ? "true" : "false",
      }, [
        el("span", { class: "people-result-main" }, labelOf(user)),
        el("span", { class: "people-result-sub" }, emailOf(user) + (user.department ? " · " + user.department : "")),
      ]);
      r.addEventListener("mousedown", function (e) { e.preventDefault(); });
      r.addEventListener("click", function () { pick(user); });
      return r;
    }
    function renderResults(found) {
      items = found || [];
      if (!results) return;
      results.innerHTML = "";
      if (!items.length) {
        closeResults();
        setMessage("No matching employee found. Keep typing or check the spelling.", "danger");
        return;
      }
      activeIndex = 0;
      items.forEach(function (u, i) { results.appendChild(row(u, i)); });
      results.classList.add("show");
      setMessage("");
    }
    async function search() {
      var q = String((input && input.value) || "").trim();
      if (resolved && q !== labelOf(resolved)) {
        resolved = null;
        renderSelected();
        if (opts.onClear) opts.onClear();
      }
      if (q.length < minLength) { closeResults(); setMessage(""); return; }
      try {
        renderResults(await PTODirectory.searchUsers(q));
      } catch (e) {
        closeResults();
        setMessage((e && e.message) || String(e), "danger");
      }
    }
    function scheduleSearch() {
      clearTimeout(timer);
      timer = setTimeout(search, opts.delay || 140);
    }
    function move(delta) {
      if (!items.length) return;
      activeIndex = (activeIndex + delta + items.length) % items.length;
      if (results) {
        Array.prototype.forEach.call(results.children, function (child, idx) {
          child.classList.toggle("active", idx === activeIndex);
          child.setAttribute("aria-selected", idx === activeIndex ? "true" : "false");
        });
      }
    }
    if (input) {
      input.setAttribute("autocomplete", "off");
      input.setAttribute("role", "combobox");
      input.setAttribute("aria-autocomplete", "list");
      if (results && results.id) input.setAttribute("aria-controls", results.id);
      input.addEventListener("input", scheduleSearch);
      input.addEventListener("keydown", function (e) {
        if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
        else if (e.key === "Enter") {
          if (items[activeIndex]) { e.preventDefault(); pick(items[activeIndex]); }
        } else if (e.key === "Escape") {
          closeResults();
        }
      });
      input.addEventListener("blur", function () { setTimeout(closeResults, 150); });
    }
    if (clearBtn) clearBtn.addEventListener("click", function () { clear(); if (input) input.focus(); });
    renderSelected();
    return {
      clear: clear,
      select: pick,
      value: function () { return resolved; },
      setMessage: setMessage,
      search: search,
    };
  }

  return {
    qs: qs, qsa: qsa, el: el, setText: setText, show: show,
    statusBadge: statusBadge, formatDateOnly: formatDateOnly, formatRange: formatRange,
    toast: toast, modal: modal, peoplePicker: peoplePicker,
  };
})();
