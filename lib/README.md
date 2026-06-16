# lib/

Vendored third-party browser libraries (pinned versions — **do not** float on `@latest`).

Per `PTO_CENTRAL_ARCHITECTURE.md` §3, §7.

## `msal-browser.min.js` — Microsoft Authentication Library (MSAL.js v3)

Required by `js/auth.js` (loaded **before** it in every page that authenticates,
including `dev-smoke-test.html`). It exposes the `window.msal` global.

**Currently installed (pinned):** `@azure/msal-browser` **v3.28.1** (bundles
`msal-common v14.16.0`), fetched from jsDelivr:
`https://cdn.jsdelivr.net/npm/@azure/msal-browser@3.28.1/lib/msal-browser.min.js`.

### Install (pick one)

**Option A — download a pinned release (recommended):**

1. Go to the MSAL Browser releases / CDN and choose a **specific v3 version**
   (e.g. `3.x.y`), not a `latest`/floating tag.
2. Save the minified UMD build to this folder as exactly:
   ```
   lib/msal-browser.min.js
   ```
   Example source URL (replace `3.x.y` with the version you pin):
   ```
   https://alcdn.msauth.net/browser/3.x.y/js/msal-browser.min.js
   ```

**Option B — via npm, then copy the dist file:**

```powershell
npm install @azure/msal-browser@3.x.y
Copy-Item node_modules/@azure/msal-browser/lib/msal-browser.min.js lib/msal-browser.min.js
```

### Versioning rule (production)

- **Pin a specific MSAL v3 version** (e.g. `3.x.y`). Record the exact version
  you installed in the Phase 1A readiness checklist
  (`docs/PHASE_1_READINESS_CHECKLIST.md`).
- **Do not** reference `@latest` or an unpinned CDN tag in production — a silent
  upstream change could break auth without a code change on our side.
- When upgrading, bump deliberately, re-run the `/me` smoke test, and update the
  recorded version.

### How it's loaded

`dev-smoke-test.html` (and later app pages) load it as a plain global script
**before** the app modules:

```html
<script src="lib/msal-browser.min.js"></script>  <!-- exposes window.msal -->
<script src="js/config.js"></script>
<script src="js/auth.js"></script>               <!-- uses window.msal -->
<script src="js/graph.js"></script>
```

If the file is missing, `PTOAuth.initialize()` throws a friendly error telling
you to install it.
