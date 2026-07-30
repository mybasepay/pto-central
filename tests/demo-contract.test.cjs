const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`not ok - ${name}`);
    console.error(err.stack || err);
    process.exitCode = 1;
  }
}

test("demo mode never references production network/write APIs", () => {
  const demo = read("js/demo-mode.js");
  assert(!/\bPTOGraph\b/.test(demo), "demo adapter must not call PTOGraph");
  assert(!/\bfetch\s*\(/.test(demo), "demo adapter must not call fetch");
  assert(!/createListItem|updateListItem|Graph\.request/.test(demo), "demo adapter must not call production writes");
});

test("request first-step gate is present and required", () => {
  const html = read("request.html");
  const js = read("js/pages/request.page.js");
  assert(html.includes("request-type-step"));
  assert(html.includes("requestTypeSelf"));
  assert(html.includes("requestTypeOther"));
  assert(js.includes("if (!state.requestType) return"));
  assert(js.includes('els.requestTypeStep.style.display = state.requestType ? "none" : "block"'));
  assert(js.includes("function changeRequestType"));
  assert(js.includes("state.requestType = null"));
});

test("self request does not show employee picker and another employee does", () => {
  const js = read("js/pages/request.page.js");
  assert(/chooseRequestType\(type\)[\s\S]*type === "self"[\s\S]*oboSection\) els\.oboSection\.style\.display = "none"/.test(js));
  assert(/type === "self"[\s\S]*else[\s\S]*oboSection\) els\.oboSection\.style\.display = "block"/.test(js));
  assert(js.includes('classList.toggle("is-self", state.requestType === "self")'));
  assert(js.includes('classList.toggle("is-other", state.requestType === "other")'));
  assert(js.includes('setSubmitText("Submit my PTO request")'));
  assert(js.includes('setSubmitText("Submit PTO request for employee")'));
});

test("approved submit selected-state layout is present", () => {
  const html = read("request.html");
  const css = read("styles.css");
  assert(html.includes("person-details-card"));
  assert(html.includes("request-details-card"));
  assert(html.includes("selected-employee-card"));
  assert(html.includes("person-info-list"));
  assert(html.includes("final-action-row"));
  assert(css.includes("grid-template-columns: minmax(290px, 360px) minmax(0, 1fr)"));
  assert(css.includes("employee-picker-layout"));
});

test("another employee requires a selected employee", () => {
  const js = read("js/pages/request.page.js");
  assert(js.includes("Select the employee first"));
});

test("backup contact is required", () => {
  const js = read("js/pages/request.page.js");
  assert(js.includes("Select a backup contact before submitting"));
  assert(!js.includes("name only"), "backup lookup should not keep the old free-text fallback");
  assert(!js.includes("You can submit without a backup contact"), "backup is no longer optional");
});

test("submit people pickers are reactive and have no search buttons", () => {
  const html = read("request.html");
  const js = read("js/pages/request.page.js");
  assert(!html.includes("oboLookup"));
  assert(!html.includes("backupLookup"));
  assert(!html.includes("approverLookup"));
  assert(!/>\s*(Search|Lookup approver)\s*<\/button>/.test(html));
  assert((js.match(/PTOUI\.peoplePicker/g) || []).length >= 3);
  assert(js.includes("input: els.backupSearch"));
  assert(js.includes("input: els.oboSearch"));
  assert(js.includes("input: els.approverEmail"));
  assert(js.includes("selected: els.backupSelected"));
  assert(js.includes("selected: els.oboSelected"));
});

test("approver can be changed and invalid self-approval is blocked", () => {
  const js = read("js/pages/request.page.js");
  assert(js.includes("selectApprover"));
  assert(js.includes("You can't route approval to yourself"));
  assert(js.includes("employee receiving PTO"));
  assert(js.includes("No default manager found"));
  assert(js.includes("Select approver"));
});

test("approver resets when employee/request type changes", () => {
  const js = read("js/pages/request.page.js");
  assert(js.includes("function resetApproverOverride"));
  assert(/selectEmployee[\s\S]*resetApproverOverride\(\)/.test(js));
  assert(/chooseRequestType[\s\S]*resetApproverOverride\(\)/.test(js));
});

test("review summary distinguishes self and another employee", () => {
  const js = read("js/pages/request.page.js");
  assert(js.includes("Submitted by"));
  assert(js.includes("Employee receiving PTO"));
  assert(js.includes("Default manager"));
  assert(js.includes("Selected approver"));
});

test("HR Open action renders modal-only detail", () => {
  const html = read("hr.html");
  const js = read("js/pages/hr.page.js");
  assert(html.includes('data-act="open"'));
  assert(html.includes("hr-detail-modal"));
  assert(!html.includes('data-act="open" role="menuitem" href='));
  assert(!js.includes("relativeDetailUrl"));
  assert(js.includes("openDetailsModal"));
  assert(js.includes("openDetailLink"));
});

test("detail page renders selected record", () => {
  const html = read("pto-detail.html");
  const js = read("js/pages/detail.page.js");
  assert(html.includes("PTO Request Detail"));
  assert(js.includes("getRequestById"));
  assert(js.includes("itemIdFromUrl"));
});

test("cancel workspace is routed internally and uses existing cancellation API", () => {
  const home = read("index.html");
  const html = read("cancel.html");
  const js = read("js/pages/cancel.page.js");
  assert(home.includes('href="cancel.html"'));
  assert(html.includes("Active and Upcoming"));
  assert(html.includes("Past and Closed"));
  assert(js.includes("PTORequests.cancelRequest"));
  assert(js.includes("PTORequests.listMyRequests"));
});

test("demo fixtures include required statuses and reminder examples", () => {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(read("js/demo-fixtures.js"), context);
  const requests = context.window.PTODemoFixtures.requests;
  const statuses = new Set(requests.map((r) => r.fields.Status));
  ["Pending", "Approved", "Rejected", "Auto-Approved", "Cancelled", "Cancellation Requested"].forEach((s) => assert(statuses.has(s), s));
  assert(requests.some((r) => r.fields.IsShortNotice), "needs short-notice request");
  assert(requests.some((r) => r.fields.DemoReminderStage === "Awaiting Reminder 2"), "needs reminder 2 example");
  assert(requests.some((r) =>
    r.fields.RequesterName === "No Manager Demo" &&
    !r.fields.ManagerEmail &&
    r.fields.ApproverOverride === true
  ), "needs no-manager employee with alternate approver route");
});

test("production configuration remains untouched by demo tests", () => {
  const changedConfig = read("js/config.js");
  assert(changedConfig.includes("mybasepaydev.sharepoint.com") || changedConfig.includes("sharePoint"));
  assert(!read("js/demo-mode.js").includes("clientId"));
});
