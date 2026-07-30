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
      mail: "rod.demo@example.test",
      userPrincipalName: "rod.demo@example.test",
      jobTitle: "Operations Manager",
      department: "Operations",
      accountEnabled: true,
      userType: "Member",
      managerId: "demo-user-michelle",
    },
    {
      id: "demo-user-michelle",
      displayName: "Michelle Approver",
      mail: "michelle.approver@example.test",
      userPrincipalName: "michelle.approver@example.test",
      jobTitle: "Director, People Operations",
      department: "People Operations",
      accountEnabled: true,
      userType: "Member",
      managerId: "demo-user-elena",
    },
    {
      id: "demo-user-elena",
      displayName: "Elena HR",
      mail: "elena.hr@example.test",
      userPrincipalName: "elena.hr@example.test",
      jobTitle: "VP, HR",
      department: "Human Resources",
      accountEnabled: true,
      userType: "Member",
      managerId: null,
    },
    {
      id: "demo-user-jamie",
      displayName: "Jamie Backup",
      mail: "jamie.backup@example.test",
      userPrincipalName: "jamie.backup@example.test",
      jobTitle: "Client Success Lead",
      department: "Client Success",
      accountEnabled: true,
      userType: "Member",
      managerId: "demo-user-michelle",
    },
    {
      id: "demo-user-ana",
      displayName: "Ana Employee",
      mail: "ana.employee@example.test",
      userPrincipalName: "ana.employee@example.test",
      jobTitle: "Payroll Specialist",
      department: "Payroll",
      accountEnabled: true,
      userType: "Member",
      managerId: "demo-user-michelle",
    },
    {
      id: "demo-user-nomanager",
      displayName: "No Manager Demo",
      mail: "no.manager.demo@example.test",
      userPrincipalName: "no.manager.demo@example.test",
      jobTitle: "Implementation Specialist",
      department: "Operations",
      accountEnabled: true,
      userType: "Member",
      managerId: null,
    },
    {
      id: "demo-user-maggie",
      displayName: "Maggie Mondragon",
      mail: "maggie@mybasepay.com",
      userPrincipalName: "maggie@mybasepay.com",
      jobTitle: "Default PTO Approver",
      department: "People Operations",
      accountEnabled: true,
      userType: "Member",
      managerId: "demo-user-elena",
    },
    {
      id: "demo-user-sam",
      displayName: "Sam Backup",
      mail: "sam.backup@example.test",
      userPrincipalName: "sam.backup@example.test",
      jobTitle: "Operations Coordinator",
      department: "Operations",
      accountEnabled: true,
      userType: "Member",
      managerId: "demo-user-michelle",
    },
    {
      id: "demo-user-taylor",
      displayName: "Taylor Backup",
      mail: "taylor.backup@example.test",
      userPrincipalName: "taylor.backup@example.test",
      jobTitle: "Client Success Specialist",
      department: "Client Success",
      accountEnabled: true,
      userType: "Member",
      managerId: "demo-user-michelle",
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
    var backups = (seed.backupIds || [seed.backupId || "demo-user-jamie"]).map(byId).filter(Boolean).slice(0, 3);
    var backup = backups[0] || {};
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
      BackupContactName: backup.displayName || "",
      BackupContactEmail: backup.mail || "",
      BackupContact2Name: backups[1] ? backups[1].displayName : "",
      BackupContact2Email: backups[1] ? backups[1].mail : "",
      BackupContact3Name: backups[2] ? backups[2].displayName : "",
      BackupContact3Email: backups[2] ? backups[2].mail : "",
      BackupContactCount: backups.length,
      BackupNotified: seed.backupNotified !== false,
      BackupNotifiedAppliesToAll: seed.backupNotified !== false,
      BackupNotifiedByEmail: submitter.mail,
      CopySubmitterOnConfirmation: seed.copySubmitter === true,
      Status: seed.status,
      ManagerId: manager ? manager.id : "",
      ManagerEmail: manager ? manager.mail : "",
      ManagerName: manager ? manager.displayName : "",
      SkipManagerManagerId: "demo-user-elena",
      SkipManagerManagerEmail: "elena.hr@example.test",
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
        backupIds: ["demo-user-jamie"],
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
        copySubmitter: true,
        ptoType: "PTO",
        startDate: "2026-08-03",
        endDate: "2026-08-03",
        submittedAt: "2026-07-29",
        status: "Pending",
        noticeDays: 5,
        reason: "Short-notice personal appointment.",
        backupIds: ["demo-user-jamie", "demo-user-sam"],
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
        backupIds: ["demo-user-jamie", "demo-user-sam", "demo-user-taylor"],
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
        approverId: "demo-user-maggie",
        approverReason: "No manager on file — routed to default approver.",
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
        backupIds: ["demo-user-jamie", "demo-user-sam"],
        statusBeforeCancellationRequest: "Approved",
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

  requests.forEach(function (r) {
    var f = r.fields || {};
    if (f.Status === "Cancellation Requested" && !f.StatusBeforeCancellationRequest) {
      f.StatusBeforeCancellationRequest = "Approved";
    }
  });

  requests.push({
    id: "9010",
    webUrl: "demo://pto/9010",
    fields: fields({
      key: "DEMO-PTO-9010",
      requesterId: "demo-user-rod",
      ptoType: "Sick",
      startDate: "2026-07-20",
      endDate: "2026-07-20",
      submittedAt: "2026-07-01",
      status: "Auto-Approved",
      noticeDays: 19,
      reason: "Already-started auto-approved cancellation eligibility demo.",
      backupIds: ["demo-user-jamie"],
    }),
  });

  requests.push({
    id: "9011",
    webUrl: "demo://pto/9011",
    fields: Object.assign(fields({
      key: "DEMO-PTO-9011",
      requesterId: "demo-user-ana",
      ptoType: "PTO",
      startDate: "2026-08-14",
      endDate: "2026-08-14",
      submittedAt: "2026-07-22",
      status: "Cancelled",
      noticeDays: 23,
      reason: "Cancellation completed demo.",
      backupIds: ["demo-user-jamie"],
    }), {
      HrActionType: "Completed Cancellation",
      StatusBeforeCancellationRequest: "Approved",
      CancellationRequestedAt: iso("2026-07-24", "10:00:00"),
      CancellationRequestReason: "Plans changed.",
    }),
  });

  requests.push({
    id: "9012",
    webUrl: "demo://pto/9012",
    fields: Object.assign(fields({
      key: "DEMO-PTO-9012",
      requesterId: "demo-user-jamie",
      ptoType: "PTO",
      startDate: "2026-08-19",
      endDate: "2026-08-19",
      submittedAt: "2026-07-23",
      status: "Approved",
      noticeDays: 27,
      reason: "Cancellation declined/restored demo.",
      backupIds: ["demo-user-sam"],
    }), {
      HrActionType: "Declined Cancellation Request",
      StatusBeforeCancellationRequest: "Approved",
      CancellationRequestReason: "Coverage was restored.",
    }),
  });

  requests.push({
    id: "9013",
    webUrl: "demo://pto/9013",
    fields: (function () {
      var f = fields({
        key: "DEMO-PTO-9013",
        requesterId: "demo-user-rod",
        ptoType: "PTO",
        startDate: "2026-09-02",
        endDate: "2026-09-02",
        submittedAt: "2026-07-25",
        status: "Pending",
        noticeDays: 34,
        reason: "Legacy single-backup compatibility demo.",
        backupIds: ["demo-user-jamie"],
      });
      delete f.BackupContact2Name;
      delete f.BackupContact2Email;
      delete f.BackupContact3Name;
      delete f.BackupContact3Email;
      delete f.BackupContactCount;
      return f;
    })(),
  });

  return {
    people: people,
    requests: requests,
    currentUserId: "demo-user-rod",
    approverUserId: "demo-user-michelle",
    hrUserId: "demo-user-elena",
  };
})();
