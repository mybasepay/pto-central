/*
 * script.js — Home page (index.html) only.
 *
 * Responsibility (per PTO_CENTRAL_ARCHITECTURE.md §7, §8.1):
 *   - The tiny presentation script the landing page references.
 *   - Jobs (UI only): (1) set the current year in the footer;
 *     (2) drive the "PTO reminder" toast — show / dismiss / "Don't show
 *     again" (persisted in localStorage).
 *   - It must NOT change any existing page behavior, links, or styling
 *     of other pages. The home page stays anonymous (no auth) — architecture §6.
 *
 * Do NOT add app logic, MSAL, or Graph calls here. Application pages
 * (request/my-requests/approve/hr-*) load their own modules from /js.
 */

(function () {
  "use strict";

  // ---- Footer year (no-op on any page without #year) ---------------------
  var yearEl = document.getElementById("year");
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }

  // ---- PTO reminder toast (presentation only) ----------------------------
  var toast = document.getElementById("ptoReminder");
  if (!toast) {
    return; // not on the home page, or markup absent
  }

  var STORAGE_KEY = "ptoReminderDismissed";
  // The previous production home used the components/pto-notice component with
  // this key. Honor it so employees who already dismissed the reminder there
  // don't see it again after the redesign.
  var LEGACY_KEY = "pto_notice_dismissed_v1";
  var closeBtn = document.getElementById("reminderClose");
  var gotItBtn = document.getElementById("reminderGotIt");
  var dontShow = document.getElementById("reminderDismiss");

  // localStorage may throw (private mode / blocked storage) — degrade gracefully.
  function isPermanentlyDismissed() {
    try {
      return (
        window.localStorage.getItem(STORAGE_KEY) === "true" ||
        window.localStorage.getItem(LEGACY_KEY) === "true"
      );
    } catch (e) {
      return false;
    }
  }

  function rememberDismissal() {
    try {
      window.localStorage.setItem(STORAGE_KEY, "true");
    } catch (e) {
      /* storage unavailable — nothing to persist */
    }
  }

  function dismiss() {
    if (dontShow && dontShow.checked) {
      rememberDismissal();
    }
    toast.hidden = true;
  }

  // Show only if the user hasn't permanently dismissed it.
  if (!isPermanentlyDismissed()) {
    toast.hidden = false;
  }

  if (closeBtn) {
    closeBtn.addEventListener("click", dismiss);
  }
  if (gotItBtn) {
    gotItBtn.addEventListener("click", dismiss);
  }

  // Allow Escape to dismiss while the toast is visible (keyboard-friendly).
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && !toast.hidden) {
      dismiss();
    }
  });
})();
