/*
 * demo-fixtures.js — Synthetic PTO Central demo data.
 * No production data, no secrets, no network, no SharePoint IDs.
 */

window.PTODemoFixtures = (function () {
  "use strict";

  var people = [
    {
      id: "demo-user-rod",
      displayName: "Rod Demo",
      mail: "rod.demo@mybasepay.com",
      userPrincipalName: "rod.demo@mybasepay.com",
      jobTitle: "Operations Manager",
      department: "Operations",
      accountEnabled: true,
      userType: "Member",
      managerId: "demo-user-michelle",
    },
    {
      id: "demo-user-michelle",
      displayName: "Michelle Approver",
      mail: "michelle.approver@mybasepay.com",
      userPrincipalName: "michelle.approver@mybasepay.com",
      jobTitle: "Director, People Operations",
      department: "People Operations",
      accountEnabled: true,
      userType: "Member",
      managerId: "demo-user-elena",
    },
    {
      id: "demo-user-elena",
      displayName: "Elena HR",
      mail: "elena.hr@mybasepay.com",
      userPrincipalName: "elena.hr@mybasepay.com",
      jobTitle: "VP, HR",
      department: "Human Resources",
      accountEnabled: true,
      userType: "Member",
      managerId: null,
    },
    {
      id: "demo-user-jamie",
      displayName: "Jamie Backup",
      mail: "jamie.backup@mybasepay.com",
      userPrincipalName: "jamie.backup@mybasepay.com",
      jobTitle: "Client Success Lead",
      department: "Client Success",
      accountEnabled: true,
      userType: "Member",
      managerId: "demo-user-michelle",
    },
    {
      id: "demo-user-ana",
      displayName: "Ana Employee",
      mail: "ana.employee@mybasepay.com",
      userPrincipalName: "ana.employee@mybasepay.com",
      jobTitle: "Payroll Specialist",
      department: "Payroll",
      accountEnabled: true,
      userType: "Member",
      managerId: "demo-user-michelle",
    },
    {
      id: "demo-user-nomanager",
      displayName: "No Manager Demo",
      mail: "no.manager.demo@mybasepay.com",
      userPrincipalName: "no.manager.demo@mybasepay.com",
      jobTitle: "Implementation Specialist",
      department: "Operations",
      accountEnabled: true,
      userType: "Member",
      managerId: null,
    },
  ];

  function byId(id) {
    return people.filter(function (p) { return p.id === id; })[0] || null;
  }

  function iso(dateOnly, hour) {
    return dateOnly + "T" + String(hour || "09:00:00") + ".000Z";
  }

  function fields(seed) {
    var requester = byId(seed.requesterId);
    var submitter = byId(seed.submitterId || seed.requesterId);
    var manager = byId(requester.managerId);
    var approver = seed.approverId ? byId(seed.approverId) : manager;
    var backup = byId(seed.backupId || "demo-user-jamie");
    var submittedAt = iso(seed.submittedAt, "14:30:00");
    var audit =
      "[" + submittedAt + "] Created by " + submitter.displayName +
      " — PTO Central demo synthetic request (" + seed.status + ")";
    if (seed.decisionById) {
      var decider = byId(seed.decisionById);
      audit += "\n[" + iso(seed.decisionAt || seed.submittedAt, "16:15:00") + "] " +
        seed.status + " by " + decider.displayName + " — demo decision";
    }
    return {
      Title: seed.key,
      RequesterId: requester.id,
      RequesterEmail: requester.mail,
      RequesterName: requester.displayName,
      RequesterDepartment: requester.department,
      RequesterJobTitle: requester.jobTitle,
      SubmittedById: submitter.id,
      SubmittedByEmail: submitter.mail,
      SubmittedByName: submitter.displayName,
      OnBehalf: seed.onBehalf === true,
      RequestMode: seed.onBehalf ? "On behalf of" : "Self",
      OnBehalfReason: seed.onBehalfReason || "",
      PtoType: seed.ptoType,
      StartDate: seed.startDate,
      EndDate: seed.endDate,
      IsPartialDay: false,
      Reason: seed.reason || "",
      BackupContactName: backup.displayName,
      BackupContactEmail: backup.mail,
      Status: seed.status,
      ManagerId: manager ? manager.id : "",
      ManagerEmail: manager ? manager.mail : "",
      ManagerName: manager ? manager.displayName : "",
      SkipManagerManagerId: "demo-user-elena",
      SkipManagerManagerEmail: "elena.hr@mybasepay.com",
      SkipManagerManagerName: "Elena HR",
      ApproverEmail: approver ? approver.mail : "",
      ApproverName: approver ? approver.displayName : "",
      ApproverOverride: !!seed.approverId,
      ApproverOverrideReason: seed.approverReason || "",
      OriginalManagerEmail: manager ? manager.mail : "",
      OriginalManagerName: manager ? manager.displayName : "",
      SubmittedAt: submittedAt,
      NoticeDays: seed.noticeDays,
      IsShortNotice: seed.noticeDays < 7,
      ShortNoticeResolved: false,
      IsUrgent: false,
      EscalationLevel: seed.escalationLevel || 0,
      AuditLog: audit,
      DemoReminderStage: seed.reminderStage || "",
    };
  }

  var requests = [
    {
      id: "9001",
      webUrl: "demo://pto/9001",
      fields: fields({
        key: "DEMO-PTO-9001",
        requesterId: "demo-user-rod",
        ptoType: "PTO",
        startDate: "2026-08-10",
        endDate: "2026-08-12",
        submittedAt: "2026-07-26",
        status: "Pending",
        noticeDays: 15,
        reason: "Family trip.",
        reminderStage: "Awaiting Reminder 2",
        escalationLevel: 1,
      }),
    },
    {
      id: "9002",
      webUrl: "demo://pto/9002",
      fields: fields({
        key: "DEMO-PTO-9002",
        requesterId: "demo-user-ana",
        submitterId: "demo-user-rod",
        onBehalf: true,
        onBehalfReason: "Employee asked HR to enter the request while traveling.",
        ptoType: "PTO",
        startDate: "2026-08-03",
        endDate: "2026-08-03",
        submittedAt: "2026-07-29",
        status: "Pending",
        noticeDays: 5,
        reason: "Short-notice personal appointment.",
      }),
    },
    {
      id: "9003",
      webUrl: "demo://pto/9003",
      fields: fields({
        key: "DEMO-PTO-9003",
        requesterId: "demo-user-jamie",
        ptoType: "PTO",
        startDate: "2026-08-17",
        endDate: "2026-08-21",
        submittedAt: "2026-07-18",
        status: "Approved",
        decisionById: "demo-user-michelle",
        decisionAt: "2026-07-19",
        noticeDays: 30,
        reason: "Summer vacation.",
      }),
    },
    {
      id: "9004",
      webUrl: "demo://pto/9004",
      fields: fields({
        key: "DEMO-PTO-9004",
        requesterId: "demo-user-rod",
        ptoType: "Sick",
        startDate: "2026-08-01",
        endDate: "2026-08-01",
        submittedAt: "2026-07-29",
        status: "Auto-Approved",
        noticeDays: 1,
        reason: "Sick leave.",
      }),
    },
    {
      id: "9005",
      webUrl: "demo://pto/9005",
      fields: fields({
        key: "DEMO-PTO-9005",
        requesterId: "demo-user-ana",
        ptoType: "Other Leave",
        startDate: "2026-08-05",
        endDate: "2026-08-05",
        submittedAt: "2026-07-20",
        status: "Rejected",
        decisionById: "demo-user-michelle",
        decisionAt: "2026-07-21",
        noticeDays: 16,
        reason: "Coverage conflict.",
      }),
    },
    {
      id: "9006",
      webUrl: "demo://pto/9006",
      fields: fields({
        key: "DEMO-PTO-9006",
        requesterId: "demo-user-jamie",
        ptoType: "PTO",
        startDate: "2026-07-24",
        endDate: "2026-07-25",
        submittedAt: "2026-07-10",
        status: "Cancelled",
        noticeDays: 14,
        reason: "Dates changed.",
      }),
    },
    {
      id: "9007",
      webUrl: "demo://pto/9007",
      fields: fields({
        key: "DEMO-PTO-9007",
        requesterId: "demo-user-nomanager",
        submitterId: "demo-user-rod",
        onBehalf: true,
        onBehalfReason: "Demo case for an employee without a manager in Entra.",
        approverId: "demo-user-michelle",
        approverReason: "No default manager is configured for this employee.",
        ptoType: "PTO",
        startDate: "2026-08-24",
        endDate: "2026-08-25",
        submittedAt: "2026-07-29",
        status: "Pending",
        noticeDays: 26,
        reason: "Managerless employee demo route.",
      }),
    },
    {
      id: "9008",
      webUrl: "demo://pto/9008",
      fields: fields({
        key: "DEMO-PTO-9008",
        requesterId: "demo-user-rod",
        ptoType: "PTO",
        startDate: "2026-08-28",
        endDate: "2026-08-28",
        submittedAt: "2026-07-27",
        status: "Cancellation Requested",
        decisionById: "demo-user-michelle",
        decisionAt: "2026-07-27",
        noticeDays: 32,
        reason: "Original plans changed.",
      }),
    },
    {
      id: "9009",
      webUrl: "demo://pto/9009",
      fields: fields({
        key: "DEMO-PTO-9009",
        requesterId: "demo-user-rod",
        ptoType: "PTO",
        startDate: "2026-07-16",
        endDate: "2026-07-17",
        submittedAt: "2026-06-20",
        status: "Approved",
        decisionById: "demo-user-michelle",
        decisionAt: "2026-06-21",
        noticeDays: 26,
        reason: "Completed PTO example.",
      }),
    },
  ];

  return {
    people: people,
    requests: requests,
    currentUserId: "demo-user-rod",
    approverUserId: "demo-user-michelle",
    hrUserId: "demo-user-elena",
  };
})();
