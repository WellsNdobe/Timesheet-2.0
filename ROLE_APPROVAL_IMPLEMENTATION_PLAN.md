
# Role and Approval Workflow Implementation Plan

## Purpose

Deliver the role and approval workflow in small, independently testable phases. Each phase must be implemented, reviewed, and tested before the next phase begins.

This plan incorporates the risks and recommendations in [`consider`](./consider), especially versioned submissions, derived weekly states, self-approval, explicit reassignment, separate admin powers, resubmission diffs, permission isolation, and notifications.

## Delivery rule

For every phase:

1. Implement only the stated in-scope work.
2. Add or update tests for that phase.
3. Run only the checks explicitly approved for that phase.
4. Complete the listed manual acceptance checks.
5. Record defects or follow-up work without pulling the next phase forward.
6. Start the next phase only after the current exit criteria are accepted.

## Proposed business rules

These defaults should be confirmed in Phase 0.

### Workspace roles

- **Member:** records, edits, deletes, and submits their own time. They can view their own approval states and reviewer comments.
- **Manager:** has Member abilities and can review only project submissions explicitly assigned to them. A Manager is not automatically an approver for every project.
- **Admin:** manages workspace membership, roles, project approver configuration, and all approval operations. Every workspace must retain at least one active Admin.
- **Approver:** is a project assignment held by an eligible active Manager or Admin, not a fourth workspace role.

### Approval unit and revisions

- The canonical approval unit is `workspace + submitter membership + week + project`.
- Every submission or resubmission creates an immutable revision of that approval unit.
- A later revision never overwrites the earlier submitted snapshot, decision, comments, actors, or timestamps.
- Reviewers act on the latest pending revision. Earlier revisions remain available as history.

### Weekly and project states

- Project approval states are `pending`, `changes_requested`, and `approved`.
- The weekly state is derived from its project approval portions:
  - `draft`: not submitted.
  - `in_review`: submitted with no returned portions and at least one pending portion.
  - `changes_requested`: at least one portion is returned and none are approved.
  - `partially_approved`: at least one portion is approved while another is pending or returned.
  - `approved`: every submitted project portion is approved.
- The interface must not show the week as simply “Submitted” when one project has been returned.

### Editing and locking

- Pending and approved project-week portions are immutable.
- A changes-requested portion unlocks only that submitter/project/week slice.
- The member may add, edit, or delete entries inside the returned slice.
- An entry from a returned slice cannot be moved into another project or week. It must be deleted and recreated where permitted.
- Resubmission locks that slice again and creates the next revision.

### Approver eligibility and self-approval

- An approver must be active, belong to the same workspace, and have a Manager or Admin role.
- Submission is blocked when any used project has no eligible approver.
- Self-approval is prohibited in multi-member workspaces.
- A sole active Admin in a one-member workspace may self-approve as the explicit small-workspace exception.
- There is no silent fallback approver. A configuration problem must be fixed or the item explicitly reassigned.

### Reassignment and admin actions

- Changing a project’s configured approver affects future submissions only.
- Existing pending approvals keep their snapshotted approver until an Admin explicitly transfers them.
- Transfer requires a reason and creates an audit event naming the old approver, new approver, and Admin actor.
- Admin actions are distinct:
  - **Approve as Admin:** resolve someone else’s pending item, with a required override reason.
  - **Transfer approval:** move a pending item to another eligible approver, with a required reason.
  - **Reopen approved item:** reverse a completed approval. This is excluded from the initial release until invoicing, payroll, export, and locking consequences are defined.
- “Request changes” is used instead of “Decline” because the member is expected to correct and resubmit the work.

### Visibility and audit

- Managers receive only the project slice assigned to them, never unrelated projects from the submitter’s week.
- Admins may access all approval items in their workspace.
- Permission checks must be enforced by the API, not only through hidden frontend routes.
- Submission, resubmission, approval, change request, transfer, and Admin override are immutable audit events.
- Member-facing review comments and internal administrative reasons are stored and displayed separately.

## Role capability matrix

| Capability | Member | Manager | Admin |
| --- | --- | --- | --- |
| Manage own time | Yes | Yes | Yes |
| Submit own week | Yes | Yes | Yes |
| View own outcomes/comments | Yes | Yes | Yes |
| View assigned approval queue | No | Yes | Yes |
| Review assigned project portions | No | Yes | Yes |
| Review any workspace approval | No | No | Yes, audited override |
| Transfer pending approvals | No | No | Yes |
| Invite or deactivate members | No | No | Yes |
| Change workspace roles | No | No | Yes |
| Assign project approvers | No | No | Yes |
| Manage project/task details | No | Assigned projects only | All projects |
| Reopen approved work | No | No | Deferred |

### ✅ IMPLEMENTED — PHASE 0

## Phase 0 — Confirm policy decisions

### Goal

Freeze the business language and permission boundaries before changing the database or interface.

### Decisions accepted

1. Invitations, member deactivation, and member reactivation are Admin-only operations.
2. Managers may manage project details and tasks only for projects where they are the assigned approver. Admins create and archive projects, assign approvers, and manage all project and task details.
3. A sole active Admin may self-approve only in a one-member workspace. Self-approval remains prohibited in multi-member workspaces.
4. Changing a project’s configured approver affects future submissions only. Existing pending approvals retain their snapshotted approver until an Admin explicitly transfers them.
5. An Admin approving an item assigned to another approver must provide an internal override reason, and the action must be audit logged.
6. Reopening or reversing approved work is deferred until its invoicing, payroll, export, and locking consequences are defined.

### Deliverable

- Accepted role matrix and business rules in this document.
- Agreed product terminology: “Approvals,” “Approve,” “Request changes,” “Transfer,” and “Admin override.”

### Acceptance recorded

- [x] Member, Manager, and Admin capabilities are explicitly represented in the role matrix.
- [x] Self-approval has one defined exception and remains prohibited otherwise.
- [x] Missing or ineligible approvers block submission rather than creating orphaned work.
- [x] Approver changes do not silently rewrite pending approvals.
- [x] Pending approvals must be transferred before an approver can be demoted or deactivated.
- [x] Admin override and transfer are distinct, auditable operations.

### Exit criteria

- [x] All six decisions are answered and recorded.
- [x] The role matrix and approval terminology are accepted as the contract for subsequent phases.
- [x] Phase 1 remained gated until this Phase 0 gate was accepted.

### ✅ END IMPLEMENTED — PHASE 0

### ✅ IMPLEMENTED — PHASE 1

## Phase 1 — Centralize and harden role authorization

### Goal

Make role permissions consistent and independently testable before adding workflow behavior.

### In scope

- Central policy functions for Member, Manager, Admin, assigned approver, and workspace-bound access.
- Apply the policy functions to existing workspace, project, task, and approval endpoints.
- Preserve “at least one active Admin.”
- Return consistent `403 insufficient_permissions` responses for authenticated but unauthorized actions.
- Return non-disclosing `404` responses where revealing another workspace’s resource would leak data.

### Out of scope

- New approval revisions.
- New screens.
- Notifications.

### Automated tests

- Role matrix tests for each protected endpoint.
- Inactive membership denial.
- Cross-workspace resource isolation.
- Last-Admin demotion/deactivation prevention.
- Manager access limited according to the Phase 0 decision.

### Manual acceptance

- Exercise the same endpoint once as Member, Manager, and Admin and compare results to the matrix.

### Implementation and verification recorded

- [x] Shared workspace membership, role, project-assignment, and approver guards are used by the API routes.
- [x] Manager project and task mutations are limited to assigned projects; Admin-only mutations are enforced.
- [x] Approval reads are scoped by role, and unassigned Admin decision attempts are rejected until the Phase 4 override flow exists.
- [x] Last-Admin checks run inside the membership transaction and workspace advisory lock.
- [x] `npm run typecheck --workspace=@timesheet/api` passed.
- [x] `npm run test:api` passed: 10 tests.
- Owner manual endpoint checks remain the final handoff step.

### Exit criteria

- Authorization tests pass.
- No endpoint relies on frontend visibility for security.

### ✅ END IMPLEMENTED — PHASE 1

### ✅ IMPLEMENTED — PHASE 2

## Phase 2 — Project approver configuration and safeguards

### Goal

Guarantee that every submitted project portion can be routed to an eligible person.

### In scope

- Admin-only project approver assignment.
- Eligibility validation: same workspace, active membership, Manager or Admin.
- Submission-readiness response that identifies each project missing an eligible approver.
- Prevent demotion/deactivation/removal of an approver with pending work until items are transferred.
- Changing the configured approver affects future submissions only.

### Out of scope

- Transferring existing pending items; that is Phase 4.
- Approval inbox UI.

### Automated tests

- Reject Member as project approver.
- Reject inactive or cross-workspace approver.
- Block submission with a project-specific missing-approver error.
- Preserve the approver on an existing pending item after project configuration changes.
- Prevent role/access changes while pending approvals remain.

### Manual acceptance

- Configure an approver, remove eligibility, and confirm submission explains exactly which project needs attention.

### Exit criteria

- Orphaned approval items cannot be created.
- Existing pending assignments cannot silently change.

### Implementation and verification recorded

- [x] Approver eligibility, self-approval, structured readiness errors, and shared-approver submissions are enforced.
- [x] Workspace governance locking serializes membership eligibility, project assignment, submission, and decision flows.
- [x] Project/task authorization is atomic and nested resource isolation uses non-disclosing `404` responses.
- [x] `npm run typecheck --workspace=@timesheet/api` passed.
- [x] `npm run test:api` passed.

### ✅ END IMPLEMENTED — PHASE 2

### ✅ IMPLEMENTED — PHASE 3

## Phase 3 — Versioned approval revisions and derived weekly state

### Goal

Create the durable state model required for safe resubmission and audit history.

### In scope

- Introduce an approval identity for `workspace + submitter + week + project`.
- Store immutable numbered revisions beneath that identity.
- Snapshot entries and assigned approver on every revision.
- Preserve previous snapshots and decisions during resubmission.
- Derive weekly status from the latest state of each project portion.
- Migrate existing review data without losing event history.

### Out of scope

- Diff presentation in the frontend.
- Notifications.

### Automated tests

- Initial submit creates revision 1.
- Request changes followed by resubmit creates revision 2.
- Revision 1 snapshot, comment, reviewer, and timestamps remain unchanged.
- Duplicate resubmission cannot create two active pending revisions.
- Weekly state correctly covers draft, in review, changes requested, partially approved, and approved combinations.
- Concurrent submit/resubmit attempts are serialized safely.

### Manual acceptance

- Inspect a two-project week through submit, partial approval, change request, edit, and resubmit; confirm both history and current state remain understandable.

### Exit criteria

- No resubmission overwrites history.
- The weekly status never contradicts its project statuses.

### Implementation and verification recorded

- [x] Stable approval items retain legacy identifiers and store append-only numbered revisions.
- [x] Legacy events and the recoverable current snapshot migrate to revision 1 without claiming unrecoverable history.
- [x] Revision-specific snapshots, events, withdrawn revisions, and derived weekly states are implemented.
- [x] Revision-specific decision endpoints reject stale and non-latest actions.
- [x] `npm run typecheck --workspace=@timesheet/api` passed.
- [x] `npm run test:api` passed: 11 tests.

### ✅ END IMPLEMENTED — PHASE 3

## Phase 4 — Approval decisions, transfers, and Admin override semantics

### Goal

Expose complete, auditable backend actions before building the approval interface.

### In scope

- Assigned approver can approve a pending revision.
- Assigned approver can request changes with a required member-facing comment.
- Admin can transfer a pending revision to another eligible approver with a required internal reason.
- Admin can approve a pending revision assigned to someone else with a required internal override reason.
- Enforce self-approval rules.
- Separate member-facing comments from internal administrative reasons.
- Add explicit event types for transfer and Admin override. Resubmission is already recorded in Phase 3.

### Out of scope

- Reopening approved items.
- Bulk approval.
- UI.

### Automated tests

- Only the current assigned approver or Admin can open an item; the assigned approver resolves normally and an unassigned Admin uses the audited override action.
- Manager receives only the assigned project slice.
- Change request without a comment fails.
- Transfer and Admin override without reasons fail.
- Transfer records old/new approver and actor.
- Self-approval fails in a multi-member workspace and follows the confirmed sole-Admin exception.
- Resolved or stale revisions cannot be resolved twice.

### Manual acceptance

- Complete one normal approval, one change request, one transfer, and one Admin override; inspect the event history for each.

### Exit criteria

- All approval mutations have explicit authorization, state transitions, and audit events.

### Implementation prepared — validation pending

- [x] Normal approval and required-comment change requests operate on the latest assigned revision.
- [x] Admin transfer preserves the submitted approver snapshot, changes only the current assignment, and records old/new approvers plus an internal reason.
- [x] Admin override requires an internal reason and records a separate audit event without populating member-facing comments.
- [x] Internal administrative reasons are returned only to Admins.
- [x] Reviewer findings for withdrawal, all-withdrawn restart, revision mismatch, and deterministic event ordering are addressed.
- [ ] Automated validation remains pending because this turn did not explicitly authorize test or typecheck commands.

## Phase 5 — Frontend test foundation and role-aware navigation

### Goal

Create the smallest frontend foundation needed to test role-specific screens.

### In scope

- Add the web component test setup and API mocking strategy.
- Load the authenticated user’s active workspace membership and role.
- Add conditional sidebar destinations:
  - Member: no Approvals destination.
  - Manager: `Approvals` with assigned pending count.
  - Admin: `Approvals` with workspace-wide pending count and Admin management destinations.
- Badge counts only actionable pending approvals.
- Direct-route permission handling; hiding a link is not the security control.

### Out of scope

- Approval list content.
- Approval decisions.

### Automated tests

- Navigation visibility for all three roles.
- Pending badge semantics.
- Unauthorized route handling.
- Workspace/role loading, empty, and error states.

### Manual acceptance

- Sign in as each role and confirm the navigation changes without exposing unauthorized data.

### Exit criteria

- Role-aware navigation behaves predictably and has component coverage.

### Implementation prepared — validation pending

- [x] Authenticated sessions retain and restore access tokens before protected workspace requests.
- [x] Active workspace role and authorization-scoped pending approval count drive navigation.
- [x] Member, Manager, and Admin sidebar destinations are derived from the role matrix.
- [x] Direct routes render explicit access-denied or not-found states without protected page content.
- [x] Vitest, Testing Library, jsdom, and MSW component-test foundations and role-navigation cases are configured.
- [ ] Automated validation remains pending because this turn did not explicitly authorize test, typecheck, lint, or build commands.

## Phase 6 — Approvals inbox

### Goal

Give Managers and Admins a focused, actionable queue.

### In scope

- `Approvals` page with Pending as the default view.
- Manager scope: assigned items only.
- Admin scope: all workspace items.
- Columns: submitter, week, project, submitted hours, submitted date, status, assigned approver.
- Filters: status/history, project, submitter, approver where permitted, and date range.
- Loading, empty, error, and stale-data refresh states.
- History is available but visually secondary to actionable work.

### Out of scope

- Approve/request-changes controls.
- Bulk actions.

### Automated tests

- Manager cannot receive or render unrelated project portions.
- Admin can filter the workspace queue.
- Pending badge and list remain consistent.
- History items do not count as actionable.
- Empty and error states provide a recovery action.

### Manual acceptance

- Compare Manager and Admin inboxes against the same seeded workspace and verify scope and counts.

### Exit criteria

- The inbox is useful for finding work without exposing unrelated submissions.

## Phase 7 — Approval detail and reviewer actions

### Goal

Let an eligible reviewer understand and resolve one submitted project revision.

### In scope

- Approval detail view containing submitter, week, project, revision, assigned approver, total, and submitted timestamp.
- Immutable entry snapshot with date, task, description, duration, and billable status.
- Event/history timeline.
- `Approve` action.
- `Request changes` action with required member-facing comment.
- Admin-only `Transfer` and `Approve as Admin` actions with required internal reasons.
- Confirmation and stale/conflict handling.

### Out of scope

- Revision diff; that is Phase 8.
- Reopening approved work.

### Automated tests

- Role-based action visibility.
- Required comments/reasons.
- Success, API validation, conflict, and already-resolved states.
- Admin reasons do not appear as member-facing comments.

### Manual acceptance

- Resolve items through all supported action paths and confirm list counts and detail state update correctly.

### Exit criteria

- Managers and Admins can complete the supported review actions without leaving the interface.

## Phase 8 — Member status, returned work, resubmission, and diff

### Goal

Close the feedback loop for the person who submitted the time.

### In scope

- Weekly status derived from project portions.
- Project-level status rows with assigned approver and reviewer comments.
- `Edit returned work` entry point limited to the returned slice.
- Resubmit returned project portion.
- Approval detail revision comparison showing added, removed, and changed entries.
- Member sees member-facing comments, not internal Admin reasons.

### Out of scope

- Notifications outside the product.

### Automated tests

- Approved and pending slices stay locked while returned work is editable.
- Add/edit/delete is limited to the returned project/week.
- Resubmission creates the next revision and removes the item from changes-requested state.
- Diff correctly categorizes added, removed, and changed entries.
- Internal reasons never leak to Member responses or UI.

### Manual acceptance

- Run the full `request changes → edit → resubmit → compare → approve` journey.

### Exit criteria

- Members can understand what happened, correct only the permitted work, and resubmit confidently.

## Phase 9 — Admin governance screens

### Goal

Give Admins the controls required to keep the workflow healthy.

### In scope

- People/Members screen: invite, change role, deactivate/reactivate, and show blocking pending-approval conditions.
- Project settings: select one eligible primary approver and show submission readiness.
- Pending approval transfer flow from People and Approvals contexts.
- Audit history for role, access, approver assignment, transfer, and override changes.

### Out of scope

- Reopening approved work.
- Payroll/invoicing/export consequences.

### Automated tests

- Admin-only access.
- Last-Admin protection.
- Ineligible approvers excluded or rejected.
- Deactivation blocked until pending approvals transfer.
- Configuration changes do not rewrite existing approval assignments.

### Manual acceptance

- Invite a Manager, assign them to a project, create a pending review, attempt deactivation, transfer the review, then deactivate them.

### Exit criteria

- An Admin can resolve every supported approver configuration problem through the interface.

## Phase 10 — Workflow notifications

### Goal

Ensure actors do not need to poll the application to discover required work.

### In scope

- Durable notification events for submission, resubmission, approval, request changes, and transfer.
- In-app notification delivery first.
- Idempotent processing and read/unread state.
- Links open the exact permitted approval or returned project slice.
- Define an extension point for email without coupling email delivery to the transaction.

### Out of scope

- Email delivery unless separately approved.
- Reminder/escalation schedules.

### Automated tests

- Correct recipient for each event.
- No notification to unauthorized or inactive users.
- Duplicate event delivery is idempotent.
- Links respect current authorization even if roles changed after creation.

### Manual acceptance

- Complete the approval lifecycle and verify each actor receives the expected actionable notification.

### Exit criteria

- The complete flow can progress without users manually polling the Approvals page.

## Deferred decisions and features

- Reopening or reversing approved work.
- Downstream locking after invoicing, payroll, or export.
- Bulk approval.
- Delegated/temporary approvers and absence periods.
- Multiple equal approvers or multi-stage approvals.
- Email notifications, reminders, and escalation policies.
- Organisation-wide roles above a workspace.

## Traceability to the consideration notes

| Consideration | Addressed in |
| --- | --- |
| Versioned approval object | Phases 0 and 3 |
| Derived weekly status | Phases 3 and 8 |
| Mid-review approver changes | Phases 2 and 4 |
| Self-approval | Phases 0 and 4 |
| Missing approver | Phase 2 |
| Separate Admin powers | Phases 0, 4, and deferred scope |
| Returned-slice editability | Phases 3 and 8 |
| Resubmission diff | Phases 3 and 8 |
| Actionable inbox versus history | Phase 6 |
| Notifications | Phase 10 |
| Project-slice permission isolation | Phases 1, 4, and 6 |
| API-enforced authorization | Phase 1 onward |
| Member comments versus internal reasons | Phases 4, 7, and 8 |

## Recommended implementation order

Implementation note (2026-08-12): Phases 4–10 are implemented in source. Automated validation and owner manual acceptance remain pending.

Proceed strictly from Phase 0 through Phase 10. Do not begin the Approvals UI before Phases 1–4 are accepted: those phases define the security, routing, revision, and audit contracts the interface depends on.
