"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

// Exercise the actual controller functions with a small DOM double.
// No authentication, network calls, or production decisions are performed.
function loadFunction(context, file, name) {
  const match = read(file).match(new RegExp("^  function " + name + "\\([^]*?^  \\}", "m"));
  assert.ok(match, name + " must exist in " + file);
  vm.runInContext(match[0], context);
}

function node() {
  const attrs = {};
  return {
    style: {}, focused: false,
    setAttribute(key, value) { attrs[key] = value; },
    getAttribute(key) { return attrs[key] ?? null; },
    removeAttribute(key) { delete attrs[key]; },
    focus() { this.focused = true; },
  };
}

function menuHarness() {
  const items = Object.fromEntries(
    ["approval", "cancel", "cancel-sep", "resolve-sep", "resolve-confirm", "resolve-decline"].map(key => [key, node()])
  );
  const context = vm.createContext({
    window: {}, state: {}, PAST_START_REASON: "Unavailable after PTO start date",
    PTORequests: {
      HR_CANCELLABLE_STATUSES: ["Pending", "Approved", "Auto-Approved", "Auto-Approved (Escalation)"],
      CANCELLATION_REQUEST_PENDING_STATUS: "Cancellation Requested",
    },
    els: { rowMenu: { hidden: true, querySelectorAll: () => Object.values(items) } },
    menuItem: key => items[key],
    closeColumnPopover() {},
    positionFloatingPanel() {},
  });
  vm.runInContext(read("js/links.js"), context);
  context.PTOLinks = context.window.PTOLinks;
  for (const name of ["pad2", "todayDateOnly", "isPastStart", "cancellable",
    "pendingCancellationResolution", "isSickAutoApproved", "setMenuItemDisabled",
    "visibleMenuItems", "firstVisibleMenuItem", "openRowMenu"]) {
    loadFunction(context, "js/pages/hr.page.js", name);
  }
  return { context, items, open: request => context.openRowMenu(node(), request) };
}

test("Pending approval navigation works for past, current, future, and missing dates", () => {
  const h = menuHarness();
  for (const startDate of ["2000-01-01", h.context.todayDateOnly(), "2099-12-31", ""]) {
    h.open({ id: "17", ptoType: "PTO", status: "Pending", startDate });
    assert.equal(h.items.approval.getAttribute("href"), "approve.html#itemId=17");
    assert.equal(h.items.approval.getAttribute("aria-disabled"), null);
    assert.equal(h.items.approval.getAttribute("title"), null);
    assert.equal(h.items.approval.style.display, "");
    assert.equal(h.items.approval.focused, true);
    assert.equal(h.items.cancel.style.display, "");
    assert.equal(h.items.cancel.getAttribute("aria-disabled"), null);
  }
});

test("historical auto-approved Sick stays hidden and a subsequent Pending Sick row is enabled", () => {
  const h = menuHarness();
  h.open({ id: "18", ptoType: "Sick", status: "Auto-Approved", startDate: "2000-01-01" });
  assert.equal(h.items.approval.style.display, "none");
  assert.equal(h.items.approval.getAttribute("href"), null);
  h.open({ id: "19", ptoType: "Sick", status: "Pending", startDate: "2000-01-01" });
  assert.equal(h.items.approval.style.display, "");
  assert.equal(h.items.approval.getAttribute("href"), "approve.html#itemId=19");
  assert.equal(h.items.approval.getAttribute("aria-disabled"), null);
});

test("opening another row clears stale disabled approval attributes", () => {
  const h = menuHarness();
  h.items.approval.setAttribute("aria-disabled", "true");
  h.items.approval.setAttribute("title", "Unavailable after PTO start date");
  h.open({ id: "20", ptoType: "PTO", status: "Pending", startDate: "2000-01-01" });
  assert.equal(h.items.approval.getAttribute("aria-disabled"), null);
  assert.equal(h.items.approval.getAttribute("title"), null);
  assert.equal(h.items.approval.getAttribute("href"), "approve.html#itemId=20");
  assert.ok(h.context.visibleMenuItems().includes(h.items.approval));
});

function gateHarness() {
  const context = vm.createContext({
    window: {}, state: { fields: {}, approverMeta: {} },
    els: { blockNote: node(), statusNote: node(), decisionUi: node() },
    myEmail: () => "reviewer@example.test",
    showNote(element, text) { element.textContent = text; },
  });
  vm.runInContext(read("js/rules.js"), context);
  context.PTORules = context.window.PTORules;
  loadFunction(context, "js/pages/approve.page.js", "evaluateGate");
  return context;
}

test("HR/Admin gate permits Pending decisions after the start date", () => {
  const h = gateHarness();
  h.state.isHrAdmin = true;
  h.state.fields = { Status: "Pending", StartDate: "2000-01-01", ManagerEmail: "manager@example.test" };
  h.evaluateGate();
  assert.equal(h.state.canAct, true);
  assert.equal(h.els.decisionUi.style.display, "");
});

test("approval gate still blocks unrelated users and non-Pending statuses", () => {
  const h = gateHarness();
  h.state.isHrAdmin = false;
  h.state.fields = { Status: "Pending", StartDate: "2000-01-01", ManagerEmail: "manager@example.test" };
  h.evaluateGate();
  assert.equal(h.state.canAct, false);
  assert.equal(h.els.decisionUi.style.display, "none");
  for (const status of ["Approved", "Rejected", "Cancelled", "Cancellation Requested", "Auto-Approved"]) {
    h.state.isHrAdmin = true;
    h.state.fields.Status = status;
    h.evaluateGate();
    assert.equal(h.els.decisionUi.style.display, "none");
    assert.match(h.els.statusNote.textContent, /already/);
  }
});

test("non-Pending navigation does not enable cancellation of final requests", () => {
  const h = menuHarness();
  for (const status of ["Rejected", "Cancelled"]) {
    h.open({ id: "21", ptoType: "PTO", status, startDate: "2000-01-01" });
    assert.equal(h.items.approval.getAttribute("href"), "approve.html#itemId=21");
    assert.equal(h.items.cancel.style.display, "none");
    assert.equal(h.items["resolve-confirm"].style.display, "none");
  }
});
