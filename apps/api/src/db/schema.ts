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

export const projects = pgTable(
  "projects",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    workspaceId: bigint("workspace_id", { mode: "number" }).notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    approverMembershipId: bigint("approver_membership_id", { mode: "number" }).references(() => workspaceMemberships.id),
    isArchived: boolean("is_archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("projects_workspace_archived_index").on(table.workspaceId, table.isArchived)],
);

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
