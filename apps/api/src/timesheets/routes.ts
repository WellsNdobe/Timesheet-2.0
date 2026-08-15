import { and, asc, desc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../auth/middleware.js";
import { db } from "../db/client.js";
import {
  projects, tasks, timeEntries, timesheetApprovalItems, timesheetApprovalRevisions,
  timesheetReviewEntrySnapshots, timesheetReviewEvents, weeklyTimesheets,
  users, workspaceMemberships, workspaces,
} from "../db/schema.js";
import { ApiError, asyncHandler } from "../errors.js";
import {
  insufficientPermissions, notFound, parseResourceId, requireAdmin,
  requireAssignedApprover, requireAssignedProjectManager, requireManagerOrAdmin,
  requireWorkspaceMembership, type WorkspaceMembership,
} from "../workspaces/access.js";
import { audit, notify } from "../workflow/events.js";

const idSchema = z.coerce.number().int().positive();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "A real calendar date is required.");
const weekSchema = dateSchema.refine((value) => new Date(`${value}T00:00:00.000Z`).getUTCDay() === 1, "weekStart must be a Monday.");
const projectSchema = z.object({ name: z.string().trim().min(1).max(160), approverMembershipId: idSchema.nullable().optional() }).strict();
const taskSchema = z.object({ name: z.string().trim().min(1).max(160) }).strict();
const entryBaseSchema = z.object({
  projectId: idSchema, taskId: idSchema.nullable().optional(), workDate: dateSchema,
  durationMinutes: z.number().int().positive().max(24 * 60),
  startedAt: z.string().datetime({ offset: true }).nullable().optional(),
  endedAt: z.string().datetime({ offset: true }).nullable().optional(),
  description: z.string().trim().max(2_000).nullable().optional(), isBillable: z.boolean().optional(),
}).strict();
const entrySchema = entryBaseSchema.superRefine((value, context) => {
  if ((value.startedAt == null) !== (value.endedAt == null)) context.addIssue({ code: "custom", message: "startedAt and endedAt must be supplied together." });
  if (value.startedAt && value.endedAt && new Date(value.endedAt).getTime() <= new Date(value.startedAt).getTime()) context.addIssue({ code: "custom", message: "endedAt must be after startedAt." });
});
const entryPatchSchema = entryBaseSchema.partial().superRefine((value, context) => {
  if ((value.startedAt == null) !== (value.endedAt == null) && (value.startedAt !== undefined || value.endedAt !== undefined)) context.addIssue({ code: "custom", message: "startedAt and endedAt must be supplied together." });
  if (value.startedAt && value.endedAt && new Date(value.endedAt).getTime() <= new Date(value.startedAt).getTime()) context.addIssue({ code: "custom", message: "endedAt must be after startedAt." });
});

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ProjectRow = typeof projects.$inferSelect;

const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(400, "validation_error", result.error.issues[0]?.message ?? "Invalid request.");
  return result.data;
};
const paramId = (value: string | string[] | undefined) => parseResourceId(value);
const weekEnd = (weekStart: string) => {
  const value = new Date(`${weekStart}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 7);
  return value.toISOString().slice(0, 10);
};
const dateInZone = (value: string, timezone: string) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const part = (type: "year" | "month" | "day") => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};
const lockWorkspaceGovernance = (transaction: DbTransaction, workspaceId: number) => transaction.execute(sql`select pg_advisory_xact_lock(${workspaceId})`);
const lockMemberEntries = (transaction: DbTransaction, workspaceId: number, membershipId: number) => transaction.execute(sql`select pg_advisory_xact_lock(${workspaceId}, ${membershipId})`);
const publicEntry = (entry: typeof timeEntries.$inferSelect) => ({ ...entry, id: String(entry.id), workspaceId: String(entry.workspaceId), membershipId: String(entry.membershipId), projectId: String(entry.projectId), taskId: entry.taskId == null ? null : String(entry.taskId), startedAt: entry.startedAt?.toISOString() ?? null, endedAt: entry.endedAt?.toISOString() ?? null, createdAt: entry.createdAt.toISOString(), updatedAt: entry.updatedAt.toISOString() });
const publicProject = (project: ProjectRow) => ({ ...project, id: String(project.id), workspaceId: String(project.workspaceId), approverMembershipId: project.approverMembershipId == null ? null : String(project.approverMembershipId), createdAt: project.createdAt.toISOString(), updatedAt: project.updatedAt.toISOString() });
const memberIdentities = async (transaction: DbTransaction, workspaceId: number, membershipIds: number[]) => {
  if (!membershipIds.length) return new Map<number, { id: string; email: string; role: string; isActive: boolean }>();
  const rows = await transaction.select({ membership: workspaceMemberships, user: users }).from(workspaceMemberships).innerJoin(users, eq(workspaceMemberships.userId, users.id)).where(and(eq(workspaceMemberships.workspaceId, workspaceId), inArray(workspaceMemberships.id, [...new Set(membershipIds)])));
  return new Map(rows.map(({ membership, user }) => [membership.id, { id: String(membership.id), email: user.email, role: membership.role, isActive: membership.isActive }]));
};

const membershipInTransaction = async (transaction: DbTransaction, workspaceId: number, userId: number): Promise<WorkspaceMembership> => {
  const [membership] = await transaction.select({ id: workspaceMemberships.id, workspaceId: workspaceMemberships.workspaceId, userId: workspaceMemberships.userId, role: workspaceMemberships.role, isActive: workspaceMemberships.isActive })
    .from(workspaceMemberships).where(and(eq(workspaceMemberships.workspaceId, workspaceId), eq(workspaceMemberships.userId, userId), eq(workspaceMemberships.isActive, true))).limit(1);
  if (!membership) throw notFound();
  return membership as WorkspaceMembership;
};

const eligibleApprover = async (transaction: DbTransaction, workspaceId: number, membershipId: number) => {
  const [membership] = await transaction.select()
    .from(workspaceMemberships).where(and(eq(workspaceMemberships.id, membershipId), eq(workspaceMemberships.workspaceId, workspaceId), eq(workspaceMemberships.isActive, true), ne(workspaceMemberships.role, "member"))).limit(1);
  return membership ?? null;
};

const requireProject = async (transaction: DbTransaction, workspaceId: number, projectId: number, allowArchived = false) => {
  const [project] = await transaction.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId))).limit(1);
  if (!project) throw notFound();
  if (!allowArchived && project.isArchived) throw new ApiError(400, "invalid_project", "The selected project is not available.");
  return project;
};

const requireTask = async (transaction: DbTransaction, projectId: number, taskId: number, allowArchived = false) => {
  const [task] = await transaction.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId))).limit(1);
  if (!task) throw notFound();
  if (!allowArchived && task.isArchived) throw new ApiError(400, "invalid_task", "The selected task is not available.");
  return task;
};

const validateEntryReferences = async (transaction: DbTransaction, workspaceId: number, projectId: number, taskId: number | null | undefined, allowArchived = false) => {
  const project = await requireProject(transaction, workspaceId, projectId, allowArchived);
  if (taskId != null) await requireTask(transaction, projectId, taskId, allowArchived);
  return project;
};

const latestRevisionRows = async (transaction: DbTransaction, itemIds: number[]) => {
  if (!itemIds.length) return new Map<number, typeof timesheetApprovalRevisions.$inferSelect>();
  const rows = await transaction.select().from(timesheetApprovalRevisions).where(inArray(timesheetApprovalRevisions.approvalItemId, itemIds)).orderBy(desc(timesheetApprovalRevisions.revisionNumber));
  return new Map(rows.filter((row) => !rows.some((other) => other.approvalItemId === row.approvalItemId && other.revisionNumber > row.revisionNumber)).map((row) => [row.approvalItemId, row]));
};

const isProjectLocked = async (transaction: DbTransaction, workspaceId: number, membershipId: number, workDate: string, projectId: number) => {
  const monday = new Date(`${workDate}T00:00:00.000Z`);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const [sheet] = await transaction.select({ id: weeklyTimesheets.id, status: weeklyTimesheets.status }).from(weeklyTimesheets).where(and(eq(weeklyTimesheets.workspaceId, workspaceId), eq(weeklyTimesheets.membershipId, membershipId), eq(weeklyTimesheets.weekStart, monday.toISOString().slice(0, 10)))).limit(1);
  if (!sheet) return false;
  if (sheet.status === "draft") return false;
  const [item] = await transaction.select({ id: timesheetApprovalItems.id }).from(timesheetApprovalItems).where(and(eq(timesheetApprovalItems.weeklyTimesheetId, sheet.id), eq(timesheetApprovalItems.projectId, projectId))).limit(1);
  if (!item) return true;
  const latest = (await latestRevisionRows(transaction, [item.id])).get(item.id);
  return latest?.status !== "changes_requested";
};

const projectHasSubmissionHistory = async (transaction: DbTransaction, workspaceId: number, membershipId: number, workDate: string, projectId: number) => {
  const monday = new Date(`${workDate}T00:00:00.000Z`); monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const [row] = await transaction.select({ id: timesheetApprovalItems.id }).from(timesheetApprovalItems)
    .innerJoin(weeklyTimesheets, eq(timesheetApprovalItems.weeklyTimesheetId, weeklyTimesheets.id))
    .where(and(eq(weeklyTimesheets.workspaceId, workspaceId), eq(weeklyTimesheets.membershipId, membershipId), eq(weeklyTimesheets.weekStart, monday.toISOString().slice(0, 10)), eq(timesheetApprovalItems.projectId, projectId))).limit(1);
  return Boolean(row);
};

const assertSelfReviewAllowed = async (transaction: DbTransaction, workspaceId: number, submitterMembershipId: number, reviewer: WorkspaceMembership) => {
  if (submitterMembershipId !== reviewer.id) return;
  if (reviewer.role !== "admin") throw new ApiError(403, "self_review_not_allowed", "Only a sole workspace admin may review their own week.");
  const rows = await transaction.select({ value: sql<number>`count(*)::int` }).from(workspaceMemberships).where(and(eq(workspaceMemberships.workspaceId, workspaceId), eq(workspaceMemberships.isActive, true)));
  if ((rows[0]?.value ?? 0) !== 1) throw new ApiError(403, "self_review_not_allowed", "Self-review is only allowed in a one-member workspace.");
};

const updateSheetStatus = async (transaction: DbTransaction, sheetId: number) => {
  const items = await transaction.select({ id: timesheetApprovalItems.id }).from(timesheetApprovalItems).where(eq(timesheetApprovalItems.weeklyTimesheetId, sheetId));
  const latest = [...(await latestRevisionRows(transaction, items.map((item) => item.id))).values()].filter((revision) => revision.status !== "withdrawn");
  const status = latest.length === 0 ? "draft" : latest.every((revision) => revision.status === "approved") ? "approved" : latest.some((revision) => revision.status === "approved") ? "partially_approved" : latest.some((revision) => revision.status === "changes_requested") ? "changes_requested" : "in_review";
  await transaction.update(weeklyTimesheets).set({ status, lastResolvedAt: status === "approved" ? new Date() : null, updatedAt: new Date() }).where(eq(weeklyTimesheets.id, sheetId));
  return status;
};

export const timesheetRouter = Router();
timesheetRouter.use(authenticate);

timesheetRouter.get("/workspaces/:workspaceId/projects", asyncHandler(async (request, response) => {
  const workspaceId = paramId(request.params.workspaceId); await requireWorkspaceMembership(response, workspaceId);
  const rows = await db.select().from(projects).where(and(eq(projects.workspaceId, workspaceId), ...(request.query.includeArchived === "true" ? [] : [eq(projects.isArchived, false)]))).orderBy(asc(projects.name));
  const identities = await db.transaction((transaction) => memberIdentities(transaction, workspaceId, rows.flatMap((project) => project.approverMembershipId == null ? [] : [project.approverMembershipId])));
  response.json({ projects: rows.map((project) => { const approver = project.approverMembershipId == null ? null : identities.get(project.approverMembershipId) ?? null; return { ...publicProject(project), approver, submissionReady: approver?.isActive === true && ["admin", "manager"].includes(approver.role) }; }) });
}));

timesheetRouter.post("/workspaces/:workspaceId/projects", asyncHandler(async (request, response) => {
  const workspaceId = paramId(request.params.workspaceId); const userId = Number(response.locals.authUser.id); const input = parse(projectSchema, request.body);
  const project = await db.transaction(async (transaction) => {
    await lockWorkspaceGovernance(transaction, workspaceId); const actor = await membershipInTransaction(transaction, workspaceId, userId); requireAdmin(actor);
    if (input.approverMembershipId != null && !await eligibleApprover(transaction, workspaceId, input.approverMembershipId)) throw new ApiError(400, "invalid_approver", "Approver must be an active manager or admin in this workspace.");
    const [created] = await transaction.insert(projects).values({ workspaceId, name: input.name, approverMembershipId: input.approverMembershipId ?? null }).returning();
    await audit(transaction, { workspaceId, actorMembershipId: actor.id, type: "project_created", targetProjectId: created.id, details: { name: created.name, approverMembershipId: created.approverMembershipId == null ? null : String(created.approverMembershipId) } });
    return created;
  });
  response.status(201).json({ project: publicProject(project) });
}));

timesheetRouter.patch("/workspaces/:workspaceId/projects/:projectId", asyncHandler(async (request, response) => {
  const workspaceId = paramId(request.params.workspaceId); const projectId = paramId(request.params.projectId); const userId = Number(response.locals.authUser.id); const input = parse(projectSchema.partial().extend({ isArchived: z.boolean().optional() }).strict(), request.body);
  const project = await db.transaction(async (transaction) => {
    await lockWorkspaceGovernance(transaction, workspaceId); const actor = await membershipInTransaction(transaction, workspaceId, userId); const existing = await requireProject(transaction, workspaceId, projectId, true); requireAssignedProjectManager(actor, existing);
    if (actor.role === "manager" && (input.approverMembershipId !== undefined || input.isArchived !== undefined)) throw insufficientPermissions();
    if (input.isArchived === true) { const itemRows = await transaction.select({ id: timesheetApprovalItems.id }).from(timesheetApprovalItems).innerJoin(weeklyTimesheets, eq(timesheetApprovalItems.weeklyTimesheetId, weeklyTimesheets.id)).where(and(eq(timesheetApprovalItems.projectId, projectId), eq(weeklyTimesheets.workspaceId, workspaceId))); const latest = await latestRevisionRows(transaction, itemRows.map((item) => item.id)); if ([...latest.values()].some((revision) => revision.status === "pending" || revision.status === "changes_requested")) throw new ApiError(409, "project_has_unresolved_approvals", "Resolve or withdraw pending and returned approvals before archiving this project."); }
    if (input.approverMembershipId != null && !await eligibleApprover(transaction, workspaceId, input.approverMembershipId)) throw new ApiError(400, "invalid_approver", "Approver must be an active manager or admin in this workspace.");
    const [updated] = await transaction.update(projects).set({ ...input, updatedAt: new Date() }).where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId))).returning(); if (!updated) throw notFound();
    await audit(transaction, { workspaceId, actorMembershipId: actor.id, type: input.approverMembershipId !== undefined ? "project_approver_changed" : input.isArchived !== undefined ? "project_access_changed" : "project_updated", targetProjectId: projectId, details: { previousApproverMembershipId: existing.approverMembershipId == null ? null : String(existing.approverMembershipId), nextApproverMembershipId: updated.approverMembershipId == null ? null : String(updated.approverMembershipId), isArchived: updated.isArchived } });
    return updated;
  });
  response.json({ project: publicProject(project) });
}));

timesheetRouter.get("/workspaces/:workspaceId/projects/:projectId/tasks", asyncHandler(async (request, response) => {
  const workspaceId = paramId(request.params.workspaceId); const projectId = paramId(request.params.projectId); await requireWorkspaceMembership(response, workspaceId);
  const [project] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId))).limit(1); if (!project) throw notFound();
  const rows = await db.select().from(tasks).where(and(eq(tasks.projectId, projectId), ...(request.query.includeArchived === "true" ? [] : [eq(tasks.isArchived, false)]))).orderBy(asc(tasks.name));
  response.json({ tasks: rows.map((task) => ({ ...task, id: String(task.id), projectId: String(task.projectId), createdAt: task.createdAt.toISOString(), updatedAt: task.updatedAt.toISOString() })) });
}));

timesheetRouter.post("/workspaces/:workspaceId/projects/:projectId/tasks", asyncHandler(async (request, response) => {
  const workspaceId = paramId(request.params.workspaceId); const projectId = paramId(request.params.projectId); const userId = Number(response.locals.authUser.id); const input = parse(taskSchema, request.body);
  const task = await db.transaction(async (transaction) => {
    await lockWorkspaceGovernance(transaction, workspaceId); const actor = await membershipInTransaction(transaction, workspaceId, userId); const project = await requireProject(transaction, workspaceId, projectId); requireAssignedProjectManager(actor, project); const [created] = await transaction.insert(tasks).values({ projectId, name: input.name }).returning(); return created;
  });
  response.status(201).json({ task: { ...task, id: String(task.id), projectId: String(task.projectId), createdAt: task.createdAt.toISOString(), updatedAt: task.updatedAt.toISOString() } });
}));

timesheetRouter.patch("/workspaces/:workspaceId/projects/:projectId/tasks/:taskId", asyncHandler(async (request, response) => {
  const workspaceId = paramId(request.params.workspaceId); const projectId = paramId(request.params.projectId); const taskId = paramId(request.params.taskId); const userId = Number(response.locals.authUser.id); const input = parse(taskSchema.partial().extend({ isArchived: z.boolean().optional() }).strict(), request.body);
  const task = await db.transaction(async (transaction) => {
    await lockWorkspaceGovernance(transaction, workspaceId); const actor = await membershipInTransaction(transaction, workspaceId, userId); const project = await requireProject(transaction, workspaceId, projectId, true); requireAssignedProjectManager(actor, project); await requireTask(transaction, projectId, taskId, true); if (input.isArchived === true) { const [unresolved] = await transaction.select({ id: timesheetReviewEntrySnapshots.id }).from(timesheetReviewEntrySnapshots).innerJoin(timesheetApprovalRevisions, eq(timesheetReviewEntrySnapshots.revisionId, timesheetApprovalRevisions.id)).where(and(eq(timesheetReviewEntrySnapshots.taskId, taskId), inArray(timesheetApprovalRevisions.status, ["pending", "changes_requested"]))).limit(1); if (unresolved) throw new ApiError(409, "task_has_unresolved_approvals", "Resolve or withdraw pending and returned approvals before archiving this task."); } const [updated] = await transaction.update(tasks).set({ ...input, updatedAt: new Date() }).where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId))).returning(); if (!updated) throw notFound(); return updated;
  });
  response.json({ task: { ...task, id: String(task.id), projectId: String(task.projectId), createdAt: task.createdAt.toISOString(), updatedAt: task.updatedAt.toISOString() } });
}));

timesheetRouter.get("/workspaces/:workspaceId/time-entries", asyncHandler(async (request, response) => {
  const workspaceId = paramId(request.params.workspaceId); const member = await requireWorkspaceMembership(response, workspaceId); const weekStart = parse(weekSchema, request.query.weekStart); const [workspace] = await db.select({ timezone: workspaces.timezone }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1); if (!workspace) throw notFound();
  const entries = await db.select().from(timeEntries).where(and(eq(timeEntries.workspaceId, workspaceId), eq(timeEntries.membershipId, member.id), gte(timeEntries.workDate, weekStart), lt(timeEntries.workDate, weekEnd(weekStart)))).orderBy(asc(timeEntries.workDate), asc(timeEntries.createdAt));
  const [sheet] = await db.select().from(weeklyTimesheets).where(and(eq(weeklyTimesheets.workspaceId, workspaceId), eq(weeklyTimesheets.membershipId, member.id), eq(weeklyTimesheets.weekStart, weekStart))).limit(1);
  const dailyTotals = entries.reduce<Record<string, number>>((totals, entry) => ({ ...totals, [entry.workDate]: (totals[entry.workDate] ?? 0) + entry.durationMinutes }), {});
  response.json({ weekStart, timezone: workspace.timezone, entries: entries.map(publicEntry), dailyTotals, totalMinutes: entries.reduce((total, entry) => total + entry.durationMinutes, 0), billableMinutes: entries.filter((entry) => entry.isBillable).reduce((total, entry) => total + entry.durationMinutes, 0), status: sheet?.status ?? "draft" });
}));

timesheetRouter.get("/workspaces/:workspaceId/timesheets/:weekStart/status", asyncHandler(async (request, response) => {
  const workspaceId = paramId(request.params.workspaceId); const member = await requireWorkspaceMembership(response, workspaceId); const weekStart = parse(weekSchema, request.params.weekStart);
  const result = await db.transaction(async (transaction) => {
    const [sheet] = await transaction.select().from(weeklyTimesheets).where(and(eq(weeklyTimesheets.workspaceId, workspaceId), eq(weeklyTimesheets.membershipId, member.id), eq(weeklyTimesheets.weekStart, weekStart))).limit(1);
    if (!sheet) return { status: "draft" as const, portions: [] };
    const items = await transaction.select().from(timesheetApprovalItems).where(eq(timesheetApprovalItems.weeklyTimesheetId, sheet.id));
    const latest = await latestRevisionRows(transaction, items.map((item) => item.id));
    const identities = await memberIdentities(transaction, workspaceId, [...latest.values()].map((revision) => revision.assignedApproverMembershipId));
    return { status: sheet.status, portions: items.flatMap((item) => { const revision = latest.get(item.id); if (!revision || revision.status === "withdrawn") return []; return [{ approvalItemId: String(item.id), project: { id: String(item.projectId), name: revision.projectName }, revisionNumber: revision.revisionNumber, status: revision.status, submittedMinutes: revision.submittedMinutes, returnComment: revision.returnComment, assignedApprover: identities.get(revision.assignedApproverMembershipId) ?? null, editable: revision.status === "changes_requested" }]; }) };
  });
  response.json({ weekStart, ...result });
}));

timesheetRouter.post("/workspaces/:workspaceId/time-entries", asyncHandler(async (request, response) => {
  const workspaceId = paramId(request.params.workspaceId); const member = await requireWorkspaceMembership(response, workspaceId); const input = parse(entrySchema, request.body);
  const entry = await db.transaction(async (transaction) => { await lockMemberEntries(transaction, workspaceId, member.id); await validateEntryReferences(transaction, workspaceId, input.projectId, input.taskId); if (await isProjectLocked(transaction, workspaceId, member.id, input.workDate, input.projectId)) throw new ApiError(409, "entry_locked", "This entry belongs to a submitted or approved project review."); const [created] = await transaction.insert(timeEntries).values({ workspaceId, membershipId: member.id, projectId: input.projectId, taskId: input.taskId ?? null, workDate: input.workDate, durationMinutes: input.durationMinutes, startedAt: input.startedAt ? new Date(input.startedAt) : null, endedAt: input.endedAt ? new Date(input.endedAt) : null, description: input.description ?? null, isBillable: input.isBillable ?? true }).returning(); return created; });
  response.status(201).json({ entry: publicEntry(entry) });
}));

timesheetRouter.patch("/workspaces/:workspaceId/time-entries/:entryId", asyncHandler(async (request, response) => {
  const workspaceId = paramId(request.params.workspaceId); const member = await requireWorkspaceMembership(response, workspaceId); const entryId = paramId(request.params.entryId); const input = parse(entryPatchSchema, request.body);
  const entry = await db.transaction(async (transaction) => { await lockMemberEntries(transaction, workspaceId, member.id); const [existing] = await transaction.select().from(timeEntries).where(and(eq(timeEntries.id, entryId), eq(timeEntries.workspaceId, workspaceId), eq(timeEntries.membershipId, member.id))).limit(1); if (!existing) throw notFound(); if (await isProjectLocked(transaction, workspaceId, member.id, existing.workDate, existing.projectId)) throw new ApiError(409, "entry_locked", "This entry belongs to a submitted or approved project review."); const projectId = input.projectId ?? existing.projectId; const workDate = input.workDate ?? existing.workDate; const changingSlice = projectId !== existing.projectId || workDate !== existing.workDate; if (changingSlice && await projectHasSubmissionHistory(transaction, workspaceId, member.id, existing.workDate, existing.projectId)) throw new ApiError(409, "entry_locked", "Returned entries cannot be moved between projects or weeks. Delete and recreate the entry instead."); if (changingSlice && await isProjectLocked(transaction, workspaceId, member.id, workDate, projectId)) throw new ApiError(409, "entry_locked", "The destination project portion is locked."); const taskId = input.taskId === undefined ? existing.taskId : input.taskId; await validateEntryReferences(transaction, workspaceId, projectId, taskId); const startedAt = input.startedAt === undefined ? existing.startedAt : input.startedAt ? new Date(input.startedAt) : null; const endedAt = input.endedAt === undefined ? existing.endedAt : input.endedAt ? new Date(input.endedAt) : null; const [updated] = await transaction.update(timeEntries).set({ projectId, taskId: taskId ?? null, workDate, durationMinutes: input.durationMinutes ?? existing.durationMinutes, startedAt, endedAt, description: input.description === undefined ? existing.description : input.description, isBillable: input.isBillable ?? existing.isBillable, updatedAt: new Date() }).where(eq(timeEntries.id, entryId)).returning(); return updated; });
  response.json({ entry: publicEntry(entry) });
}));

timesheetRouter.delete("/workspaces/:workspaceId/time-entries/:entryId", asyncHandler(async (request, response) => {
  const workspaceId = paramId(request.params.workspaceId); const member = await requireWorkspaceMembership(response, workspaceId); const entryId = paramId(request.params.entryId);
  await db.transaction(async (transaction) => { await lockMemberEntries(transaction, workspaceId, member.id); const [entry] = await transaction.select().from(timeEntries).where(and(eq(timeEntries.id, entryId), eq(timeEntries.workspaceId, workspaceId), eq(timeEntries.membershipId, member.id))).limit(1); if (!entry) throw notFound(); if (await isProjectLocked(transaction, workspaceId, member.id, entry.workDate, entry.projectId)) throw new ApiError(409, "entry_locked", "This entry belongs to a submitted or approved project review."); await transaction.delete(timeEntries).where(eq(timeEntries.id, entryId)); });
  response.status(204).send();
}));

timesheetRouter.post("/workspaces/:workspaceId/timesheets/:weekStart/submit", asyncHandler(async (request, response) => {
  const workspaceId = paramId(request.params.workspaceId); const weekStart = parse(weekSchema, request.params.weekStart); const userId = Number(response.locals.authUser.id);
  const result = await db.transaction(async (transaction) => {
    await lockWorkspaceGovernance(transaction, workspaceId); const member = await membershipInTransaction(transaction, workspaceId, userId); await lockMemberEntries(transaction, workspaceId, member.id);
    const entries = await transaction.select().from(timeEntries).where(and(eq(timeEntries.workspaceId, workspaceId), eq(timeEntries.membershipId, member.id), gte(timeEntries.workDate, weekStart), lt(timeEntries.workDate, weekEnd(weekStart))));
    const [existingSheet] = await transaction.select().from(weeklyTimesheets).where(and(eq(weeklyTimesheets.workspaceId, workspaceId), eq(weeklyTimesheets.membershipId, member.id), eq(weeklyTimesheets.weekStart, weekStart))).limit(1);
    const items = existingSheet ? await transaction.select().from(timesheetApprovalItems).where(eq(timesheetApprovalItems.weeklyTimesheetId, existingSheet.id)) : [];
    const latest = await latestRevisionRows(transaction, items.map((item) => item.id));
    const returned = items.filter((item) => latest.get(item.id)?.status === "changes_requested");
    if (existingSheet && !returned.length && existingSheet.status !== "draft") throw new ApiError(409, "invalid_timesheet_state", "Only returned project portions can be resubmitted.");
    if ((!existingSheet || existingSheet.status === "draft") && !entries.length) throw new ApiError(400, "empty_timesheet", "A timesheet with no entries cannot be submitted.");
    const totals = new Map<number, number>(); for (const entry of entries) totals.set(entry.projectId, (totals.get(entry.projectId) ?? 0) + entry.durationMinutes);
    const projectIds = existingSheet && returned.length ? returned.map((item) => item.projectId) : [...totals.keys()];
    const routedProjectIds = projectIds.filter((projectId) => totals.has(projectId));
    const projectRows = routedProjectIds.length ? await transaction.select().from(projects).where(and(eq(projects.workspaceId, workspaceId), inArray(projects.id, routedProjectIds))) : [];
    const projectsById = new Map(projectRows.map((project) => [project.id, project]));
    const approverIds = [...new Set(projectRows.flatMap((project) => project.approverMembershipId == null ? [] : [project.approverMembershipId]))];
    const approvers = new Map<number, { id: number; role: "admin" | "manager" | "member" }>();
    if (approverIds.length) for (const approver of await transaction.select({ id: workspaceMemberships.id, role: workspaceMemberships.role }).from(workspaceMemberships).where(and(eq(workspaceMemberships.workspaceId, workspaceId), eq(workspaceMemberships.isActive, true), inArray(workspaceMemberships.id, approverIds)))) approvers.set(approver.id, approver);
    const activeCount = (await transaction.select({ value: sql<number>`count(*)::int` }).from(workspaceMemberships).where(and(eq(workspaceMemberships.workspaceId, workspaceId), eq(workspaceMemberships.isActive, true))))[0]?.value ?? 0;
    const issues: { projectId: string; projectName: string | null; reason: string }[] = [];
    for (const projectId of routedProjectIds) { const project = projectsById.get(projectId); if (!project) issues.push({ projectId: String(projectId), projectName: null, reason: "project_unavailable" }); else if (project.isArchived) issues.push({ projectId: String(project.id), projectName: project.name, reason: "project_archived" }); else if (project.approverMembershipId == null) issues.push({ projectId: String(project.id), projectName: project.name, reason: "missing_approver" }); else { const approver = approvers.get(project.approverMembershipId); if (!approver || approver.role === "member") issues.push({ projectId: String(project.id), projectName: project.name, reason: "ineligible_approver" }); else if (approver.id === member.id && !(member.role === "admin" && activeCount === 1)) issues.push({ projectId: String(project.id), projectName: project.name, reason: "self_approval_not_allowed" }); }
    }
    if (issues.length) throw new ApiError(409, "submission_not_ready", "Every project portion must have an eligible approver.", { projects: issues });
    const sheet = existingSheet ?? (await transaction.insert(weeklyTimesheets).values({ workspaceId, membershipId: member.id, weekStart, status: "draft", submittedAt: new Date() }).returning())[0];
    const taskIds = [...new Set(entries.flatMap((entry) => entry.taskId == null ? [] : [entry.taskId]))]; const taskNames = new Map((taskIds.length ? await transaction.select({ id: tasks.id, name: tasks.name }).from(tasks).where(inArray(tasks.id, taskIds)) : []).map((task) => [task.id, task.name]));
    const revisions: { approvalItemId: string; revisionId: string; revisionNumber: number; projectId: string; status: string }[] = [];
    for (const projectId of projectIds) {
      const project = projectsById.get(projectId); let item = items.find((candidate) => candidate.projectId === projectId); const prior = item ? latest.get(item.id) : undefined;
      if (!item) [item] = await transaction.insert(timesheetApprovalItems).values({ weeklyTimesheetId: sheet.id, projectId }).returning();
      const revisionNumber = (prior?.revisionNumber ?? 0) + 1; const projectEntries = entries.filter((entry) => entry.projectId === projectId); const withdrawn = existingSheet != null && projectEntries.length === 0;
      const snapshottedApproverId = withdrawn && prior ? prior.approverMembershipId : project!.approverMembershipId!; const assignedApproverId = withdrawn && prior ? prior.assignedApproverMembershipId : project!.approverMembershipId!;
      const [revision] = await transaction.insert(timesheetApprovalRevisions).values({ approvalItemId: item.id, revisionNumber, approverMembershipId: snapshottedApproverId, assignedApproverMembershipId: assignedApproverId, projectName: withdrawn && prior ? prior.projectName : project!.name, status: withdrawn ? "withdrawn" : "pending", submittedMinutes: withdrawn ? 0 : totals.get(projectId)!, submittedAt: new Date(), resolvedAt: withdrawn ? new Date() : null, resolvedByMembershipId: withdrawn ? member.id : null }).returning();
      if (!withdrawn && projectEntries.length) await transaction.insert(timesheetReviewEntrySnapshots).values(projectEntries.map((entry) => ({ revisionId: revision.id, sourceEntryId: entry.id, taskId: entry.taskId, taskName: entry.taskId == null ? null : taskNames.get(entry.taskId) ?? null, workDate: entry.workDate, durationMinutes: entry.durationMinutes, startedAt: entry.startedAt, endedAt: entry.endedAt, description: entry.description, isBillable: entry.isBillable })));
      await transaction.insert(timesheetReviewEvents).values({ revisionId: revision.id, actorMembershipId: member.id, type: withdrawn ? "withdrawn" : prior ? "resubmitted" : "submitted" });
      if (!withdrawn) await notify(transaction, { workspaceId, recipientMembershipId: assignedApproverId, type: prior ? "resubmission" : "submission", title: prior ? "Timesheet resubmitted" : "Timesheet ready for review", body: `${revision.projectName} · week of ${weekStart}`, href: `/approvals/${item.id}`, sourceKey: `revision:${revision.id}:${prior ? "resubmitted" : "submitted"}` });
      revisions.push({ approvalItemId: String(item.id), revisionId: String(revision.id), revisionNumber, projectId: String(projectId), status: revision.status });
    }
    return { timesheetId: String(sheet.id), weekStart, status: await updateSheetStatus(transaction, sheet.id), revisions };
  });
  response.json(result);
}));

const approvalItemFor = async (transaction: DbTransaction, workspaceId: number, approvalItemId: number) => {
  const [row] = await transaction.select({ item: timesheetApprovalItems, sheet: weeklyTimesheets }).from(timesheetApprovalItems).innerJoin(weeklyTimesheets, eq(timesheetApprovalItems.weeklyTimesheetId, weeklyTimesheets.id)).where(and(eq(timesheetApprovalItems.id, approvalItemId), eq(weeklyTimesheets.workspaceId, workspaceId))).limit(1); if (!row) throw notFound(); return row;
};
const revisionForWorkspace = async (transaction: DbTransaction, workspaceId: number, revisionId: number) => {
  const [row] = await transaction.select({ revision: timesheetApprovalRevisions, approvalItemId: timesheetApprovalItems.id }).from(timesheetApprovalRevisions).innerJoin(timesheetApprovalItems, eq(timesheetApprovalRevisions.approvalItemId, timesheetApprovalItems.id)).innerJoin(weeklyTimesheets, eq(timesheetApprovalItems.weeklyTimesheetId, weeklyTimesheets.id)).where(and(eq(timesheetApprovalRevisions.id, revisionId), eq(weeklyTimesheets.workspaceId, workspaceId))).limit(1); if (!row) throw notFound(); return row;
};
const publicRevision = (revision: typeof timesheetApprovalRevisions.$inferSelect) => ({ id: String(revision.id), revisionNumber: revision.revisionNumber, status: revision.status, approverMembershipId: String(revision.approverMembershipId), assignedApproverMembershipId: String(revision.assignedApproverMembershipId), projectName: revision.projectName, submittedMinutes: revision.submittedMinutes, submittedAt: revision.submittedAt.toISOString(), resolvedAt: revision.resolvedAt?.toISOString() ?? null, resolvedByMembershipId: revision.resolvedByMembershipId == null ? null : String(revision.resolvedByMembershipId), returnComment: revision.returnComment });
const publicSnapshot = (entry: typeof timesheetReviewEntrySnapshots.$inferSelect) => ({ ...entry, id: String(entry.id), revisionId: String(entry.revisionId), sourceEntryId: String(entry.sourceEntryId), taskId: entry.taskId == null ? null : String(entry.taskId), startedAt: entry.startedAt?.toISOString() ?? null, endedAt: entry.endedAt?.toISOString() ?? null, createdAt: entry.createdAt.toISOString() });
const revisionDiff = (current: (typeof timesheetReviewEntrySnapshots.$inferSelect)[], previous: (typeof timesheetReviewEntrySnapshots.$inferSelect)[]) => {
  const before = new Map(previous.map((entry) => [entry.sourceEntryId, entry])); const after = new Map(current.map((entry) => [entry.sourceEntryId, entry]));
  const fields = ["taskId", "taskName", "workDate", "durationMinutes", "startedAt", "endedAt", "description", "isBillable"] as const;
  const comparable = (value: unknown) => value instanceof Date ? value.toISOString() : value;
  return {
    added: current.filter((entry) => !before.has(entry.sourceEntryId)).map(publicSnapshot),
    removed: previous.filter((entry) => !after.has(entry.sourceEntryId)).map(publicSnapshot),
    changed: current.flatMap((entry) => { const prior = before.get(entry.sourceEntryId); if (!prior || !fields.some((field) => comparable(prior[field]) !== comparable(entry[field]))) return []; return [{ before: publicSnapshot(prior), after: publicSnapshot(entry) }]; }),
  };
};

const approvalSummaries = (workspaceId: number, actor: WorkspaceMembership) => db.transaction(async (transaction) => {
  await transaction.execute(sql`set transaction isolation level repeatable read`);
  const rows = await transaction.select({ item: timesheetApprovalItems, sheet: weeklyTimesheets }).from(timesheetApprovalItems).innerJoin(weeklyTimesheets, eq(timesheetApprovalItems.weeklyTimesheetId, weeklyTimesheets.id)).where(eq(weeklyTimesheets.workspaceId, workspaceId));
  const latest = await latestRevisionRows(transaction, rows.map((row) => row.item.id));
  const identities = await memberIdentities(transaction, workspaceId, rows.flatMap(({ sheet, item }) => { const revision = latest.get(item.id); return revision ? [sheet.membershipId, revision.assignedApproverMembershipId] : [sheet.membershipId]; }));
  return rows.flatMap(({ item, sheet }) => { const revision = latest.get(item.id); if (!revision || (actor.role === "manager" && revision.assignedApproverMembershipId !== actor.id)) return []; return [{ id: String(item.id), revisionId: String(revision.id), revisionNumber: revision.revisionNumber, status: revision.status, submittedMinutes: revision.submittedMinutes, submittedAt: revision.submittedAt.toISOString(), resolvedAt: revision.resolvedAt?.toISOString() ?? null, returnComment: revision.returnComment, project: { id: String(item.projectId), name: revision.projectName }, weekStart: sheet.weekStart, submitter: identities.get(sheet.membershipId) ?? null, assignedApprover: identities.get(revision.assignedApproverMembershipId) ?? null }]; });
});

timesheetRouter.get("/workspaces/:workspaceId/approvals/pending-count", asyncHandler(async (request, response) => {
  const workspaceId = paramId(request.params.workspaceId); const actor = await requireWorkspaceMembership(response, workspaceId); requireManagerOrAdmin(actor); const approvals = await approvalSummaries(workspaceId, actor); response.json({ count: approvals.filter((approval) => approval.status === "pending").length });
}));

timesheetRouter.get("/workspaces/:workspaceId/approvals", asyncHandler(async (request, response) => {
  const workspaceId = paramId(request.params.workspaceId); const actor = await requireWorkspaceMembership(response, workspaceId); requireManagerOrAdmin(actor);
  const approvals = await approvalSummaries(workspaceId, actor);
  const query = parse(z.object({ status: z.enum(["pending", "approved", "changes_requested", "withdrawn"]).optional(), projectId: idSchema.optional(), submitterMembershipId: idSchema.optional(), approverMembershipId: idSchema.optional(), submittedFrom: dateSchema.optional(), submittedTo: dateSchema.optional() }).strict(), request.query);
  const [workspace] = await db.select({ timezone: workspaces.timezone }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1); if (!workspace) throw notFound();
  response.json({ approvals: approvals.filter((approval) => { const submittedDate = dateInZone(approval.submittedAt, workspace.timezone); return (!query.status || approval.status === query.status) && (!query.projectId || approval.project.id === String(query.projectId)) && (!query.submitterMembershipId || approval.submitter?.id === String(query.submitterMembershipId)) && (!query.approverMembershipId || approval.assignedApprover?.id === String(query.approverMembershipId)) && (!query.submittedFrom || submittedDate >= query.submittedFrom) && (!query.submittedTo || submittedDate <= query.submittedTo); }) });
}));

timesheetRouter.get("/workspaces/:workspaceId/approval-items/:approvalItemId", asyncHandler(async (request, response) => {
  const workspaceId = paramId(request.params.workspaceId); const approvalItemId = paramId(request.params.approvalItemId); const actor = await requireWorkspaceMembership(response, workspaceId);
  const result = await db.transaction(async (transaction) => {
    const row = await approvalItemFor(transaction, workspaceId, approvalItemId);
    const revisions = await transaction.select().from(timesheetApprovalRevisions).where(eq(timesheetApprovalRevisions.approvalItemId, approvalItemId)).orderBy(desc(timesheetApprovalRevisions.revisionNumber));
    const latest = revisions[0];
    const isSubmitter = row.sheet.membershipId === actor.id;
    const canReview = actor.role === "admin" || (actor.role === "manager" && latest?.assignedApproverMembershipId === actor.id);
    if (!latest || (!isSubmitter && !canReview)) throw notFound();
    const entries = await transaction.select().from(timesheetReviewEntrySnapshots).where(inArray(timesheetReviewEntrySnapshots.revisionId, revisions.map((revision) => revision.id))).orderBy(asc(timesheetReviewEntrySnapshots.workDate), asc(timesheetReviewEntrySnapshots.createdAt));
    const events = await transaction.select().from(timesheetReviewEvents).where(inArray(timesheetReviewEvents.revisionId, revisions.map((revision) => revision.id))).orderBy(asc(timesheetReviewEvents.createdAt), asc(timesheetReviewEvents.id));
    const identities = await memberIdentities(transaction, workspaceId, [row.sheet.membershipId, ...revisions.flatMap((revision) => [revision.approverMembershipId, revision.assignedApproverMembershipId, ...(revision.resolvedByMembershipId == null ? [] : [revision.resolvedByMembershipId])]), ...events.flatMap((event) => [event.actorMembershipId, event.previousApproverMembershipId, event.nextApproverMembershipId].filter((id): id is number => id != null))]);
    return { row, revisions, entries, events, identities };
  });
  response.json({ approval: {
    id: String(result.row.item.id), weekStart: result.row.sheet.weekStart, submitter: result.identities.get(result.row.sheet.membershipId) ?? null,
    project: { id: String(result.row.item.projectId), name: result.revisions[0].projectName }, latestRevision: publicRevision(result.revisions[0]),
    revisions: result.revisions.map((revision, index) => { const entries = result.entries.filter((entry) => entry.revisionId === revision.id); const previous = result.revisions[index + 1]; const previousEntries = previous ? result.entries.filter((entry) => entry.revisionId === previous.id) : []; return { ...publicRevision(revision), assignedApprover: result.identities.get(revision.assignedApproverMembershipId) ?? null, resolvedBy: revision.resolvedByMembershipId == null ? null : result.identities.get(revision.resolvedByMembershipId) ?? null, entries: entries.map(publicSnapshot), diff: revisionDiff(entries, previousEntries), events: result.events.filter((event) => event.revisionId === revision.id).map((event) => ({ id: String(event.id), revisionId: String(event.revisionId), actor: event.actorMembershipId == null ? null : result.identities.get(event.actorMembershipId) ?? null, type: event.type, comment: event.comment, ...(actor.role === "admin" ? { internalReason: event.internalReason } : {}), previousApprover: event.previousApproverMembershipId == null ? null : result.identities.get(event.previousApproverMembershipId) ?? null, nextApprover: event.nextApproverMembershipId == null ? null : result.identities.get(event.nextApproverMembershipId) ?? null, createdAt: event.createdAt.toISOString() })) }; }),
  } });
}));

const decideRevision = (path: "/approve" | "/request-changes", status: "approved" | "changes_requested") => timesheetRouter.post(`/workspaces/:workspaceId/approval-items/:approvalItemId/revisions/:revisionId${path}`, asyncHandler(async (request, response) => {
  const workspaceId = paramId(request.params.workspaceId); const approvalItemId = paramId(request.params.approvalItemId); const revisionId = paramId(request.params.revisionId); const userId = Number(response.locals.authUser.id); const comment = status === "changes_requested" ? parse(z.object({ comment: z.string().trim().min(1).max(2_000) }).strict(), request.body).comment : undefined;
  const result = await db.transaction(async (transaction) => {
    await lockWorkspaceGovernance(transaction, workspaceId); const actor = await membershipInTransaction(transaction, workspaceId, userId); requireManagerOrAdmin(actor); const item = await approvalItemFor(transaction, workspaceId, approvalItemId); await lockMemberEntries(transaction, workspaceId, item.sheet.membershipId); const revisionRow = await revisionForWorkspace(transaction, workspaceId, revisionId); if (revisionRow.approvalItemId !== approvalItemId) throw new ApiError(409, "invalid_review_state", "The revision does not belong to this approval item."); const revision = revisionRow.revision; requireAssignedApprover(actor, revision.assignedApproverMembershipId); const latest = (await latestRevisionRows(transaction, [approvalItemId])).get(approvalItemId); if (!latest || latest.id !== revision.id || revision.status !== "pending") throw new ApiError(409, "invalid_review_state", "Only the latest pending revision can be resolved."); await assertSelfReviewAllowed(transaction, workspaceId, item.sheet.membershipId, actor); const [changed] = await transaction.update(timesheetApprovalRevisions).set({ status, resolvedAt: new Date(), resolvedByMembershipId: actor.id, returnComment: comment ?? null, updatedAt: new Date() }).where(and(eq(timesheetApprovalRevisions.id, revision.id), eq(timesheetApprovalRevisions.status, "pending"))).returning({ id: timesheetApprovalRevisions.id }); if (!changed) throw new ApiError(409, "invalid_review_state", "This revision was already resolved."); await transaction.insert(timesheetReviewEvents).values({ revisionId: revision.id, actorMembershipId: actor.id, type: status, ...(comment ? { comment } : {}) }); await notify(transaction, { workspaceId, recipientMembershipId: item.sheet.membershipId, type: status, title: status === "approved" ? "Timesheet approved" : "Changes requested", body: `${revision.projectName} · week of ${item.sheet.weekStart}`, href: `/time-entries?week=${item.sheet.weekStart}`, sourceKey: `revision:${revision.id}:${status}` }); return { id: String(revision.id), approvalItemId: String(approvalItemId), status, timesheetStatus: await updateSheetStatus(transaction, item.sheet.id) };
  });
  response.json(result);
}));

decideRevision("/approve", "approved");
decideRevision("/request-changes", "changes_requested");

const adminActionSchema = z.object({ reason: z.string().trim().min(1).max(2_000) }).strict();
const transferSchema = adminActionSchema.extend({ approverMembershipId: idSchema }).strict();

timesheetRouter.post("/workspaces/:workspaceId/approval-items/:approvalItemId/revisions/:revisionId/transfer", asyncHandler(async (request, response) => {
  const workspaceId = paramId(request.params.workspaceId); const approvalItemId = paramId(request.params.approvalItemId); const revisionId = paramId(request.params.revisionId); const userId = Number(response.locals.authUser.id); const input = parse(transferSchema, request.body);
  const result = await db.transaction(async (transaction) => {
    await lockWorkspaceGovernance(transaction, workspaceId); const actor = await membershipInTransaction(transaction, workspaceId, userId); requireAdmin(actor); const item = await approvalItemFor(transaction, workspaceId, approvalItemId); await lockMemberEntries(transaction, workspaceId, item.sheet.membershipId);
    const revisionRow = await revisionForWorkspace(transaction, workspaceId, revisionId); if (revisionRow.approvalItemId !== approvalItemId) throw new ApiError(409, "invalid_review_state", "The revision does not belong to this approval item."); const revision = revisionRow.revision; const latest = (await latestRevisionRows(transaction, [approvalItemId])).get(approvalItemId); if (!latest || latest.id !== revision.id || revision.status !== "pending") throw new ApiError(409, "invalid_review_state", "Only the latest pending revision can be transferred.");
    const nextApprover = await eligibleApprover(transaction, workspaceId, input.approverMembershipId); if (!nextApprover) throw new ApiError(400, "invalid_approver", "Approver must be an active manager or admin in this workspace."); if (nextApprover.id === revision.assignedApproverMembershipId) throw new ApiError(409, "invalid_review_state", "This revision is already assigned to that approver."); await assertSelfReviewAllowed(transaction, workspaceId, item.sheet.membershipId, nextApprover as WorkspaceMembership);
    const [changed] = await transaction.update(timesheetApprovalRevisions).set({ assignedApproverMembershipId: nextApprover.id, updatedAt: new Date() }).where(and(eq(timesheetApprovalRevisions.id, revision.id), eq(timesheetApprovalRevisions.status, "pending"), eq(timesheetApprovalRevisions.assignedApproverMembershipId, revision.assignedApproverMembershipId))).returning({ id: timesheetApprovalRevisions.id }); if (!changed) throw new ApiError(409, "invalid_review_state", "This revision changed before it could be transferred.");
    const [transferEvent] = await transaction.insert(timesheetReviewEvents).values({ revisionId: revision.id, actorMembershipId: actor.id, type: "transferred", internalReason: input.reason, previousApproverMembershipId: revision.assignedApproverMembershipId, nextApproverMembershipId: nextApprover.id }).returning({ id: timesheetReviewEvents.id });
    await audit(transaction, { workspaceId, actorMembershipId: actor.id, type: "approval_transferred", targetMembershipId: nextApprover.id, targetProjectId: item.item.projectId, details: { approvalItemId: String(approvalItemId), revisionId: String(revision.id), previousApproverMembershipId: String(revision.assignedApproverMembershipId), reason: input.reason } });
    await notify(transaction, { workspaceId, recipientMembershipId: nextApprover.id, type: "transfer", title: "Approval transferred to you", body: `${revision.projectName} · week of ${item.sheet.weekStart}`, href: `/approvals/${approvalItemId}`, sourceKey: `review-event:${transferEvent.id}` });
    return { approvalItemId: String(approvalItemId), revisionId: String(revision.id), status: "pending", approverMembershipId: String(nextApprover.id) };
  });
  response.json(result);
}));

timesheetRouter.post("/workspaces/:workspaceId/approval-items/:approvalItemId/revisions/:revisionId/approve-as-admin", asyncHandler(async (request, response) => {
  const workspaceId = paramId(request.params.workspaceId); const approvalItemId = paramId(request.params.approvalItemId); const revisionId = paramId(request.params.revisionId); const userId = Number(response.locals.authUser.id); const input = parse(adminActionSchema, request.body);
  const result = await db.transaction(async (transaction) => {
    await lockWorkspaceGovernance(transaction, workspaceId); const actor = await membershipInTransaction(transaction, workspaceId, userId); requireAdmin(actor); const item = await approvalItemFor(transaction, workspaceId, approvalItemId); await lockMemberEntries(transaction, workspaceId, item.sheet.membershipId);
    const revisionRow = await revisionForWorkspace(transaction, workspaceId, revisionId); if (revisionRow.approvalItemId !== approvalItemId) throw new ApiError(409, "invalid_review_state", "The revision does not belong to this approval item."); const revision = revisionRow.revision; const latest = (await latestRevisionRows(transaction, [approvalItemId])).get(approvalItemId); if (!latest || latest.id !== revision.id || revision.status !== "pending") throw new ApiError(409, "invalid_review_state", "Only the latest pending revision can be approved."); if (revision.assignedApproverMembershipId === actor.id) throw new ApiError(409, "invalid_review_state", "Use the normal approval action for a revision assigned to you."); await assertSelfReviewAllowed(transaction, workspaceId, item.sheet.membershipId, actor);
    const [changed] = await transaction.update(timesheetApprovalRevisions).set({ status: "approved", resolvedAt: new Date(), resolvedByMembershipId: actor.id, updatedAt: new Date() }).where(and(eq(timesheetApprovalRevisions.id, revision.id), eq(timesheetApprovalRevisions.status, "pending"))).returning({ id: timesheetApprovalRevisions.id }); if (!changed) throw new ApiError(409, "invalid_review_state", "This revision was already resolved."); await transaction.insert(timesheetReviewEvents).values({ revisionId: revision.id, actorMembershipId: actor.id, type: "admin_override", internalReason: input.reason, previousApproverMembershipId: revision.assignedApproverMembershipId });
    await audit(transaction, { workspaceId, actorMembershipId: actor.id, type: "approval_admin_override", targetMembershipId: item.sheet.membershipId, targetProjectId: item.item.projectId, details: { approvalItemId: String(approvalItemId), revisionId: String(revision.id), assignedApproverMembershipId: String(revision.assignedApproverMembershipId), reason: input.reason } });
    await notify(transaction, { workspaceId, recipientMembershipId: item.sheet.membershipId, type: "approved", title: "Timesheet approved by an Admin", body: `${revision.projectName} · week of ${item.sheet.weekStart}`, href: `/time-entries?week=${item.sheet.weekStart}`, sourceKey: `revision:${revision.id}:admin_override` });
    return { approvalItemId: String(approvalItemId), revisionId: String(revision.id), status: "approved", timesheetStatus: await updateSheetStatus(transaction, item.sheet.id) };
  });
  response.json(result);
}));
