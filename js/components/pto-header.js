window.PTOHeader = (function () {
  "use strict";

  var STYLE_ID = "pto-header-component-styles";

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      ".pto-shell-header{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:18px 0 16px;border-bottom:1px solid rgba(148,163,184,.16);}",
      ".pto-shell-header__brand{display:flex;align-items:center;gap:12px;min-width:0;text-decoration:none;color:inherit;}",
      ".pto-shell-header__mark{width:44px;height:44px;border-radius:14px;display:grid;place-items:center;flex:0 0 auto;color:#2a7fff;background:linear-gradient(180deg,rgba(78,153,255,.15),rgba(255,255,255,.9));border:1px solid rgba(78,153,255,.22);box-shadow:0 16px 34px -26px rgba(36,99,235,.42);}",
      ".pto-shell-header__mark i{font-size:22px;line-height:1;}",
      ".pto-shell-header__wordmark{display:flex;align-items:center;gap:12px;min-width:0;}",
      ".pto-shell-header__company,.pto-shell-header__product{font-size:15px;font-weight:800;letter-spacing:-.01em;white-space:nowrap;color:#13254d;}",
      ".pto-shell-header__divider{width:1px;height:22px;background:rgba(148,163,184,.26);}",
      ".pto-shell-header__actions{display:flex;align-items:center;gap:16px;flex-wrap:wrap;justify-content:flex-end;}",
      ".pto-shell-header__account{display:none;align-items:center;gap:12px;padding:10px 14px;border-radius:999px;border:1px solid rgba(195,208,228,.62);background:rgba(255,255,255,.78);box-shadow:0 18px 38px -30px rgba(15,23,42,.24);}",
      ".pto-shell-header__account.show{display:flex;}",
      ".pto-shell-header__avatar{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;flex:0 0 auto;background:linear-gradient(180deg,rgba(124,58,237,.08),rgba(255,255,255,.92));border:1px solid rgba(99,102,241,.18);color:#6d57d7;}",
      ".pto-shell-header__avatar i{font-size:19px;line-height:1;}",
      ".pto-shell-header__who{display:flex;flex-direction:column;gap:1px;min-width:0;}",
      ".pto-shell-header__eyebrow{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#7b8aa3;}",
      ".pto-shell-header__name{font-size:14px;font-weight:700;color:#13254d;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px;}",
      ".pto-shell-header__auth{display:flex;align-items:center;gap:14px;flex-wrap:wrap;}",
      ".pto-shell-header__account-text{display:none;}",
      ".pto-shell-header__link{display:inline-flex;align-items:center;gap:9px;padding:0;border:0;background:transparent;color:#334a70;font-weight:700;text-decoration:none;}",
      ".pto-shell-header__link i{font-size:16px;line-height:1;color:#7f68d8;}",
      ".pto-shell-header__auth .btn{background:rgba(255,255,255,.82);border-color:rgba(195,208,228,.62);box-shadow:0 16px 36px -30px rgba(15,23,42,.24);}",
      ".pto-shell-header__auth .btn svg{width:15px;height:15px;}",
      "@media (max-width:640px){.pto-shell-header{padding-top:16px}.pto-shell-header__actions{width:100%;justify-content:space-between}.pto-shell-header__account{padding:8px 12px}.pto-shell-header__name{max-width:140px}.pto-shell-header__auth{margin-left:auto}}"
    ].join("");
    document.head.appendChild(style);
  }

  function render(target, options) {
    ensureStyles();
    options = options || {};
    var el = typeof target === "string" ? document.getElementById(target) : target;
    if (!el) return;

    var company = options.companyText || "myBasePay";
    var product = options.productText || "PTO Central";
    var homeHref = options.homeHref || "index.html";
    var accountLabel = options.accountLabel || "Your Account";
    var singleTitle = options.singleTitle || "";
    var wordmarkHtml = singleTitle
      ? '<span class="pto-shell-header__company">' + singleTitle + "</span>"
      : [
          '<span class="pto-shell-header__company">' + company + "</span>",
          '<span class="pto-shell-header__divider" aria-hidden="true"></span>',
          '<span class="pto-shell-header__product">' + product + "</span>"
        ].join("");

    el.innerHTML = [
      '<header class="pto-shell-header">',
      '  <a class="pto-shell-header__brand" href="' + homeHref + '">',
      '    <span class="pto-shell-header__mark" aria-hidden="true"><i class="bi bi-calendar2-check"></i></span>',
      '    <span class="pto-shell-header__wordmark">',
      wordmarkHtml,
      "    </span>",
      "  </a>",
      '  <div class="pto-shell-header__actions">',
      '    <span id="user-chip" class="pto-shell-header__account">',
      '      <span class="pto-shell-header__avatar" aria-hidden="true"><i class="bi bi-person"></i></span>',
      '      <span class="pto-shell-header__who">',
      '        <span class="pto-shell-header__eyebrow">' + accountLabel + "</span>",
      '        <span class="pto-shell-header__name" id="user-chip-name">—</span>',
      "      </span>",
      "    </span>",
      '    <div class="pto-shell-header__auth">',
      '      <span id="account" class="pto-shell-header__account-text" aria-live="polite">Not signed in.</span>',
      '      <button id="signin" class="btn" type="button">Sign in</button>',
      '      <button id="signout" class="btn small" type="button" disabled>',
      '        <i class="bi bi-box-arrow-right" aria-hidden="true"></i>',
      "        <span>Sign out</span>",
      "      </button>",
      "    </div>",
      "  </div>",
      "</header>"
    ].join("");
  }

  return {
    render: render
  };
})();
