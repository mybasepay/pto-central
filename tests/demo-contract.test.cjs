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
});

test("self request does not show employee picker and another employee does", () => {
  const js = read("js/pages/request.page.js");
  assert(/chooseRequestType\(type\)[\s\S]*type === "self"[\s\S]*oboSection\) els\.oboSection\.style\.display = "none"/.test(js));
  assert(/type === "self"[\s\S]*else[\s\S]*oboSection\) els\.oboSection\.style\.display = "block"/.test(js));
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

test("approver can be changed and invalid self-approval is blocked", () => {
  const js = read("js/pages/request.page.js");
  assert(js.includes("selectApprover"));
  assert(js.includes("You can't route approval to yourself"));
  assert(js.includes("employee receiving PTO"));
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

test("HR Open action targets standalone detail page in a new tab", () => {
  const html = read("hr.html");
  const js = read("js/pages/hr.page.js");
  assert(html.includes('data-act="open"'));
  assert(html.includes('target="_blank"'));
  assert(html.includes('rel="noopener noreferrer"'));
  assert(js.includes("relativeDetailUrl"));
  assert(js.includes("openDetailLink"));
});

test("detail page renders selected record", () => {
  const html = read("pto-detail.html");
  const js = read("js/pages/detail.page.js");
  assert(html.includes("PTO Request Detail"));
  assert(js.includes("getRequestById"));
  assert(js.includes("itemIdFromUrl"));
});

test("demo fixtures include required statuses and reminder examples", () => {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(read("js/demo-fixtures.js"), context);
  const requests = context.window.PTODemoFixtures.requests;
  const statuses = new Set(requests.map((r) => r.fields.Status));
  ["Pending", "Approved", "Rejected", "Auto-Approved", "Cancelled"].forEach((s) => assert(statuses.has(s), s));
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
