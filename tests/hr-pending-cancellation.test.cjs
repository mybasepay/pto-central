"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");

const HR = { id: "hr-1", mail: "hr@example.test", displayName: "HR Example" };
const MANAGER = { id: "manager-1", mail: "manager@example.test", displayName: "Manager Example" };
const CANCEL_COLUMNS = ["CancelledById", "CancelledByEmail", "CancelledByName", "CancelledAt", "CancelReason"];

function harness(options = {}) {
  const item = {
    id: "17", eTag: '"v7"', fields: {
      Status: "Pending", AuditLog: "Original audit\nMost recent notification",
      StartDate: "2020-01-01", EndDate: "2020-01-02",
      EmployeeEventId: "", CorpEventId: "", FinOpsEventId: "",
      ...options.fields,
    },
  };
  if (options.noEtag) delete item.eTag;
  const calls = { reads: 0, roles: [], writes: [] };
  const context = { window: {}, console: { log() {}, warn() {}, error() {} } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "js/rules.js"), "utf8"), context);
  context.PTORules = context.window.PTORules;
  context.window.PTOConfig = { features: {} };
  context.window.PTOAuthz = {
    async hasRole(email, allowed) {
      calls.roles.push({ email, allowed: Array.from(allowed) });
      if (options.roleError) throw new Error("Authorization lookup failed");
      return options.authorized !== false;
    },
  };
  context.PTOGraph = {
    async getMe() { return options.me || HR; },
    async getListItem(id) { assert.equal(String(id), item.id); calls.reads++; return structuredClone(item); },
    async resolveContext() { return { siteId: "site-1", listId: "list-1" }; },
    async getListColumns() {
      if (options.columnError) throw new Error("Column lookup failed");
      return { value: (options.columns || CANCEL_COLUMNS).map(name => ({ name })) };
    },
    async updateListItem(id, fields, writeOptions) {
      calls.writes.push({ id, fields: structuredClone(fields), options: structuredClone(writeOptions) });
      if (options.onWrite) await options.onWrite({ item, fields, writeOptions, number: calls.writes.length });
      Object.assign(item.fields, fields);
      return fields;
    },
  };
  vm.runInContext(fs.readFileSync(path.join(root, "js/requests.js"), "utf8"), context);
  return { app: context.window.PTORequests, context, item, calls };
}

function cancel(h, overrides = {}) {
  return h.app.cancelRequest(17, {
    currentStatus: "Pending", reason: "Dates no longer needed",
    existingAuditLog: "OUTDATED UI AUDIT", actor: { displayName: "Untrusted caller" }, ...overrides,
  });
}

test("HR cancels a Pending request directly, with actual actor and preserved live audit", async () => {
  const h = harness();
  const result = await cancel(h);
  assert.equal(result.fields.Status, "Cancelled");
  assert.equal(h.calls.writes.length, 1);
  assert.deepEqual(h.calls.writes[0].options, { ifMatch: '"v7"' });
  assert.equal(result.fields.CancelledById, HR.id);
  assert.equal(result.fields.CancelledByEmail, HR.mail);
  assert.equal(result.fields.CancelledByName, HR.displayName);
  assert.equal(result.fields.CancelReason, "Dates no longer needed");
  assert.ok(Number.isFinite(Date.parse(result.fields.CancelledAt)));
  assert.match(result.fields.AuditLog, /^Original audit\nMost recent notification\n/);
  assert.match(result.fields.AuditLog, /Cancelled by HR Example.*cancellation of pending request.*Dates no longer needed/);
  assert.doesNotMatch(result.fields.AuditLog, /OUTDATED UI AUDIT|Untrusted caller/);
  assert.deepEqual(h.calls.roles, [{ email: HR.mail, allowed: ["HR", "Admin"] }]);
  for (const field of ["CorpEventId", "EmployeeEventId", "FinOpsEventId", "DecisionById", "DecisionDate", "DecisionComment", "NextReminderAt"]) {
    assert.equal(Object.hasOwn(result.fields, field), false, field + " is not written");
  }
});

test("past, current, and future Pending dates do not block HR cancellation", async () => {
  for (const start of ["2000-01-01", new Date().toISOString().slice(0, 10), "2099-12-31"]) {
    const h = harness({ fields: { StartDate: start, EndDate: start } });
    assert.equal((await cancel(h)).fields.Status, "Cancelled");
  }
});

test("all previously cancellable approved statuses still work and keep all event IDs", async () => {
  for (const status of ["Approved", "Auto-Approved", "Auto-Approved (Escalation)"]) {
    const h = harness({ fields: { Status: status, CorpEventId: "corporate", EmployeeEventId: "employee", FinOpsEventId: "finops" } });
    const result = await cancel(h, { currentStatus: status });
    assert.equal(result.fields.Status, "Cancelled");
    for (const [key, value] of Object.entries({ CorpEventId: "corporate", EmployeeEventId: "employee", FinOpsEventId: "finops" })) {
      assert.equal(h.item.fields[key], value);
      assert.equal(Object.hasOwn(result.fields, key), false);
    }
  }
});

test("non-HR account cannot directly cancel Pending even with a forged actor", async () => {
  const me = { mail: "employee@example.test", id: "employee-1", displayName: "Employee" };
  const h = harness({ me, authorized: false });
  await assert.rejects(cancel(h, { actor: HR }), /Only HR\/Admin/);
  assert.equal(h.calls.writes.length, 0);
  assert.equal(h.calls.roles[0].email, me.mail);
});

test("missing or failed HR role lookup never writes", async () => {
  const h = harness();
  delete h.context.window.PTOAuthz;
  await assert.rejects(cancel(h), /Only HR\/Admin/);
  assert.equal(h.calls.writes.length, 0);
  const denied = harness({ roleError: true });
  await assert.rejects(cancel(denied), /Authorization lookup failed/);
  assert.equal(denied.calls.writes.length, 0);
});

test("final states and Cancellation Requested still use their existing paths", async () => {
  for (const status of ["Rejected", "Cancelled", "Cancellation Requested", "", "Unknown"]) {
    const h = harness({ fields: { Status: status } });
    await assert.rejects(cancel(h, { currentStatus: status }), /can't be cancelled|already Cancelled/);
    assert.equal(h.calls.writes.length, 0);
  }
});

test("stale Pending UI cannot cancel a request that has just been approved or cancelled", async () => {
  for (const status of ["Approved", "Cancelled", "Rejected", "Cancellation Requested"]) {
    const h = harness({ fields: { Status: status } });
    await assert.rejects(cancel(h), /request changed/);
    assert.equal(h.calls.writes.length, 0);
  }
});

test("an absent or wildcard etag refuses cancellation without a write", async () => {
  const missing = harness({ noEtag: true });
  await assert.rejects(cancel(missing), /current request version/);
  assert.equal(missing.calls.writes.length, 0);
  const wildcard = harness(); wildcard.item.eTag = "*";
  await assert.rejects(cancel(wildcard), /current request version/);
  assert.equal(wildcard.calls.writes.length, 0);
});

test("409/412 cancellation conflicts stop without retrying an unconditional write", async () => {
  for (const status of [409, 412]) {
    const h = harness({ onWrite() { throw Object.assign(new Error("invalid stale version"), { status }); } });
    await assert.rejects(cancel(h), /changed before it could be cancelled/);
    assert.equal(h.calls.writes.length, 1);
    assert.equal(h.item.fields.Status, "Pending");
  }
});

test("optional metadata fallback keeps the same If-Match and audit", async () => {
  const h = harness({ onWrite({ number }) { if (number === 1) throw Object.assign(new Error("Field does not exist"), { status: 400 }); } });
  const result = await cancel(h);
  assert.equal(h.calls.writes.length, 2);
  assert.deepEqual(h.calls.writes[0].options, h.calls.writes[1].options);
  assert.deepEqual(Object.keys(result.fields).sort(), ["AuditLog", "Status"]);
  assert.equal(h.calls.writes[0].fields.AuditLog, h.calls.writes[1].fields.AuditLog);
});

test("a concurrent change between metadata failure and fallback is not overwritten", async () => {
  const h = harness({ onWrite({ number }) {
    if (number === 1) throw Object.assign(new Error("Field invalid"), { status: 400 });
    throw Object.assign(new Error("version mismatch"), { status: 412 });
  } });
  await assert.rejects(cancel(h), /changed before it could be cancelled/);
  assert.equal(h.calls.writes.length, 2);
  assert.equal(h.item.fields.Status, "Pending");
});

test("missing optional columns or failed metadata lookup still permit a conditional core-only cancellation", async () => {
  for (const options of [{ columns: [] }, { columnError: true }]) {
    const h = harness(options);
    const result = await cancel(h);
    assert.deepEqual(Object.keys(result.fields).sort(), ["AuditLog", "Status"]);
    assert.equal(h.calls.writes[0].options.ifMatch, '"v7"');
  }
});

test("stale approval cannot resurrect a cancelled request", async () => {
  const h = harness({ fields: { Status: "Cancelled" } });
  await assert.rejects(h.app.updateRequestDecision(17, { status: "Approved", actor: MANAGER }), /request changed.*Cancelled/);
  assert.equal(h.calls.writes.length, 0);
});

test("Pending manager approval/rejection uses current audit and fresh etag", async () => {
  for (const status of ["Approved", "Rejected"]) {
    const h = harness();
    const result = await h.app.updateRequestDecision(17, { status, actor: MANAGER, comment: "Reviewed", existingAuditLog: "OLD" });
    assert.equal(result.fields.Status, status);
    assert.match(result.fields.AuditLog, /^Original audit\nMost recent notification\n/);
    assert.match(result.fields.AuditLog, /Manager Example.*Reviewed/);
    assert.equal(h.calls.writes[0].options.ifMatch, '"v7"');
  }
});

test("cancellation landing after approval read produces conflict and is not overwritten", async () => {
  const h = harness({ onWrite({ item }) {
    item.fields.Status = "Cancelled";
    throw Object.assign(new Error("etag mismatch"), { status: 412 });
  } });
  await assert.rejects(h.app.updateRequestDecision(17, { status: "Approved", actor: MANAGER }), /changed before your decision/);
  assert.equal(h.item.fields.Status, "Cancelled");
  assert.equal(h.calls.writes.length, 1);
});

test("approval landing after cancellation read produces conflict and is not overwritten", async () => {
  const h = harness({ onWrite({ item }) {
    item.fields.Status = "Approved";
    throw Object.assign(new Error("etag mismatch"), { status: 412 });
  } });
  await assert.rejects(cancel(h), /changed before it could be cancelled/);
  assert.equal(h.item.fields.Status, "Approved");
  assert.equal(h.calls.writes.length, 1);
});

test("employee Pending cancellation still requests HR review rather than directly cancelling", async () => {
  const h = harness({ authorized: false, columns: ["StatusBeforeCancellationRequest", "CancellationRequestReason"] });
  const result = await h.app.requestCancellation(17, {
    currentStatus: "Pending", reason: "Dates changed", existingAuditLog: "Original audit", ifMatch: '"v7"',
    actor: { id: "employee-1", displayName: "Employee Example", mail: "employee@example.test" },
  });
  assert.equal(result.fields.Status, "Cancellation Requested");
  assert.equal(result.fields.StatusBeforeCancellationRequest, "Pending");
  assert.equal(h.calls.roles.length, 0);
  assert.equal(h.calls.writes[0].options.ifMatch, '"v7"');
});
