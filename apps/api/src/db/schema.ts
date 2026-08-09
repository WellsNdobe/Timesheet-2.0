import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const workspaceRoleEnum = pgEnum("workspace_role", ["admin", "manager", "member"]);
export const invitationStatusEnum = pgEnum("invitation_status", ["pending", "accepted", "revoked"]);
export const timesheetStatusEnum = pgEnum("timesheet_status", ["draft", "submitted", "changes_requested", "approved"]);
export const projectReviewStatusEnum = pgEnum("project_review_status", ["pending", "approved", "changes_requested"]);
export const reviewEventTypeEnum = pgEnum("review_event_type", ["submitted", "approved", "changes_requested"]);

export const users = pgTable(
  "users",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
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
    timezone: text("timezone").notNull().default("Africa/Johannesburg"),
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

export const timesheetProjectReviews = pgTable(
  "timesheet_project_reviews",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    weeklyTimesheetId: bigint("weekly_timesheet_id", { mode: "number" }).notNull().references(() => weeklyTimesheets.id, { onDelete: "cascade" }),
    projectId: bigint("project_id", { mode: "number" }).notNull().references(() => projects.id),
    approverMembershipId: bigint("approver_membership_id", { mode: "number" }).notNull().references(() => workspaceMemberships.id),
    projectName: text("project_name").notNull(),
    status: projectReviewStatusEnum("status").notNull().default("pending"),
    submittedMinutes: integer("submitted_minutes").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByMembershipId: bigint("resolved_by_membership_id", { mode: "number" }).references(() => workspaceMemberships.id),
    returnComment: text("return_comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("timesheet_project_reviews_timesheet_project_unique").on(table.weeklyTimesheetId, table.projectId),
    index("timesheet_project_reviews_approver_status_index").on(table.approverMembershipId, table.status, table.submittedAt),
  ],
);

export const timesheetReviewEvents = pgTable(
  "timesheet_review_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    reviewId: bigint("review_id", { mode: "number" }).notNull().references(() => timesheetProjectReviews.id, { onDelete: "cascade" }),
    actorMembershipId: bigint("actor_membership_id", { mode: "number" }).references(() => workspaceMemberships.id),
    type: reviewEventTypeEnum("type").notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("timesheet_review_events_review_index").on(table.reviewId, table.createdAt)],
);

export const timesheetReviewEntrySnapshots = pgTable(
  "timesheet_review_entry_snapshots",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    reviewId: bigint("review_id", { mode: "number" }).notNull().references(() => timesheetProjectReviews.id, { onDelete: "cascade" }),
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
    index("timesheet_review_entry_snapshots_review_index").on(table.reviewId, table.workDate),
  ],
);

export type User = typeof users.$inferSelect;
export type NewAuthSession = typeof authSessions.$inferInsert;
