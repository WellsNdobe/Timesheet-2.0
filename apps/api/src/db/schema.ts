import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const workspaceRoleEnum = pgEnum("workspace_role", ["admin", "manager", "member"]);
export const invitationStatusEnum = pgEnum("invitation_status", ["pending", "accepted", "revoked"]);
export const timesheetStatusEnum = pgEnum("timesheet_status", ["draft", "in_review", "changes_requested", "partially_approved", "approved"]);
export const approvalRevisionStatusEnum = pgEnum("approval_revision_status", ["pending", "approved", "changes_requested", "withdrawn"]);
export const reviewEventTypeEnum = pgEnum("review_event_type", ["submitted", "resubmitted", "approved", "changes_requested", "withdrawn", "transferred", "admin_override"]);

export const users = pgTable(
  "users",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    requiresPasswordChange: boolean("requires_password_change").notNull().default(false),
    authVersion: integer("auth_version").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    check("users_email_lowercase", sql`${table.email} = lower(${table.email})`),
  ],
);

export const workspaces = pgTable(
  "workspaces",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    name: text("name").notNull(),
    timezone: text("timezone").notNull(),
    createdByUserId: bigint("created_by_user_id", { mode: "number" }).notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check("workspaces_name_not_empty", sql`length(trim(${table.name})) > 0`)],
);

export const workspaceMemberships = pgTable(
  "workspace_memberships",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    workspaceId: bigint("workspace_id", { mode: "number" }).notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    userId: bigint("user_id", { mode: "number" }).notNull().references(() => users.id, { onDelete: "cascade" }),
    role: workspaceRoleEnum("role").notNull().default("member"),
    isActive: boolean("is_active").notNull().default(true),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("workspace_memberships_workspace_user_unique").on(table.workspaceId, table.userId),
    index("workspace_memberships_user_index").on(table.userId),
  ],
);

export const workspaceInvitations = pgTable(
  "workspace_invitations",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    workspaceId: bigint("workspace_id", { mode: "number" }).notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: workspaceRoleEnum("role").notNull().default("member"),
    tokenHash: text("token_hash").notNull(),
    status: invitationStatusEnum("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    invitedByMembershipId: bigint("invited_by_membership_id", { mode: "number" }).notNull().references(() => workspaceMemberships.id),
    acceptedByUserId: bigint("accepted_by_user_id", { mode: "number" }).references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("workspace_invitations_token_hash_unique").on(table.tokenHash),
    index("workspace_invitations_workspace_status_index").on(table.workspaceId, table.status),
    check("workspace_invitations_email_lowercase", sql`${table.email} = lower(${table.email})`),
  ],
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    userId: bigint("user_id", { mode: "number" }).notNull().references(() => users.id, { onDelete: "cascade" }),
    refreshTokenHash: text("refresh_token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("auth_sessions_refresh_token_hash_unique").on(table.refreshTokenHash),
    index("auth_sessions_user_id_index").on(table.userId),
  ],
);

export const clients = pgTable(
  "clients",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    workspaceId: bigint("workspace_id", { mode: "number" }).notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    isArchived: boolean("is_archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("clients_workspace_name_unique").on(table.workspaceId, table.name),
    index("clients_workspace_archived_index").on(table.workspaceId, table.isArchived),
    check("clients_name_not_empty", sql`length(trim(${table.name})) > 0`),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    workspaceId: bigint("workspace_id", { mode: "number" }).notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    clientId: bigint("client_id", { mode: "number" }).references(() => clients.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    approverMembershipId: bigint("approver_membership_id", { mode: "number" }).references(() => workspaceMemberships.id),
    hourlyRateCents: integer("hourly_rate_cents"),
    rateCurrency: text("rate_currency"),
    budgetMinutes: integer("budget_minutes"),
    budgetCents: integer("budget_cents"),
    budgetCurrency: text("budget_currency"),
    isArchived: boolean("is_archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("projects_workspace_archived_index").on(table.workspaceId, table.isArchived),
    index("projects_client_index").on(table.clientId),
    check("projects_rate_valid", sql`(${table.hourlyRateCents} is null and ${table.rateCurrency} is null) or (${table.hourlyRateCents} >= 0 and ${table.rateCurrency} ~ '^[A-Z]{3}$')`),
    check("projects_budget_minutes_valid", sql`${table.budgetMinutes} is null or ${table.budgetMinutes} > 0`),
    check("projects_budget_cents_valid", sql`(${table.budgetCents} is null and ${table.budgetCurrency} is null) or (${table.budgetCents} >= 0 and ${table.budgetCurrency} ~ '^[A-Z]{3}$')`),
  ],
);

// Rates are append-only. A work date uses the last rate effective on that date.
export const projectRates = pgTable("project_rates", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  projectId: bigint("project_id", { mode: "number" }).notNull().references(() => projects.id),
  effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
  hourlyRateCents: integer("hourly_rate_cents").notNull(),
  currency: text("currency").notNull(),
  isLegacy: boolean("is_legacy").notNull().default(false),
  reason: text("reason").notNull(),
  createdByMembershipId: bigint("created_by_membership_id", { mode: "number" }).references(() => workspaceMemberships.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("project_rates_project_date_unique").on(table.projectId, table.effectiveFrom),
  check("project_rates_amount_valid", sql`${table.hourlyRateCents} >= 0 and ${table.hourlyRateCents} <= 100000000`),
  check("project_rates_currency_valid", sql`${table.currency} ~ '^[A-Z]{3}$'`),
]);

export const tasks = pgTable(
  "tasks",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    projectId: bigint("project_id", { mode: "number" }).notNull().references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    isArchived: boolean("is_archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("tasks_project_archived_index").on(table.projectId, table.isArchived)],
);

export const weeklyTimesheets = pgTable(
  "weekly_timesheets",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    workspaceId: bigint("workspace_id", { mode: "number" }).notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    membershipId: bigint("membership_id", { mode: "number" }).notNull().references(() => workspaceMemberships.id),
    weekStart: date("week_start", { mode: "string" }).notNull(),
    status: timesheetStatusEnum("status").notNull().default("draft"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    lastResolvedAt: timestamp("last_resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("weekly_timesheets_workspace_membership_week_unique").on(table.workspaceId, table.membershipId, table.weekStart),
    index("weekly_timesheets_workspace_membership_week_index").on(table.workspaceId, table.membershipId, table.weekStart),
  ],
);

export const timeEntries = pgTable(
  "time_entries",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    workspaceId: bigint("workspace_id", { mode: "number" }).notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    membershipId: bigint("membership_id", { mode: "number" }).notNull().references(() => workspaceMemberships.id),
    projectId: bigint("project_id", { mode: "number" }).notNull().references(() => projects.id),
    taskId: bigint("task_id", { mode: "number" }).references(() => tasks.id),
    workDate: date("work_date", { mode: "string" }).notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    description: text("description"),
    isBillable: boolean("is_billable").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("time_entries_duration_positive", sql`${table.durationMinutes} > 0`),
    check("time_entries_timestamps_paired", sql`(${table.startedAt} is null and ${table.endedAt} is null) or (${table.startedAt} is not null and ${table.endedAt} is not null)`),
    index("time_entries_workspace_membership_date_index").on(table.workspaceId, table.membershipId, table.workDate),
    index("time_entries_project_date_index").on(table.projectId, table.workDate),
  ],
);

export const timesheetApprovalItems = pgTable(
  "timesheet_approval_items",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    weeklyTimesheetId: bigint("weekly_timesheet_id", { mode: "number" }).notNull().references(() => weeklyTimesheets.id, { onDelete: "cascade" }),
    projectId: bigint("project_id", { mode: "number" }).notNull().references(() => projects.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("timesheet_approval_items_timesheet_project_unique").on(table.weeklyTimesheetId, table.projectId),
  ],
);

export const idempotencyOperations = pgTable(
  "idempotency_operations",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    workspaceId: bigint("workspace_id", { mode: "number" }).notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    actorMembershipId: bigint("actor_membership_id", { mode: "number" }).notNull().references(() => workspaceMemberships.id, { onDelete: "cascade" }),
    operation: text("operation").notNull(),
    key: uuid("key").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    state: text("state").notNull().default("processing"),
    resourceId: bigint("resource_id", { mode: "number" }),
    responseStatus: integer("response_status"),
    responsePayload: text("response_payload"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idempotency_operations_scope_key_unique").on(table.workspaceId, table.actorMembershipId, table.operation, table.key),
    index("idempotency_operations_expiry_index").on(table.expiresAt),
    check("idempotency_operations_state_valid", sql`${table.state} in ('processing', 'completed')`),
  ],
);

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    userId: bigint("user_id", { mode: "number" }).notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("password_reset_tokens_token_hash_unique").on(table.tokenHash),
    index("password_reset_tokens_user_created_index").on(table.userId, table.createdAt),
    index("password_reset_tokens_expiry_index").on(table.expiresAt),
  ],
);

export const timesheetApprovalRevisions = pgTable(
  "timesheet_approval_revisions",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    approvalItemId: bigint("approval_item_id", { mode: "number" }).notNull().references(() => timesheetApprovalItems.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    approverMembershipId: bigint("approver_membership_id", { mode: "number" }).notNull().references(() => workspaceMemberships.id),
    assignedApproverMembershipId: bigint("assigned_approver_membership_id", { mode: "number" }).notNull().references(() => workspaceMemberships.id),
    projectName: text("project_name").notNull(),
    status: approvalRevisionStatusEnum("status").notNull().default("pending"),
    submittedMinutes: integer("submitted_minutes").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByMembershipId: bigint("resolved_by_membership_id", { mode: "number" }).references(() => workspaceMemberships.id),
    returnComment: text("return_comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("timesheet_approval_revisions_item_number_unique").on(table.approvalItemId, table.revisionNumber),
    uniqueIndex("timesheet_approval_revisions_one_pending_item_unique").on(table.approvalItemId).where(sql`${table.status} = 'pending'`),
    index("timesheet_approval_revisions_approver_status_index").on(table.assignedApproverMembershipId, table.status, table.submittedAt),
    check("timesheet_approval_revisions_number_positive", sql`${table.revisionNumber} > 0`),
    check("timesheet_approval_revisions_minutes_valid", sql`(${table.status} = 'withdrawn' and ${table.submittedMinutes} = 0) or (${table.status} <> 'withdrawn' and ${table.submittedMinutes} > 0)`),
    check("timesheet_approval_revisions_resolution_valid", sql`(${table.status} = 'pending' and ${table.resolvedAt} is null and ${table.resolvedByMembershipId} is null) or (${table.status} <> 'pending' and ${table.resolvedAt} is not null and ${table.resolvedByMembershipId} is not null)`),
    check("timesheet_approval_revisions_return_comment_valid", sql`(${table.status} = 'changes_requested' and ${table.returnComment} is not null and length(trim(${table.returnComment})) > 0) or (${table.status} <> 'changes_requested' and ${table.returnComment} is null)`),
  ],
);

export const timesheetReviewEvents = pgTable(
  "timesheet_review_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    revisionId: bigint("revision_id", { mode: "number" }).notNull().references(() => timesheetApprovalRevisions.id, { onDelete: "cascade" }),
    actorMembershipId: bigint("actor_membership_id", { mode: "number" }).references(() => workspaceMemberships.id),
    type: reviewEventTypeEnum("type").notNull(),
    comment: text("comment"),
    internalReason: text("internal_reason"),
    previousApproverMembershipId: bigint("previous_approver_membership_id", { mode: "number" }).references(() => workspaceMemberships.id),
    nextApproverMembershipId: bigint("next_approver_membership_id", { mode: "number" }).references(() => workspaceMemberships.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("timesheet_review_events_revision_index").on(table.revisionId, table.createdAt)],
);

export const timesheetReviewEntrySnapshots = pgTable(
  "timesheet_review_entry_snapshots",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    revisionId: bigint("revision_id", { mode: "number" }).notNull().references(() => timesheetApprovalRevisions.id, { onDelete: "cascade" }),
    sourceEntryId: bigint("source_entry_id", { mode: "number" }).notNull(),
    taskId: bigint("task_id", { mode: "number" }),
    taskName: text("task_name"),
    workDate: date("work_date", { mode: "string" }).notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    description: text("description"),
    isBillable: boolean("is_billable").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("timesheet_review_entry_snapshots_duration_positive", sql`${table.durationMinutes} > 0`),
    index("timesheet_review_entry_snapshots_revision_index").on(table.revisionId, table.workDate),
  ],
);

export const billingBatches = pgTable("billing_batches", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  workspaceId: bigint("workspace_id", { mode: "number" }).notNull().references(() => workspaces.id),
  clientId: bigint("client_id", { mode: "number" }).notNull().references(() => clients.id),
  clientName: text("client_name").notNull(),
  currency: text("currency").notNull(),
  totalMinutes: integer("total_minutes").notNull(),
  totalCents: bigint("total_cents", { mode: "number" }).notNull(),
  entryCount: integer("entry_count").notNull(),
  dateFrom: date("date_from", { mode: "string" }).notNull(),
  dateTo: date("date_to", { mode: "string" }).notNull(),
  idempotencyKey: uuid("idempotency_key").notNull(),
  requestFingerprint: text("request_fingerprint").notNull(),
  createdByMembershipId: bigint("created_by_membership_id", { mode: "number" }).notNull().references(() => workspaceMemberships.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  invoiceReference: text("invoice_reference"),
  handedOffAt: timestamp("handed_off_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("billing_batches_request_unique").on(table.workspaceId, table.idempotencyKey),
  index("billing_batches_workspace_id_index").on(table.workspaceId, table.id),
  check("billing_batches_totals_valid", sql`${table.totalMinutes} > 0 and ${table.totalCents} >= 0 and ${table.entryCount} > 0`),
]);

export const billingBatchEntries = pgTable("billing_batch_entries", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  batchId: bigint("batch_id", { mode: "number" }).notNull().references(() => billingBatches.id),
  workspaceId: bigint("workspace_id", { mode: "number" }).notNull().references(() => workspaces.id),
  snapshotId: bigint("snapshot_id", { mode: "number" }).notNull().references(() => timesheetReviewEntrySnapshots.id),
  sourceEntryId: bigint("source_entry_id", { mode: "number" }).notNull(),
  revisionId: bigint("revision_id", { mode: "number" }).notNull().references(() => timesheetApprovalRevisions.id),
  projectId: bigint("project_id", { mode: "number" }).notNull().references(() => projects.id),
  projectName: text("project_name").notNull(),
  memberEmail: text("member_email").notNull(),
  taskName: text("task_name"),
  description: text("description"),
  workDate: date("work_date", { mode: "string" }).notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  rateId: bigint("rate_id", { mode: "number" }).notNull().references(() => projectRates.id),
  hourlyRateCents: integer("hourly_rate_cents").notNull(),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
}, (table) => [
  uniqueIndex("billing_batch_entries_source_unique").on(table.workspaceId, table.sourceEntryId),
  uniqueIndex("billing_batch_entries_snapshot_unique").on(table.snapshotId),
  index("billing_batch_entries_batch_index").on(table.batchId),
  index("billing_batch_entries_project_date_index").on(table.projectId, table.workDate),
  check("billing_batch_entries_amount_valid", sql`${table.durationMinutes} > 0 and ${table.hourlyRateCents} >= 0 and ${table.amountCents} >= 0`),
]);

// These records describe the weekly expectation; they never change recorded time.
export const workspaceTimePolicies = pgTable(
  "workspace_time_policies",
  {
    workspaceId: bigint("workspace_id", { mode: "number" }).primaryKey().references(() => workspaces.id, { onDelete: "cascade" }),
    expectedWeeklyMinutes: integer("expected_weekly_minutes").notNull().default(2400),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check("workspace_time_policies_expected_weekly_minutes_valid", sql`${table.expectedWeeklyMinutes} > 0 and ${table.expectedWeeklyMinutes} <= 10080 and mod(${table.expectedWeeklyMinutes}, 5) = 0`)],
);

export const timeExpectancyExceptions = pgTable(
  "time_expectancy_exceptions",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    workspaceId: bigint("workspace_id", { mode: "number" }).notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    membershipId: bigint("membership_id", { mode: "number" }).references(() => workspaceMemberships.id, { onDelete: "cascade" }),
    workDate: date("work_date", { mode: "string" }).notNull(),
    type: text("type").notNull(),
    name: text("name").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    createdByMembershipId: bigint("created_by_membership_id", { mode: "number" }).notNull().references(() => workspaceMemberships.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("time_expectancy_exceptions_workspace_date_index").on(table.workspaceId, table.workDate),
    uniqueIndex("time_expectancy_exceptions_public_holiday_unique").on(table.workspaceId, table.workDate).where(sql`${table.type} = 'public_holiday'`),
    uniqueIndex("time_expectancy_exceptions_membership_date_unique").on(table.workspaceId, table.membershipId, table.workDate).where(sql`${table.type} = 'leave'`),
    check("time_expectancy_exceptions_type_valid", sql`${table.type} in ('public_holiday', 'leave')`),
    check("time_expectancy_exceptions_scope_valid", sql`(${table.type} = 'public_holiday' and ${table.membershipId} is null) or (${table.type} = 'leave' and ${table.membershipId} is not null)`),
    check("time_expectancy_exceptions_name_not_empty", sql`length(trim(${table.name})) > 0`),
    check("time_expectancy_exceptions_duration_valid", sql`${table.durationMinutes} > 0 and ${table.durationMinutes} <= 1440`),
  ],
);

export const workspaceAuditEvents = pgTable(
  "workspace_audit_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    workspaceId: bigint("workspace_id", { mode: "number" }).notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    actorMembershipId: bigint("actor_membership_id", { mode: "number" }).references(() => workspaceMemberships.id),
    type: text("type").notNull(),
    targetMembershipId: bigint("target_membership_id", { mode: "number" }).references(() => workspaceMemberships.id),
    targetProjectId: bigint("target_project_id", { mode: "number" }).references(() => projects.id),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("workspace_audit_events_workspace_created_index").on(table.workspaceId, table.createdAt)],
);

export const workflowNotifications = pgTable(
  "workflow_notifications",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    workspaceId: bigint("workspace_id", { mode: "number" }).notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    recipientMembershipId: bigint("recipient_membership_id", { mode: "number" }).notNull().references(() => workspaceMemberships.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    href: text("href").notNull(),
    sourceKey: text("source_key").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("workflow_notifications_recipient_source_unique").on(table.recipientMembershipId, table.sourceKey),
    index("workflow_notifications_recipient_created_index").on(table.recipientMembershipId, table.createdAt),
  ],
);

export type User = typeof users.$inferSelect;
export type NewAuthSession = typeof authSessions.$inferInsert;
