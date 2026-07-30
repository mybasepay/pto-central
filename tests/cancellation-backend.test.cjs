/*
 * cancellation-backend.test.cjs — tests for the REAL (non-demo) cancellation
 * backend in js/requests.js: requestCancellation, completeCancellationRequest,
 * declineCancellationRequest. Same `vm`-sandboxed harness pattern as
 * tests/demo-contract.test.cjs (loads the actual browser files, no mocking
 * framework), with a small in-memory fake PTOGraph standing in for real
 * Microsoft Graph — this exercises the real ETag/If-Match concurrency logic
 * without any network.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

/** In-memory fake Microsoft Graph list-item client. Mirrors the real
 *  PTOGraph.getListItem/updateListItem/etagOf contract exactly (including
 *  409/412 on an ETag mismatch), so requests.js's real functions run
 *  unmodified against it. */
function makeFakeGraph(seedItems) {
  const items = {};
  let etagCounter = 0;
  function nextEtag() { etagCounter += 1; return 'W/"etag-' + etagCounter + '"'; }
  Object.keys(seedItems).forEach((id) => {
    items[id] = { id, fields: Object.assign({}, seedItems[id]), etag: nextEtag() };
  });
  const calls = { getListItem: [], updateListItem: [] };
  return {
    calls,
    _items: items,
    async getListItem(id) {
      calls.getListItem.push(id);
      const it = items[id];
      if (!it) { const e = new Error("not found"); e.status = 404; throw e; }
      return { id: it.id, "@odata.etag": it.etag, fields: Object.assign({}, it.fields) };
    },
    async updateListItem(id, fields, options) {
      calls.updateListItem.push({ id, fields, options });
      const it = items[id];
      if (!it) { const e = new Error("not found"); e.status = 404; throw e; }
      if (options && options.etag && options.etag !== it.etag) {
        const e = new Error("conflict"); e.status = 412; throw e;
      }
      it.fields = Object.assign({}, it.fields, fields);
      it.etag = nextEtag();
      return { "@odata.etag": it.etag };
    },
    etagOf(item) { return (item && (item["@odata.etag"] || item.eTag)) || null; },
  };
}

/** Same domain (real-backend) context as demo-contract.test.cjs, plus a fake
 *  PTOGraph and (by default) the production feature flag turned ON so the
 *  real cancellation functions' own logic can be exercised directly. Pass
 *  `{ featureEnabled: false }` for the flag-off tests. */
function backendContext(seedItems, opts) {
  opts = opts || {};
  const featureEnabled = opts.featureEnabled !== false;
  const context = {
    window: {},
    console,
    PTOGraph: makeFakeGraph(seedItems || {}),
  };
  vm.createContext(context);
  // rules.js's pre-existing MIN_NOTICE_DAYS line reads `window.PTOConfig`
  // bare-after-guard at MODULE-LOAD time — setting window.PTOConfig before
  // this load would trip that (unrelated, pre-existing) latent bug, since a
  // bare `PTOConfig` reference is never mirrored as a real vm-context global
  // the way `PTORules`/`PTOGraph` explicitly are below. Loading rules.js
  // BEFORE setting window.PTOConfig sidesteps it entirely — out of scope to
  // fix here, and isEmployeeCancellationEnabled() (called later, at runtime,
  // not at load time) is unaffected either way since it's fully
  // window-qualified.
  vm.runInContext(read("js/rules.js"), context);
  context.window.PTOConfig = { features: { employeeCancellationRequests: featureEnabled } };
  context.PTORules = context.window.PTORules;
  vm.runInContext(read("js/requests.js"), context);
  context.PTORequests = context.window.PTORequests;
  return context;
}

/** Same demoContext() pattern as tests/demo-contract.test.cjs, duplicated
 *  here (self-contained test files, matching this repo's existing
 *  convention) for the demo/real parity tests below. */
function demoContext() {
  const store = {};
  const context = {
    window: { location: { search: "?demo=1" } },
    console, URLSearchParams,
    sessionStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
      clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
    },
    document: {
      documentElement: { classList: { add() {} } },
      addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; },
      createElement() { return { className: "", textContent: "", setAttribute() {}, appendChild() {}, addEventListener() {} }; },
      body: { appendChild() {} },
    },
  };
  context.window.console = console;
  context.window.sessionStorage = context.sessionStorage;
  context.window.document = context.document;
  vm.createContext(context);
  vm.runInContext(read("js/rules.js"), context);
  context.PTORules = context.window.PTORules;
  vm.runInContext(read("js/requests.js"), context);
  context.PTORequests = context.window.PTORequests;
  vm.runInContext(read("js/demo-fixtures.js"), context);
  context.PTODemoFixtures = context.window.PTODemoFixtures;
  vm.runInContext(read("js/demo-mode.js"), context);
  context.PTORequests = context.window.PTORequests;
  return context;
}

const NOW = "2026-08-05T12:00:00.000Z";
function baseFields(overrides) {
  return Object.assign({
    Title: "PTO-TEST-0001",
    Status: "Pending",
    RequesterEmail: "employee@mybasepay.com",
    RequesterName: "Employee One",
    StartDate: "2026-09-01",
    EndDate: "2026-09-02",
    SubmittedAt: "2026-08-01T00:00:00.000Z",
    AuditLog: "[2026-08-01T00:00:00.000Z] Created by Employee One",
  }, overrides || {});
}
const EMPLOYEE_ACTOR = { id: "emp-1", displayName: "Employee One", mail: "employee@mybasepay.com" };
const OTHER_ACTOR = { id: "other-1", displayName: "Other Person", mail: "other@mybasepay.com" };
const HR_ACTOR = { id: "hr-1", displayName: "HR Person", mail: "hr@mybasepay.com" };

let passCount = 0, failCount = 0;
const pending = [];
function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      pending.push(result.then(
        () => { passCount++; console.log("ok - " + name); },
        (err) => { failCount++; console.error("not ok - " + name); console.error(err.stack || err); process.exitCode = 1; }
      ));
    } else {
      passCount++; console.log("ok - " + name);
    }
  } catch (err) {
    failCount++; console.error("not ok - " + name); console.error(err.stack || err); process.exitCode = 1;
  }
}

// --- 1-4, 5, 6, 7, 8: eligibility, incl. StartDate irrelevance -------------
test("1. Pending can request cancellation", async () => {
  const ctx = backendContext({ "1": baseFields({ Status: "Pending" }) });
  const r = await ctx.PTORequests.requestCancellation("1", { actor: EMPLOYEE_ACTOR, reason: "changed plans" });
  assert.strictEqual(r.fields.Status, "Cancellation Requested");
  assert.strictEqual(r.fields.StatusBeforeCancellationRequest, "Pending");
});

test("2. Approved can request cancellation", async () => {
  const ctx = backendContext({ "2": baseFields({ Status: "Approved" }) });
  const r = await ctx.PTORequests.requestCancellation("2", { actor: EMPLOYEE_ACTOR, reason: "x" });
  assert.strictEqual(r.fields.StatusBeforeCancellationRequest, "Approved");
});

test("3. Auto-Approved can request cancellation", async () => {
  const ctx = backendContext({ "3": baseFields({ Status: "Auto-Approved" }) });
  const r = await ctx.PTORequests.requestCancellation("3", { actor: EMPLOYEE_ACTOR, reason: "x" });
  assert.strictEqual(r.fields.StatusBeforeCancellationRequest, "Auto-Approved");
});

test("4. Auto-Approved (Escalation) can request cancellation", async () => {
  const ctx = backendContext({ "4": baseFields({ Status: "Auto-Approved (Escalation)" }) });
  const r = await ctx.PTORequests.requestCancellation("4", { actor: EMPLOYEE_ACTOR, reason: "x" });
  assert.strictEqual(r.fields.StatusBeforeCancellationRequest, "Auto-Approved (Escalation)");
});

test("5. Rejected cannot request cancellation", async () => {
  const ctx = backendContext({ "5": baseFields({ Status: "Rejected" }) });
  await assert.rejects(
    () => ctx.PTORequests.requestCancellation("5", { actor: EMPLOYEE_ACTOR, reason: "x" }),
    /not eligible/
  );
});

test("6. Cancelled cannot request cancellation", async () => {
  const ctx = backendContext({ "6": baseFields({ Status: "Cancelled" }) });
  await assert.rejects(
    () => ctx.PTORequests.requestCancellation("6", { actor: EMPLOYEE_ACTOR, reason: "x" }),
    /not eligible/
  );
});

test("7. Cancellation Requested cannot request cancellation again", async () => {
  const ctx = backendContext({ "7": baseFields({ Status: "Cancellation Requested", StatusBeforeCancellationRequest: "Approved" }) });
  await assert.rejects(
    () => ctx.PTORequests.requestCancellation("7", { actor: EMPLOYEE_ACTOR, reason: "x" }),
    /not eligible/
  );
});

test("8. StartDate never affects cancellation eligibility (far past and far future both work)", async () => {
  const past = backendContext({ "8a": baseFields({ Status: "Approved", StartDate: "2020-01-01", EndDate: "2020-01-02" }) });
  const r1 = await past.PTORequests.requestCancellation("8a", { actor: EMPLOYEE_ACTOR, reason: "x" });
  assert.strictEqual(r1.fields.Status, "Cancellation Requested");

  const future = backendContext({ "8b": baseFields({ Status: "Approved", StartDate: "2099-01-01", EndDate: "2099-01-02" }) });
  const r2 = await future.PTORequests.requestCancellation("8b", { actor: EMPLOYEE_ACTOR, reason: "x" });
  assert.strictEqual(r2.fields.Status, "Cancellation Requested");
});

// --- 9, 10: authorization ----------------------------------------------------
test("9. Only the employee owner may request cancellation", async () => {
  const ctx = backendContext({ "9": baseFields({ Status: "Approved" }) });
  await assert.rejects(
    () => ctx.PTORequests.requestCancellation("9", { actor: OTHER_ACTOR, reason: "x" }),
    /Only the employee this request belongs to/
  );
  assert.strictEqual(ctx.PTOGraph.calls.updateListItem.length, 0, "no write should be attempted");
});

test("10. On-behalf submitter cannot cancel another employee's PTO", async () => {
  // SubmittedByEmail (the on-behalf submitter) is deliberately NOT the
  // RequesterEmail — being the submitter is never sufficient on its own.
  const ctx = backendContext({
    "10": baseFields({ Status: "Approved", SubmittedByEmail: OTHER_ACTOR.mail, SubmittedByName: OTHER_ACTOR.displayName }),
  });
  await assert.rejects(
    () => ctx.PTORequests.requestCancellation("10", { actor: OTHER_ACTOR, reason: "x" }),
    /Only the employee this request belongs to/
  );
});

// --- 11: preserves exact prior status ---------------------------------------
test("11. Request cancellation preserves the exact prior status", async () => {
  const ctx = backendContext({ "11": baseFields({ Status: "Auto-Approved (Escalation)" }) });
  const r = await ctx.PTORequests.requestCancellation("11", { actor: EMPLOYEE_ACTOR, reason: "x" });
  assert.strictEqual(r.fields.StatusBeforeCancellationRequest, "Auto-Approved (Escalation)");
  // AuditLog appended, not overwritten.
  assert(r.fields.AuditLog.indexOf("Created by Employee One") !== -1);
  assert(r.fields.AuditLog.indexOf("Cancellation Requested") !== -1);
});

// --- 12: complete -> Cancelled ------------------------------------------------
test("12. Complete cancellation changes status to Cancelled", async () => {
  const ctx = backendContext({ "12": baseFields({ Status: "Cancellation Requested", StatusBeforeCancellationRequest: "Approved" }) });
  const r = await ctx.PTORequests.completeCancellationRequest("12", { actor: HR_ACTOR, note: "done" });
  assert.strictEqual(r.fields.Status, "Cancelled");
  assert.strictEqual(r.fields.ModifiedByHr, true);
  assert.strictEqual(r.fields.HrActionType, "Completed Cancellation");
  assert.strictEqual(r.fields.HrNotes, "done");
  assert.strictEqual(r.fields.HrCancellationNote, undefined);
});

// --- 13-16: decline restores each prior status -------------------------------
["Pending", "Approved", "Auto-Approved", "Auto-Approved (Escalation)"].forEach((prior, idx) => {
  test((13 + idx) + ". Decline restores " + prior, async () => {
    const id = "decline-" + idx;
    const ctx = backendContext({ [id]: baseFields({ Status: "Cancellation Requested", StatusBeforeCancellationRequest: prior }) });
    const r = await ctx.PTORequests.declineCancellationRequest(id, { actor: HR_ACTOR, note: "declined" });
    assert.strictEqual(r.fields.Status, prior);
    assert.strictEqual(r.fields.HrActionType, "Declined Cancellation Request");
    assert.strictEqual(r.fields.HrNotes, "declined");
  });
});

// --- 17: decline fails closed on invalid/blank prior status ------------------
test("17. Decline fails closed when prior status is blank or invalid", async () => {
  const blank = backendContext({ "17a": baseFields({ Status: "Cancellation Requested", StatusBeforeCancellationRequest: "" }) });
  await assert.rejects(
    () => blank.PTORequests.declineCancellationRequest("17a", { actor: HR_ACTOR }),
    /prior status .* missing or invalid/
  );
  assert.strictEqual(blank.PTOGraph.calls.updateListItem.length, 0, "no write on blank prior status");

  const invalid = backendContext({ "17b": baseFields({ Status: "Cancellation Requested", StatusBeforeCancellationRequest: "Cancelled" }) });
  await assert.rejects(
    () => invalid.PTORequests.declineCancellationRequest("17b", { actor: HR_ACTOR }),
    /prior status .* missing or invalid/
  );
  assert.strictEqual(invalid.PTOGraph.calls.updateListItem.length, 0, "no write on invalid prior status");
});

// --- 18, 19: ETag conflict ---------------------------------------------------
test("18. ETag conflict produces the approved user-facing message", async () => {
  const ctx = backendContext({ "18": baseFields({ Status: "Approved" }) });
  // Simulate a concurrent write landing between re-read and PATCH: mutate the
  // stored etag directly, out from under the function's own re-read.
  const originalUpdate = ctx.PTOGraph.updateListItem.bind(ctx.PTOGraph);
  ctx.PTOGraph.updateListItem = async function (id, fields, options) {
    ctx.PTOGraph._items[id].etag = 'W/"etag-raced"'; // concurrent write happened
    return originalUpdate(id, fields, options);
  };
  await assert.rejects(
    () => ctx.PTORequests.requestCancellation("18", { actor: EMPLOYEE_ACTOR, reason: "x" }),
    /Someone already acted on this request\. Refresh and try again\./
  );
});

test("19. No write occurs after a 409/412 conflict (the failed PATCH itself is the only attempt — no automatic retry)", async () => {
  const ctx = backendContext({ "19": baseFields({ Status: "Approved" }) });
  let patchAttempts = 0;
  const originalUpdate = ctx.PTOGraph.updateListItem.bind(ctx.PTOGraph);
  ctx.PTOGraph.updateListItem = async function (id, fields, options) {
    patchAttempts++;
    ctx.PTOGraph._items[id].etag = 'W/"etag-raced"';
    return originalUpdate(id, fields, options);
  };
  await assert.rejects(() => ctx.PTORequests.requestCancellation("19", { actor: EMPLOYEE_ACTOR, reason: "x" }));
  assert.strictEqual(patchAttempts, 1, "exactly one PATCH attempt — no blind retry");
  assert.strictEqual(ctx.PTOGraph._items["19"].fields.Status, "Approved", "item must be unchanged after the conflict");
});

// --- 20, 21: HrNotes only -----------------------------------------------------
test("20. HrNotes is written (complete and decline both)", async () => {
  const ctx = backendContext({
    "20a": baseFields({ Status: "Cancellation Requested", StatusBeforeCancellationRequest: "Approved" }),
    "20b": baseFields({ Status: "Cancellation Requested", StatusBeforeCancellationRequest: "Approved" }),
  });
  const completed = await ctx.PTORequests.completeCancellationRequest("20a", { actor: HR_ACTOR, note: "note A" });
  assert.strictEqual(completed.fields.HrNotes, "note A");
  const declined = await ctx.PTORequests.declineCancellationRequest("20b", { actor: HR_ACTOR, note: "note B" });
  assert.strictEqual(declined.fields.HrNotes, "note B");
});

test("21. HrCancellationNote does not appear anywhere in active code or fixtures", () => {
  const files = [
    "js/requests.js", "js/demo-mode.js", "js/pages/hr.page.js",
    "js/demo-fixtures.js", "js/rules.js", "js/config.js",
  ];
  files.forEach((f) => {
    const src = read(f);
    assert(!src.includes(".HrCancellationNote"), f + " must never reference HrCancellationNote");
  });
});

// --- 22, 23: requester cannot be own backup ---------------------------------
test("22. Requester cannot be own backup", () => {
  const ctx = backendContext({});
  assert.throws(
    () => ctx.PTORules.flattenBackupContacts([{ name: "Employee One", email: "employee@mybasepay.com" }], "employee@mybasepay.com"),
    /cannot be listed as their own backup contact/
  );
});

test("23. Requester/backup compare is case-insensitive", () => {
  const ctx = backendContext({});
  assert.throws(
    () => ctx.PTORules.flattenBackupContacts([{ name: "Employee One", email: "EMPLOYEE@MyBasePay.com" }], "employee@mybasepay.com"),
    /cannot be listed as their own backup contact/
  );
  // A DIFFERENT person is unaffected regardless of case.
  const fields = ctx.PTORules.flattenBackupContacts([{ name: "Backup", email: "BACKUP@mybasepay.com" }], "employee@mybasepay.com");
  assert.strictEqual(fields.BackupContactEmail, "BACKUP@mybasepay.com");
});

test("22b. buildCreateRequestFields rejects the requester as their own backup end to end", () => {
  const ctx = backendContext({});
  assert.throws(() => ctx.PTORequests.buildCreateRequestFields(
    { ptoType: "PTO", startDate: "2026-09-01", endDate: "2026-09-02", BackupContacts: [{ name: "Employee One", email: "employee@mybasepay.com" }] },
    { requester: { id: "emp-1", displayName: "Employee One", mail: "employee@mybasepay.com" } }
  ), /cannot be listed as their own backup contact/);
});

// --- 26, 27: feature flag ----------------------------------------------------
test("26. Production feature flag defaults OFF", () => {
  const configSrc = read("js/config.js");
  assert(/employeeCancellationRequests:\s*false/.test(configSrc), "employeeCancellationRequests must default to false in js/config.js");
});

test("26b. Real backend functions refuse to run while the flag is off (defense in depth, not just a UI hide)", async () => {
  const ctx = backendContext({ "26": baseFields({ Status: "Approved" }) }, { featureEnabled: false });
  await assert.rejects(
    () => ctx.PTORequests.requestCancellation("26", { actor: EMPLOYEE_ACTOR, reason: "x" }),
    /not yet available in production/
  );
  await assert.rejects(
    () => ctx.PTORequests.completeCancellationRequest("26", { actor: HR_ACTOR }),
    /not yet available in production/
  );
  await assert.rejects(
    () => ctx.PTORequests.declineCancellationRequest("26", { actor: HR_ACTOR }),
    /not yet available in production/
  );
  assert.strictEqual(ctx.PTOGraph.calls.getListItem.length, 0, "must fail before ever reading the item");
});

test("27. Demo mode remains functional with the flag off (isEmployeeCancellationEnabled short-circuits true in demo)", () => {
  const context = {
    window: { location: { search: "?demo=1" } },
    console, URLSearchParams,
    sessionStorage: (() => {
      const store = {};
      return {
        getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
      };
    })(),
    document: {
      documentElement: { classList: { add() {} } },
      addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; },
      createElement() { return { className: "", textContent: "", setAttribute() {}, appendChild() {}, addEventListener() {} }; },
      body: { appendChild() {} },
    },
  };
  context.window.console = console;
  context.window.sessionStorage = context.sessionStorage;
  context.window.document = context.document;
  vm.createContext(context);
  vm.runInContext(read("js/rules.js"), context);
  vm.runInContext(read("js/requests.js"), context);
  vm.runInContext(read("js/demo-fixtures.js"), context);
  vm.runInContext(read("js/demo-mode.js"), context); // sets window.PTODemo = {active: true, ...} for ?demo=1
  assert.strictEqual(context.window.PTODemo && context.window.PTODemo.active, true, "sanity check: demo mode actually activated");
  // Simulate the production flag being off — demo must win regardless.
  context.window.PTOConfig = { features: { employeeCancellationRequests: false } };
  assert.strictEqual(context.window.PTORules.isEmployeeCancellationEnabled(), true,
    "demo mode must remain enabled even while the production flag is false");
});

// --- 24: backup-notified checkbox resets when backups change ---------------
test("24. Backup-notified checkbox resets when backups change (added, removed, or cleared)", () => {
  const src = read("js/pages/request.page.js");
  ["selectBackup", "removeBackup", "clearBackup"].forEach((fnName) => {
    const match = new RegExp("function " + fnName + "\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n  \\}").exec(src);
    assert(match, "could not locate function " + fnName + " in request.page.js");
    assert(
      match[1].includes("resetBackupNotified()"),
      fnName + "() must call resetBackupNotified() so a stale confirmation can never survive a changed backup list"
    );
  });
});

// --- 25: demo behavior matches the real contract ----------------------------
test("25. Demo behavior matches the real contract (decline restores every eligible prior status identically)", async () => {
  const priorStatuses = ["Pending", "Approved", "Auto-Approved", "Auto-Approved (Escalation)"];
  for (const prior of priorStatuses) {
    const real = backendContext({ "x": baseFields({ Status: "Cancellation Requested", StatusBeforeCancellationRequest: prior }) });
    const realResult = await real.PTORequests.declineCancellationRequest("x", { actor: HR_ACTOR, note: "n" });

    const demo = demoContext();
    // Item 9008 in the fixtures is Cancellation Requested / StatusBeforeCancellationRequest "Approved";
    // patch it in-place to each prior status via a fresh create+request-cancellation round trip instead,
    // so this test doesn't depend on fixture internals beyond what demoContext() already exposes.
    const created = await demo.PTORequests.createRequest(Object.assign(
      demo.PTORequests.buildCreateRequestFields(
        { ptoType: "PTO", startDate: "2026-09-01", endDate: "2026-09-02", BackupContacts: [] },
        { requester: { id: "emp-1", displayName: "Employee One", mail: "employee@mybasepay.com" } }
      ),
      { Status: prior, RequesterEmail: "employee@mybasepay.com" }
    ));
    await demo.PTORequests.requestCancellation(created.id, { actor: { id: "emp-1", displayName: "Employee One", mail: "employee@mybasepay.com" }, reason: "n" });
    const demoResult = await demo.PTORequests.declineCancellationRequest(created.id, { actor: HR_ACTOR, note: "n" });

    assert.strictEqual(demoResult.fields.Status, realResult.fields.Status, "restored Status must match for prior=" + prior);
    assert.strictEqual(demoResult.fields.HrActionType, realResult.fields.HrActionType);
    assert.strictEqual(demoResult.fields.HrNotes, realResult.fields.HrNotes);
  }
});

Promise.all(pending).then(() => {
  console.log(`\n${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) process.exitCode = 1;
});
