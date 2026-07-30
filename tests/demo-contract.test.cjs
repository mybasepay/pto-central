const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

function domainContext() {
  const context = {
    window: {},
    console,
    PTOGraph: {},
  };
  context.window.console = console;
  vm.createContext(context);
  vm.runInContext(read("js/rules.js"), context);
  context.PTORules = context.window.PTORules;
  vm.runInContext(read("js/requests.js"), context);
  context.PTORequests = context.window.PTORequests;
  return context;
}

function demoContext() {
  const store = {};
  const context = {
    window: {
      location: { search: "?demo=1" },
    },
    console,
    URLSearchParams,
    sessionStorage: {
      getItem: (k) => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null,
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
      clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
    },
    document: {
      documentElement: { classList: { add() {} } },
      addEventListener() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
      createElement() {
        return {
          className: "",
          textContent: "",
          setAttribute() {},
          appendChild() {},
          addEventListener() {},
        };
      },
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

const pendingTests = [];

function reportFailure(name, err) {
  console.error(`not ok - ${name}`);
  console.error(err.stack || err);
  process.exitCode = 1;
}

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      pendingTests.push(result.then(
        () => console.log(`ok - ${name}`),
        (err) => reportFailure(name, err)
      ));
    } else {
      console.log(`ok - ${name}`);
    }
  } catch (err) {
    reportFailure(name, err);
  }
}

process.on("beforeExit", async () => {
  if (!pendingTests.length) return;
  const running = pendingTests.splice(0, pendingTests.length);
  await Promise.all(running);
});

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
  const html = read("request.html");
  assert(js.includes("Select at least one backup contact before submitting"));
  assert(html.includes("I have notified all backup contacts"));
  assert(js.includes("The employee taking PTO can't be selected as their own backup contact."));
  assert(js.includes("resetBackupNotified"));
  assert(!js.includes("name only"), "backup lookup should not keep the old free-text fallback");
  assert(!js.includes("You can submit without a backup contact"), "backup is no longer optional");
});

test("self request shows confirmation copy and stores unchecked preference", () => {
  const html = read("request.html");
  const js = read("js/pages/request.page.js");
  const { PTORequests } = domainContext();
  assert(html.includes("Send me a confirmation copy"));
  assert(js.includes('els.copySubmitterBox.style.display = state.requestType ? "flex" : "none"'));
  assert(js.includes('addReviewItem("Confirmation copy"'));
  const rod = { id: "r", displayName: "Rod Demo", mail: "rod.demo@example.test" };
  const manager = { id: "m", displayName: "Michelle Approver", mail: "michelle.approver@example.test" };
  const fields = PTORequests.buildCreateRequestFields({
    ptoType: "PTO",
    startDate: "2026-08-01",
    endDate: "2026-08-01",
    BackupContacts: [{ name: "Backup", email: "backup@mybasepay.com" }],
    BackupNotified: true,
    CopySubmitterOnConfirmation: false,
  }, { requester: rod, submitter: rod, manager });
  assert.strictEqual(fields.RequestMode, "Self");
  assert.strictEqual(fields.CopySubmitterOnConfirmation, false);
});

test("self request stores checked copy preference without duplicate email recipient", () => {
  const { PTORequests } = domainContext();
  const rod = { id: "r", displayName: "Rod Demo", mail: "rod.demo@example.test" };
  const manager = { id: "m", displayName: "Michelle Approver", mail: "michelle.approver@example.test" };
  const fields = PTORequests.buildCreateRequestFields({
    ptoType: "PTO",
    startDate: "2026-08-01",
    endDate: "2026-08-01",
    BackupContacts: [{ name: "Backup", email: "backup@mybasepay.com" }],
    BackupNotified: true,
    CopySubmitterOnConfirmation: true,
  }, { requester: rod, submitter: rod, manager });
  assert.strictEqual(fields.CopySubmitterOnConfirmation, true);
  const contract = PTORequests.confirmationRecipientContract(fields);
  assert.strictEqual(contract.primaryRecipient.email, "rod.demo@example.test");
  assert.strictEqual(contract.copyRequested, true);
  assert.strictEqual(contract.copyRecipients.length, 0);
  assert.strictEqual(contract.duplicateSubmitterCopySuppressed, true);
});

test("on-behalf copy behavior remains an additional submitter copy", () => {
  const { PTORequests } = domainContext();
  const requester = { id: "e", displayName: "Ana Employee", mail: "ana.employee@example.test" };
  const submitter = { id: "r", displayName: "Rod Demo", mail: "rod.demo@example.test" };
  const manager = { id: "m", displayName: "Michelle Approver", mail: "michelle.approver@example.test" };
  const fields = PTORequests.buildCreateRequestFields({
    ptoType: "PTO",
    startDate: "2026-08-01",
    endDate: "2026-08-01",
    BackupContacts: [{ name: "Backup", email: "backup@mybasepay.com" }],
    BackupNotified: true,
    CopySubmitterOnConfirmation: true,
  }, { requester, submitter, manager, onBehalf: true });
  const contract = PTORequests.confirmationRecipientContract(fields);
  assert.strictEqual(fields.RequestMode, "On behalf of");
  assert.strictEqual(fields.CopySubmitterOnConfirmation, true);
  assert.strictEqual(contract.primaryRecipient.email, "ana.employee@example.test");
  assert.strictEqual(contract.copyRecipients.length, 1);
  assert.strictEqual(contract.copyRecipients[0].name, "Rod Demo");
  assert.strictEqual(contract.copyRecipients[0].email, "rod.demo@example.test");
  assert.strictEqual(contract.duplicateSubmitterCopySuppressed, false);
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
  assert(js.includes("Backup contacts notified"));
});

test("final request form removes redundant confirmation and manager manager display", () => {
  const html = read("request.html");
  const js = read("js/pages/request.page.js");
  assert(!html.includes("I confirm this PTO request is accurate"));
  assert(!html.includes('id="confirm"'));
  assert(!html.includes('id="c-mm"'));
  assert(!js.includes("els.confirm"));
  assert(!js.includes("confirm.checked"));
  assert(!js.includes('setText("c-mm"'));
  assert(!js.includes("addReviewItem(\"Manager's manager\""));
  assert(js.includes("Short notice: This request starts in "));
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

test("cancel workspace is routed internally and submits cancellation requests", () => {
  const home = read("index.html");
  const html = read("cancel.html");
  const js = read("js/pages/cancel.page.js");
  assert(home.includes('href="cancel.html"'));
  assert(html.includes("Active and Upcoming"));
  assert(html.includes("Past and Closed"));
  assert(html.includes("request-list"));
  assert(html.includes("Submit Cancellation Request"));
  assert(!html.includes("request-grid"));
  assert(!html.includes("request-card"));
  assert(js.includes("PTORequests.requestCancellation"));
  assert(js.includes("PTORules.isEmployeeCancellationEligible(r.status)"));
  assert(js.includes("Your cancellation request was submitted successfully and is pending HR review."));
  assert(!js.includes("PTORequests.cancelRequest"));
  assert(!js.includes("startHasPassed"));
  assert(js.includes("PTORequests.listMyRequests"));
});

test("approval without itemId shows clean empty state", () => {
  const html = read("approve.html");
  const js = read("js/pages/approve.page.js");
  assert(html.includes("no-request-state"));
  assert(html.includes("No PTO request selected"));
  assert(html.includes("Return to PTO Central"));
  assert(js.includes("showNoRequestState"));
  assert(js.includes('els.requestPanel.style.display = "none"'));
  assert(js.includes('els.decisionPanel.style.display = "none"'));
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

test("date range validation allows equal/later and rejects earlier", () => {
  const { PTORules } = domainContext();
  assert.strictEqual(JSON.stringify(PTORules.validateDateRange("2026-08-01", "2026-08-01")), JSON.stringify({ startDate: "2026-08-01", endDate: "2026-08-01" }));
  assert.strictEqual(JSON.stringify(PTORules.validateDateRange("2026-08-01", "2026-08-02")), JSON.stringify({ startDate: "2026-08-01", endDate: "2026-08-02" }));
  assert.throws(() => PTORules.validateDateRange("2026-08-02", "2026-08-01"), /End date must be on or after/);
});

test("approver safety rejects requester and acting submitter", () => {
  const { PTORules } = domainContext();
  const approver = { displayName: "A", mail: "approver@mybasepay.com", accountEnabled: true, userType: "Member" };
  assert.strictEqual(PTORules.assertApproverIsSafe(approver, { requester: { mail: "requester@mybasepay.com" }, submitter: { mail: "submitter@mybasepay.com" } }), approver);
  assert.throws(() => PTORules.assertApproverIsSafe(approver, { requester: { mail: "approver@mybasepay.com" } }), /employee receiving PTO/);
  assert.throws(() => PTORules.assertApproverIsSafe(approver, { submitter: { mail: "APPROVER@mybasepay.com" } }), /acting submitter/);
});

test("Maggie fallback writes the approved no-manager override shape", () => {
  const { PTORequests } = domainContext();
  const fields = PTORequests.buildCreateRequestFields({
    ptoType: "PTO",
    startDate: "2026-08-01",
    endDate: "2026-08-01",
    BackupContacts: [{ name: "Backup", email: "backup@mybasepay.com" }],
    BackupNotified: true,
  }, {
    requester: { id: "r", displayName: "Requester", mail: "requester@mybasepay.com" },
    submitter: { id: "s", displayName: "Submitter", mail: "submitter@mybasepay.com" },
    manager: null,
    defaultApproverNoManager: { approver: { displayName: "Maggie Mondragon", mail: "maggie@mybasepay.com", accountEnabled: true, userType: "Member" } },
  });
  assert.strictEqual(fields.ApproverEmail, "maggie@mybasepay.com");
  assert.strictEqual(fields.ApproverName, "Maggie Mondragon");
  assert.strictEqual(fields.ApproverOverride, true);
  assert.strictEqual(fields.ApproverOverrideReason, "No manager on file — routed to default approver.");
});

test("Maggie fallback fails closed for Maggie self-submission", () => {
  const { PTORequests } = domainContext();
  const maggie = { id: "m", displayName: "Maggie Mondragon", mail: "maggie@mybasepay.com", accountEnabled: true, userType: "Member" };
  assert.throws(() => PTORequests.buildCreateRequestFields({
    ptoType: "PTO",
    startDate: "2026-08-01",
    endDate: "2026-08-01",
    BackupContacts: [{ name: "Backup", email: "backup@mybasepay.com" }],
  }, {
    requester: maggie,
    submitter: maggie,
    manager: null,
    defaultApproverNoManager: { approver: maggie },
  }), /employee receiving PTO|acting submitter/);
});

test("backup contacts flatten one two three with no gaps", () => {
  const { PTORules } = domainContext();
  const fields = PTORules.flattenBackupContacts([
    { name: "One", email: "one@mybasepay.com" },
    null,
    { name: "Two", email: "two@mybasepay.com" },
    { name: "Three", email: "three@mybasepay.com" },
  ]);
  assert.strictEqual(fields.BackupContactName, "One");
  assert.strictEqual(fields.BackupContact2Name, "Two");
  assert.strictEqual(fields.BackupContact3Name, "Three");
  assert.strictEqual(fields.BackupContactCount, 3);
});

test("backup parsing preserves existing single-backup records", () => {
  const { PTORules } = domainContext();
  assert.strictEqual(JSON.stringify(PTORules.parseBackupContacts({ BackupContactName: "Legacy", BackupContactEmail: "legacy@mybasepay.com" })), JSON.stringify([
    { name: "Legacy", email: "legacy@mybasepay.com" },
  ]));
});

test("backup validation rejects duplicates and more than three", () => {
  const { PTORules } = domainContext();
  assert.throws(() => PTORules.flattenBackupContacts([
    { name: "One", email: "dup@mybasepay.com" },
    { name: "Two", email: "DUP@mybasepay.com" },
  ]), /unique/);
  assert.throws(() => PTORules.flattenBackupContacts([
    { name: "One", email: "one@mybasepay.com" },
    { name: "Two", email: "two@mybasepay.com" },
    { name: "Three", email: "three@mybasepay.com" },
    { name: "Four", email: "four@mybasepay.com" },
  ]), /no more than 3/);
});

test("employee cancellation eligibility is status-only", () => {
  const { PTORules } = domainContext();
  assert.strictEqual(PTORules.isEmployeeCancellationEligible("Pending"), true);
  assert.strictEqual(PTORules.isEmployeeCancellationEligible("Approved"), true);
  assert.strictEqual(PTORules.isEmployeeCancellationEligible("Auto-Approved"), true);
  assert.strictEqual(PTORules.isEmployeeCancellationEligible("Cancelled"), false);
  assert.strictEqual(PTORules.isEmployeeCancellationEligible("Cancellation Requested"), false);
  assert(read("js/pages/my-requests.page.js").includes("PTORules.isEmployeeCancellationEligible(r.status)"));
});

test("HR decline restores StatusBeforeCancellationRequest", () => {
  const demo = read("js/demo-mode.js");
  assert(demo.includes('item.fields.Status = item.fields.StatusBeforeCancellationRequest || "Approved"'));
  assert(demo.includes('HrActionType = "Declined Cancellation Request"'));
});

test("pending future and already-started PTO can request cancellation in demo", async () => {
  const { PTORequests } = demoContext();
  const future = await PTORequests.requestCancellation("9001", { reason: "Future pending cancellation." });
  assert.strictEqual(future.fields.Status, "Cancellation Requested");
  assert.strictEqual(future.fields.StatusBeforeCancellationRequest, "Pending");
  assert(future.fields.CancellationRequestedAt);
  assert.strictEqual(future.fields.CancellationRequestReason, "Future pending cancellation.");

  const started = await PTORequests.requestCancellation("9014", { reason: "Already started pending cancellation." });
  assert.strictEqual(started.fields.Status, "Cancellation Requested");
  assert.strictEqual(started.fields.StatusBeforeCancellationRequest, "Pending");
  assert.strictEqual(started.fields.CancellationRequestReason, "Already started pending cancellation.");
});

test("HR decline restores Pending and HR complete cancels pending cancellation request", async () => {
  const { PTORequests } = demoContext();
  const declined = await PTORequests.declineCancellationRequest("9015", { note: "Still needed." });
  assert.strictEqual(declined.fields.Status, "Pending");
  assert.strictEqual(declined.fields.StatusBeforeCancellationRequest, "Pending");
  assert.strictEqual(declined.fields.HrActionType, "Declined Cancellation Request");

  const ctx = demoContext();
  const completed = await ctx.PTORequests.completeCancellationRequest("9015", { note: "Complete pending cancellation." });
  assert.strictEqual(completed.fields.Status, "Cancelled");
  assert.strictEqual(completed.fields.StatusBeforeCancellationRequest, "Pending");
  assert.strictEqual(completed.fields.HrActionType, "Completed Cancellation");
});

test("approved and auto-approved cancellation behavior remains unchanged", async () => {
  const { PTORequests } = demoContext();
  const approved = await PTORequests.requestCancellation("9009", { reason: "Approved cancellation." });
  assert.strictEqual(approved.fields.Status, "Cancellation Requested");
  assert.strictEqual(approved.fields.StatusBeforeCancellationRequest, "Approved");

  const autoApproved = await PTORequests.requestCancellation("9010", { reason: "Auto-approved cancellation." });
  assert.strictEqual(autoApproved.fields.Status, "Cancellation Requested");
  assert.strictEqual(autoApproved.fields.StatusBeforeCancellationRequest, "Auto-Approved");
});

test("non-eligible statuses still do not show request cancellation", () => {
  const { PTORules } = domainContext();
  assert.strictEqual(PTORules.isEmployeeCancellationEligible("Rejected"), false);
  assert.strictEqual(PTORules.isEmployeeCancellationEligible("Cancelled"), false);
  assert.strictEqual(PTORules.isEmployeeCancellationEligible("Cancellation Requested"), false);
});

test("centralized status-label behavior covers cancellation statuses", () => {
  const { PTORules } = domainContext();
  assert.strictEqual(PTORules.displayStatus("Cancellation Requested"), "Cancellation Requested");
  assert.strictEqual(PTORules.STATUS_VALUES.CANCELLED, "Cancelled");
  assert(read("js/ui.js").includes("PTORules.displayStatus"));
});

test("production configuration remains untouched by demo tests", () => {
  const changedConfig = read("js/config.js");
  assert(changedConfig.includes("mybasepaydev.sharepoint.com") || changedConfig.includes("sharePoint"));
  assert(!read("js/demo-mode.js").includes("clientId"));
});
