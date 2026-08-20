/*
 * no-auto-approval.test.cjs — regression fence for the HR business-rule change
 * of 2026-08-19: PTO Central must never set Status = "Auto-Approved"
 * automatically, for ANY PTO type, for ANY reason.
 *
 * Before this change, `PTORules.getInitialStatus("Sick")` returned
 * "Auto-Approved" and `buildCreateRequestFields()` wrote it straight into the
 * SharePoint item at creation time. Sick now enters the normal approval
 * workflow as "Pending" like every other type.
 *
 * This is currently the only automated test file in this repository. It loads
 * the REAL browser files into a `vm` sandbox and exercises them; nothing is
 * mocked, and Microsoft Graph is never reached because the functions under
 * test (`getInitialStatus`, `buildCreateRequestFields`) are pure.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

/** Load the real js/rules.js + js/requests.js into a sandbox. */
function appContext() {
  const context = { window: {}, console };
  vm.createContext(context);
  // rules.js reads `window.PTOConfig` bare-after-guard at module-load time, so
  // it must be loaded BEFORE window.PTOConfig is set — otherwise that
  // (pre-existing, unrelated) latent bug trips during load.
  vm.runInContext(read("js/rules.js"), context);
  context.window.PTOConfig = { features: {} };
  context.PTORules = context.window.PTORules;
  vm.runInContext(read("js/requests.js"), context);
  context.PTORequests = context.window.PTORequests;
  return context;
}

// Every PTO type the SharePoint Status/PtoType choice columns support
// (scripts/provisioning/provision-sharepoint-list.ps1 in pto-central-ops).
const ALL_PTO_TYPES = ["PTO", "MHD", "Sick", "Bereavement", "Parental Leave", "Other Leave"];

const REQUESTER = { id: "emp-1", displayName: "Employee One", mail: "employee@mybasepay.com" };
const MANAGER = { id: "mgr-1", displayName: "Manager One", mail: "manager@mybasepay.com" };
const SKIP = { id: "skip-1", displayName: "Skip Manager", mail: "skip@mybasepay.com" };

function buildFields(ctx, ptoType, overrides) {
  return ctx.PTORequests.buildCreateRequestFields(
    Object.assign(
      { ptoType: ptoType, startDate: "2026-09-01", endDate: "2026-09-02", reason: "test" },
      (overrides && overrides.input) || {}
    ),
    Object.assign(
      {
        requester: REQUESTER,
        submitter: REQUESTER,
        manager: MANAGER,
        managersManager: SKIP,
        onBehalf: false,
        submittedAt: "2026-08-19T12:00:00.000Z",
      },
      (overrides && overrides.context) || {}
    )
  );
}

// ---------------------------------------------------------------------------
// getInitialStatus — the single decision point that used to auto-approve Sick
// ---------------------------------------------------------------------------

test("getInitialStatus returns 'Pending' for every supported PTO type, Sick included", function () {
  const ctx = appContext();
  ALL_PTO_TYPES.forEach(function (type) {
    assert.equal(ctx.PTORules.getInitialStatus(type), "Pending", type + " must start Pending");
  });
});

test("getInitialStatus returns 'Pending' for every casing and spacing of 'Sick'", function () {
  const ctx = appContext();
  ["Sick", "sick", "SICK", "SiCk", " Sick ", "sick time", "Sick Time"].forEach(function (v) {
    assert.equal(ctx.PTORules.getInitialStatus(v), "Pending", JSON.stringify(v) + " must start Pending");
  });
});

test("getInitialStatus returns 'Pending' for missing, empty, and non-string input", function () {
  const ctx = appContext();
  [undefined, null, "", 0, 1, {}, [], true, false].forEach(function (v) {
    assert.equal(ctx.PTORules.getInitialStatus(v), "Pending", JSON.stringify(v) + " must start Pending");
  });
});

test("getInitialStatus can never return any Auto-Approved value", function () {
  const ctx = appContext();
  const inputs = ALL_PTO_TYPES.concat(["Sick", "sick", "", null, undefined, "Auto-Approved"]);
  inputs.forEach(function (v) {
    const s = ctx.PTORules.getInitialStatus(v);
    assert.notEqual(s, "Auto-Approved");
    assert.notEqual(s, "Auto-Approved (Escalation)");
    assert.doesNotMatch(String(s), /auto/i, "status for " + JSON.stringify(v) + " must not mention auto-approval");
  });
});

// ---------------------------------------------------------------------------
// buildCreateRequestFields — the payload actually POSTed to SharePoint
// ---------------------------------------------------------------------------

test("a new request of ANY type is created with Status 'Pending'", function () {
  const ctx = appContext();
  ALL_PTO_TYPES.forEach(function (type) {
    assert.equal(buildFields(ctx, type).Status, "Pending", type + " must be created Pending");
  });
});

test("a new Sick request carries no auto-approval evidence of any kind", function () {
  const ctx = appContext();
  const f = buildFields(ctx, "Sick");
  assert.equal(f.Status, "Pending");
  assert.equal(f.AutoApprovedAt, undefined, "must not stamp an auto-approval time");
  assert.equal(f.AutoApprovalReason, undefined, "must not stamp an auto-approval reason");
  assert.equal(f.DecisionDate, undefined, "must not pre-record a decision");
  assert.equal(f.DecisionByName, undefined, "must not pre-record a decider");
  assert.equal(f.DecisionByEmail, undefined, "must not pre-record a decider");
  assert.doesNotMatch(f.AuditLog, /auto-?approv/i, "the audit line must not claim an auto-approval");
});

test("no created request, of any type, carries an Auto-Approved value anywhere in its payload", function () {
  const ctx = appContext();
  ALL_PTO_TYPES.forEach(function (type) {
    const serialized = JSON.stringify(buildFields(ctx, type));
    assert.doesNotMatch(serialized, /Auto-Approved/, type + " payload must not contain 'Auto-Approved'");
  });
});

test("Sick is created identically to every other type (no per-type divergence remains)", function () {
  const ctx = appContext();
  // Compare a Sick payload with an Other Leave payload field-by-field. The ONLY
  // difference permitted is PtoType itself and the Title (a random request key).
  const sick = buildFields(ctx, "Sick", { input: { requestKey: "PTO-FIXED-KEY" } });
  const other = buildFields(ctx, "Other Leave", { input: { requestKey: "PTO-FIXED-KEY" } });
  // buildAuditLine() stamps the CURRENT time (not submittedAt), so two calls
  // can legitimately straddle a millisecond. Normalise that leading "[ISO] "
  // prefix away before comparing — otherwise this test is flaky.
  const stripStamp = (v) =>
    typeof v === "string" ? v.replace(/^\[[^\]]+\]\s*/, "[TS] ") : v;
  const differing = Object.keys(Object.assign({}, sick, other)).filter(function (k) {
    return JSON.stringify(stripStamp(sick[k])) !== JSON.stringify(stripStamp(other[k]));
  });
  assert.deepEqual(differing.sort(), ["PtoType"], "Sick must differ from other types only in PtoType");
  // Absolute assertion too — a relative comparison alone would still pass if
  // BOTH types auto-approved.
  assert.equal(sick.Status, "Pending");
  assert.equal(other.Status, "Pending");
});

test("Sick now enters the reminder timeline: NextReminderAt is seeded like every other type", function () {
  const ctx = appContext();
  ALL_PTO_TYPES.forEach(function (type) {
    const f = buildFields(ctx, type);
    assert.equal(
      f.NextReminderAt,
      "2026-08-21T12:00:00.000Z", // SubmittedAt + 48h
      type + " must carry a first reminder due-time"
    );
  });
});

// ---------------------------------------------------------------------------
// Manager decisions — must be entirely unaffected
// ---------------------------------------------------------------------------

test("updateRequestDecision still accepts only 'Approved' and 'Rejected'", async function () {
  const ctx = appContext();
  for (const bad of ["Auto-Approved", "Auto-Approved (Escalation)", "Pending", "Cancelled", "", null]) {
    await assert.rejects(
      async function () {
        await ctx.PTORequests.updateRequestDecision(1, { status: bad, actor: MANAGER });
      },
      /status must be 'Approved' or 'Rejected'/,
      "status " + JSON.stringify(bad) + " must be refused"
    );
  }
});

// ---------------------------------------------------------------------------
// Exhaustive behavioural fence.
//
// NOTE ON SOURCE GUARDS: a grep for an `Auto-Approved` literal being assigned
// to Status is NOT a useful guard here, and was deliberately removed after it
// was shown to pass against the very code it was meant to catch. The removed
// rule never wrote a literal — js/requests.js writes `Status: status`, where
// `status` came from getInitialStatus(). Any regression would come back the
// same way: through a value, not a literal. So the fence below is behavioural
// and exhaustive over the actual payload instead.
// ---------------------------------------------------------------------------

test("EXHAUSTIVE: no PTO type, in any submission shape, is ever created with a non-Pending status", function () {
  const ctx = appContext();
  const types = ALL_PTO_TYPES.concat(["Sick", "sick", "SICK", " Sick ", "sick time", "", null, undefined, "Vacation"]);
  const contexts = [
    { manager: MANAGER, onBehalf: false },
    { manager: null, onBehalf: false },
    { manager: MANAGER, onBehalf: true, submitter: { id: "hr-1", displayName: "HR", mail: "hr@mybasepay.com" } },
    { manager: null, managersManager: null, onBehalf: false },
  ];
  const inputs = [
    {},
    { isPartialDay: true, hours: 4 },
    { startDate: "2026-08-20", endDate: "2026-08-20" }, // short notice
    { reason: "x", backupContactName: "B", backupContactEmail: "b@mybasepay.com" },
  ];
  let checked = 0;
  types.forEach(function (type) {
    contexts.forEach(function (c) {
      inputs.forEach(function (i) {
        const f = buildFields(ctx, type, { input: i, context: c });
        assert.equal(f.Status, "Pending", "type=" + JSON.stringify(type) + " must be Pending");
        assert.doesNotMatch(JSON.stringify(f), /Auto-Approved/, "type=" + JSON.stringify(type) + " payload");
        checked++;
      });
    });
  });
  assert.ok(checked >= 100, "expected a wide sweep, checked " + checked);
});

test("SOURCE GUARD: js/rules.js contains no Sick-specific branch and no Auto-Approved literal", function () {
  const code = read("js/rules.js").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.equal(/sick/i.test(code), false, "js/rules.js must not special-case Sick in executable code");
  assert.equal(/Auto-Approved/.test(code), false, "js/rules.js must not mention Auto-Approved in executable code");
});

test("SOURCE GUARD: getInitialStatus has no conditional at all — it is a constant function", function () {
  const ctx = appContext();
  const src = ctx.PTORules.getInitialStatus.toString().replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.equal(/\?|if\s*\(|switch\s*\(|&&|\|\|/.test(src), false,
    "getInitialStatus must contain no branch — any branch is a route back to a per-type status: " + src);
});

// ---------------------------------------------------------------------------
// HR ACCEPTANCE CHECKLIST — the app-side half of the numbered verification
// points in the 2026-08-19 change request. (Points 3–8 and 11 are processor
// behaviour, tested in mybasepay-tech/pto-central-ops.)
// ---------------------------------------------------------------------------

test("HR-1. No request type is automatically created as Auto-Approved", function () {
  const ctx = appContext();
  ALL_PTO_TYPES.concat(["Vacation", "sick", "SICK", "", null, undefined]).forEach(function (type) {
    const f = buildFields(ctx, type);
    assert.equal(f.Status, "Pending", JSON.stringify(type));
    assert.notEqual(f.Status, "Auto-Approved");
    assert.notEqual(f.Status, "Auto-Approved (Escalation)");
  });
});

test("HR-2a. Sick Time is created as Pending", function () {
  const ctx = appContext();
  assert.equal(buildFields(ctx, "Sick").Status, "Pending");
});

test("HR-2b. Sick Time requires a valid approval route — the old exemption is gone", function () {
  // The submit-time validation lives in js/pages/request.page.js. Assert on the
  // real source that the `type !== "Sick"` exemption no longer guards the
  // approval-route requirement, and that no other type is exempted either.
  const code = read("js/pages/request.page.js")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const guard = /if\s*\(\s*!state\.target\.manager\s*&&\s*!state\.approverOverride\.active\s*\)/;
  assert.match(code, guard, "the approval-route requirement must apply unconditionally");
  assert.equal(
    /type\s*!==\s*["']Sick["']\s*&&\s*!state\.target\.manager/.test(code),
    false,
    "Sick must no longer be exempt from the approval-route requirement"
  );
});

test("HR-9. Manager approve/deny behaviour is unchanged", async function () {
  const ctx = appContext();
  // The decision allow-list is exactly the two human outcomes. NOTE: this
  // system's denial status is "Rejected" — there is no "Denied" value in the
  // SharePoint Status choice column. See the change report.
  for (const good of ["Approved", "Rejected"]) {
    // Reaches the Graph call (which is absent here) rather than the validator,
    // proving the value passed validation.
    await assert.rejects(
      async function () { await ctx.PTORequests.updateRequestDecision(1, { status: good, actor: MANAGER }); },
      function (err) { return !/status must be 'Approved' or 'Rejected'/.test(err.message); },
      good + " must pass the decision validator"
    );
  }
});

test("HR-10. The cancellation restore path can only restore, never create, an Auto-Approved status", function () {
  // resolveCancellationRequest writes `Status: restoreStatus`, sourced from the
  // record's own StatusBeforeCancellationRequest snapshot — a variable, never a
  // literal. Assert on the real source that no Auto-Approved literal is
  // assignable to Status anywhere in requests.js.
  const code = read("js/requests.js")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.equal(
    /Status\s*:\s*["']Auto-Approved/.test(code),
    false,
    "no code path may assign an Auto-Approved literal to Status"
  );
  assert.match(code, /Status:\s*restoreStatus/, "the restore path must write the snapshot variable, not a literal");
});
