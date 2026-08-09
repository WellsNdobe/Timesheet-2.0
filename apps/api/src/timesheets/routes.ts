import { and, asc, desc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../auth/middleware.js";
import { db } from "../db/client.js";
import {
  projects,
  tasks,
  timeEntries,
  timesheetReviewEntrySnapshots,
  timesheetProjectReviews,
  timesheetReviewEvents,
  weeklyTimesheets,
  workspaceMemberships,
  workspaces,
} from "../db/schema.js";
import { ApiError, asyncHandler } from "../errors.js";

const idSchema = z.coerce.number().int().positive();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "A real calendar date is required.");
const weekSchema = dateSchema.refine((value) => new Date(`${value}T00:00:00.000Z`).getUTCDay() === 1, "weekStart must be a Monday.");
const projectSchema = z.object({ name: z.string().trim().min(1).max(160), approverMembershipId: idSchema.nullable().optional() }).strict();
const taskSchema = z.object({ name: z.string().trim().min(1).max(160) }).strict();
const entrySchema = z.object({
  projectId: idSchema,
  taskId: idSchema.nullable().optional(),
  workDate: dateSchema,
  durationMinutes: z.number().int().positive().max(24 * 60),
  startedAt: z.string().datetime({ offset: true }).nullable().optional(),
  endedAt: z.string().datetime({ offset: true }).nullable().optional(),
  description: z.string().trim().max(2_000).nullable().optional(),
  isBillable: z.boolean().optional(),
}).strict().superRefine((value, context) => {
  if ((value.startedAt == null) !== (value.endedAt == null)) context.addIssue({ code: "custom", message: "startedAt and endedAt must be supplied together." });
  if (value.startedAt && value.endedAt && new Date(value.endedAt).getTime() <= new Date(value.startedAt).getTime()) context.addIssue({ code: "custom", message: "endedAt must be after startedAt." });
});
const reviewDecisionSchema = z.object({ comment: z.string().trim().min(1).max(2_000).optional() }).strict();

type Membership = { id: number; workspaceId: number; userId: number; role: "admin" | "manager" | "member"; isActive: boolean };

const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(400, "validation_error", result.error.issues[0]?.message ?? "Invalid request.");
  return result.data;
};
const paramId = (value: string | undefined) => parse(idSchema, value);
const notFound = () => new ApiError(404, "not_found", "The requested resource was not found.");
const forbidden = () => new ApiError(403, "forbidden", "You do not have permission to perform this action.");
const actorId = (response: Parameters<Parameters<typeof asyncHandler>[0]>[1]) => Number(response.locals.authUser.id);

const membershipFor = async (workspaceId: number, userId: number): Promise<Membership> => {
  const [membership] = await db.select({ id: workspaceMemberships.id, workspaceId: workspaceMemberships.workspaceId, userId: workspaceMemberships.userId, role: workspaceMemberships.role, isActive: workspaceMemberships.isActive })
    .from(workspaceMemberships).where(and(eq(workspaceMemberships.workspaceId, workspaceId), eq(workspaceMemberships.userId, userId), eq(workspaceMemberships.isActive, true))).limit(1);
  if (!membership) throw notFound();
  return membership;
};
const requireManager = (membership: Membership) => {
  if (membership.role === "member") throw forbidden();
};
const requireWorkspace = async (workspaceId: number) => {
  const [workspace] = await db.select({ id: workspaces.id, timezone: workspaces.timezone }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!workspace) throw notFound();
  return workspace;
};
const weekEnd = (weekStart: string) => {
  const date = new Date(`${weekStart}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 7);
  return date.toISOString().slice(0, 10);
};
const publicEntry = (entry: typeof timeEntries.$inferSelect) => ({ ...entry, id: String(entry.id), workspaceId: String(entry.workspaceId), membershipId: String(entry.membershipId), projectId: String(entry.projectId), taskId: entry.taskId == null ? null : String(entry.taskId), startedAt: entry.startedAt?.toISOString() ?? null, endedAt: entry.endedAt?.toISOString() ?? null, createdAt: entry.createdAt.toISOString(), updatedAt: entry.updatedAt.toISOString() });

const validateEntryReferences = async (workspaceId: number, projectId: number, taskId: number | null | undefined, allowArchived = false) => {
  const [project] = await db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId))).limit(1);
  if (!project || (!allowArchived && project.isArchived)) throw new ApiError(400, "invalid_project", "The selected project is not available.");
  if (taskId != null) {
    const [task] = await db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId))).limit(1);
    if (!task || (!allowArchived && task.isArchived)) throw new ApiError(400, "invalid_task", "The selected task is not available for this project.");
  }
  return project;
};
const isProjectLocked = async (workspaceId: number, membershipId: number, workDate: string, projectId: number) => {
  const monday = new Date(`${workDate}T00:00:00.000Z`);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const weekStart = monday.toISOString().slice(0, 10);
  const [sheet] = await db.select({ id: weeklyTimesheets.id }).from(weeklyTimesheets)
    .where(and(eq(weeklyTimesheets.workspaceId, workspaceId), eq(weeklyTimesheets.membershipId, membershipId), eq(weeklyTimesheets.weekStart, weekStart))).limit(1);
  if (!sheet) return false;
  const [review] = await db.select({ status: timesheetProjectReviews.status }).from(timesheetProjectReviews)
    .where(and(eq(timesheetProjectReviews.weeklyTimesheetId, sheet.id), eq(timesheetProjectReviews.projectId, projectId))).limit(1);
  return review?.status !== "changes_requested";
};
const assertMutable = async (entry: typeof timeEntries.$inferSelect) => {
  if (await isProjectLocked(entry.workspaceId, entry.membershipId, entry.workDate, entry.projectId)) throw new ApiError(409, "entry_locked", "This entry belongs to a submitted or approved project review.");
};

export const timesheetRouter = Router();
timesheetRouter.use(authenticate);

timesheetRouter.get("/workspaces/:workspaceId/projects", asyncHandler(async (request, response) => {
  const workspaceId = paramId(request.params.workspaceId); await membershipFor(workspaceId, actorId(response));
  const includeArchived = request.query.includeArchived === "true";
  const rows = await db.select().from(projects).where(and(eq(projects.workspaceId, workspaceId), ...(includeArchived ? [] : [eq(projects.isArchived, false)]) )).orderBy(asc(projects.name));
  response.json({ projects: rows.map((row) => ({ ...row, id: String(row.id), workspaceId: String(row.workspaceId), approverMembershipId: row.approverMembershipId == null ? null : String(row.approverMembershipId), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() })) });
}));

timesheetRouter.post("/workspaces/:workspaceId/projects", asyncHandler(async (request, response) => {
  const workspaceId = paramId(request.params.workspaceId); const member = await membershipFor(workspaceId, actorId(response)); requireManager(member);
  const input = parse(projectSchema, request.body);
  if (input.approverMembershipId != null) {
    const [approver] = await db.select().from(workspaceMemberships).where(and(eq(workspaceMemberships.id, input.approverMembershipId), eq(workspaceMemberships.workspaceId, workspaceId), eq(workspaceMemberships.isActive, true), ne(workspaceMemberships.role, "member"))).limit(1);
    if (!approver) throw new ApiError(400, "invalid_approver", "Approver must be an active manager or admin in this workspace.");
  }
  const [project] = await db.insert(projects).values({ workspaceId, name: input.name, approverMembershipId: input.approverMembershipId ?? null }).returning();
  response.status(201).json({ project: { ...project, id: String(project.id), workspaceId: String(project.workspaceId), approverMembershipId: project.approverMembershipId == null ? null : String(project.approverMembershipId), createdAt: project.createdAt.toISOString(), updatedAt: project.updatedAt.toISOString() } });
}));

timesheetRouter.patch("/workspaces/:workspaceId/projects/:projectId", asyncHandler(async (request, response) => {
  const workspaceId = paramId(request.params.workspaceId); const member = await membershipFor(workspaceId, actorId(response)); requireManager(member);
  const projectId = paramId(request.params.projectId); const input = parse(projectSchema.partial().extend({ isArchived: z.boolean().optional() }).strict(), request.body);
  if (input.approverMembershipId !== undefined && input.approverMembershipId != null) {
    const [approver] = await db.select({ id: workspaceMemberships.id }).from(workspaceMemberships).where(and(eq(workspaceMemberships.id, input.approverMembershipId), eq(workspaceMemberships.workspaceId, workspaceId), eq(workspaceMemberships.isActive, true), ne(workspaceMemberships.role, "member"))).limit(1);
    if (!approver) throw new ApiError(400, "invalid_approver", "Approver must be an active manager or admin in this workspace.");
  }
  const [project] = await db.update(projects).set({ ...input, updatedAt: new Date() }).where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId))).returning(); if (!project) throw notFound();
  response.json({ project: { ...project, id: String(project.id), workspaceId: String(project.workspaceId), approverMembershipId: project.approverMembershipId == null ? null : String(project.approverMembershipId), createdAt: project.createdAt.toISOString(), updatedAt: project.updatedAt.toISOString() } });
}));

timesheetRouter.get("/workspaces/:workspaceId/projects/:projectId/tasks", asyncHandler(async (request, response) => {
  const workspaceId = paramId(request.params.workspaceId); await membershipFor(workspaceId, actorId(response)); const projectId = paramId(request.params.projectId);
  await validateEntryReferences(workspaceId, projectId, undefined, true);
  const includeArchived = request.query.includeArchived === "true";
  const rows = await db.select().from(tasks).where(and(eq(tasks.projectId, projectId), ...(includeArchived ? [] : [eq(tasks.isArchived, false)]) )).orderBy(asc(tasks.name));
  response.json({ tasks: rows.map((row) => ({ ...row, id: String(row.id), projectId: String(row.projectId), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() })) });
}));

timesheetRouter.post("/workspaces/:workspaceId/projects/:projectId/tasks", asyncHandler(async (request, response) => {
  const workspaceId = paramId(request.params.workspaceId); const member = await membershipFor(workspaceId, actorId(response)); requireManager(member); const projectId = paramId(request.params.projectId); await validateEntryReferences(workspaceId, projectId);
  const input = parse(taskSchema, request.body); const [task] = await db.insert(tasks).values({ projectId, name: input.name }).returning();
  response.status(201).json({ task: { ...task, id: String(task.id), projectId: String(task.projectId), createdAt: task.createdAt.toISOString(), updatedAt: task.updatedAt.toISOString() } });
}));

timesheetRouter.patch("/workspaces/:workspaceId/projects/:projectId/tasks/:taskId", asyncHandler(async (request, response) => {
  const workspaceId = paramId(request.params.workspaceId); const member = await membershipFor(workspaceId, actorId(response)); requireManager(member); const projectId = paramId(request.params.projectId); const taskId = paramId(request.params.taskId); const input = parse(taskSchema.partial().extend({ isArchived: z.boolean().optional() }).strict(), request.body);
  await validateEntryReferences(workspaceId, projectId, undefined, true); const [task] = await db.update(tasks).set({ ...input, updatedAt: new Date() }).where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId))).returning(); if (!task) throw notFound();
  response.json({ task: { ...task, id: String(task.id), projectId: String(task.projectId), createdAt: task.createdAt.toISOString(), updatedAt: task.updatedAt.toISOString() } });
}));

timesheetRouter.get("/workspaces/:workspaceId/time-entries", asyncHandler(async (request, response) => {
  const workspaceId = paramId(request.params.workspaceId); const member = await membershipFor(workspaceId, actorId(response)); const workspace = await requireWorkspace(workspaceId); const weekStart = parse(weekSchema, request.query.weekStart); const end = weekEnd(weekStart);
  const entries = await db.select().from(timeEntries).where(and(eq(timeEntries.workspaceId, workspaceId), eq(timeEntries.membershipId, member.id), gte(timeEntries.workDate, weekStart), lt(timeEntries.workDate, end))).orderBy(asc(timeEntries.workDate), asc(timeEntries.createdAt));
  const dailyTotals = entries.reduce<Record<string, number>>((totals, entry) => { totals[entry.workDate] = (totals[entry.workDate] ?? 0) + entry.durationMinutes; return totals; }, {});
  const billableMinutes = entries.filter((entry) => entry.isBillable).reduce((total, entry) => total + entry.durationMinutes, 0);
  const [sheet] = await db.select().from(weeklyTimesheets).where(and(eq(weeklyTimesheets.workspaceId, workspaceId), eq(weeklyTimesheets.membershipId, member.id), eq(weeklyTimesheets.weekStart, weekStart))).limit(1);
  response.json({ weekStart, timezone: workspace.timezone, entries: entries.map(publicEntry), dailyTotals, totalMinutes: entries.reduce((total, entry) => total + entry.durationMinutes, 0), billableMinutes, status: sheet?.status ?? "draft" });
}));

timesheetRouter.post("/workspaces/:workspaceId/time-entries", asyncHandler(async (request, response) => {
  const workspaceId = paramId(request.params.workspaceId); const member = await membershipFor(workspaceId, actorId(response)); const input = parse(entrySchema, request.body);
  const entry = await db.transaction(async (transaction) => {
    await lockMemberEntries(transaction, workspaceId, member.id);
    await validateEntryReferences(workspaceId, input.projectId, input.taskId);
    if (await isProjectLocked(workspaceId, member.id, input.workDate, input.projectId)) throw new ApiError(409, "entry_locked", "This project is awaiting review or already approved for that week.");
    const [created] = await transaction.insert(timeEntries).values({ workspaceId, membershipId: member.id, projectId: input.projectId, taskId: input.taskId ?? null, workDate: input.workDate, durationMinutes: input.durationMinutes, startedAt: input.startedAt ? new Date(input.startedAt) : null, endedAt: input.endedAt ? new Date(input.endedAt) : null, description: input.description ?? null, isBillable: input.isBillable ?? true }).returning();
    return created;
  });
  response.status(201).json({ entry: publicEntry(entry) });
}));

timesheetRouter.patch("/workspaces/:workspaceId/time-entries/:entryId", asyncHandler(async (request, response) => {
  const workspaceId = paramId(request.params.workspaceId); const member = await membershipFor(workspaceId, actorId(response)); const entryId = paramId(request.params.entryId); const input = parse(entrySchema.partial(), request.body);
  const entry = await db.transaction(async (transaction) => {
    await lockMemberEntries(transaction, workspaceId, member.id);
    const [existing] = await transaction.select().from(timeEntries).where(and(eq(timeEntries.id, entryId), eq(timeEntries.workspaceId, workspaceId), eq(timeEntries.membershipId, member.id))).limit(1); if (!existing) throw notFound(); await assertMutable(existing);
    const nextProjectId = input.projectId ?? existing.projectId; const nextTaskId = input.taskId === undefined ? existing.taskId : input.taskId; const nextDate = input.workDate ?? existing.workDate;
    if ((input.projectId != null && input.projectId !== existing.projectId) || (input.workDate != null && input.workDate !== existing.workDate)) throw new ApiError(409, "entry_locked", "Submitted entries cannot be moved between projects or weeks.");
    await validateEntryReferences(workspaceId, nextProjectId, nextTaskId);
    const start = input.startedAt === undefined ? existing.startedAt : input.startedAt ? new Date(input.startedAt) : null; const end = input.endedAt === undefined ? existing.endedAt : input.endedAt ? new Date(input.endedAt) : null;
    if ((start == null) !== (end == null) || (start && end && end.getTime() <= start.getTime())) throw new ApiError(400, "validation_error", "startedAt and endedAt must be paired, with endedAt after startedAt.");
    const durationMinutes = input.durationMinutes ?? existing.durationMinutes;
    const [updated] = await transaction.update(timeEntries).set({ projectId: nextProjectId, taskId: nextTaskId ?? null, workDate: nextDate, durationMinutes, startedAt: start, endedAt: end, description: input.description === undefined ? existing.description : input.description, isBillable: input.isBillable ?? existing.isBillable, updatedAt: new Date() }).where(eq(timeEntries.id, entryId)).returning();
    return updated;
  });
  response.json({ entry: publicEntry(entry) });
}));

timesheetRouter.delete("/workspaces/:workspaceId/time-entries/:entryId", asyncHandler(async (request, response) => {
  const workspaceId = paramId(request.params.workspaceId); const member = await membershipFor(workspaceId, actorId(response)); const entryId = paramId(request.params.entryId);
  await db.transaction(async (transaction) => {
    await lockMemberEntries(transaction, workspaceId, member.id);
    const [entry] = await transaction.select().from(timeEntries).where(and(eq(timeEntries.id, entryId), eq(timeEntries.workspaceId, workspaceId), eq(timeEntries.membershipId, member.id))).limit(1); if (!entry) throw notFound(); await assertMutable(entry); await transaction.delete(timeEntries).where(eq(timeEntries.id, entryId));
  });
  response.status(204).send();
}));

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const lockMemberEntries = (transaction: DbTransaction, workspaceId: number, membershipId: number) => transaction.execute(sql`select pg_advisory_xact_lock(${workspaceId}, ${membershipId})`);
const updateSheetStatus = async (transaction: DbTransaction, sheetId: number) => {
  const reviews = await transaction.select({ status: timesheetProjectReviews.status }).from(timesheetProjectReviews).where(eq(timesheetProjectReviews.weeklyTimesheetId, sheetId));
  const status = reviews.some((review) => review.status === "changes_requested") ? "changes_requested" : reviews.length > 0 && reviews.every((review) => review.status === "approved") ? "approved" : "submitted";
  await transaction.update(weeklyTimesheets).set({ status, lastResolvedAt: status === "approved" ? new Date() : null, updatedAt: new Date() }).where(eq(weeklyTimesheets.id, sheetId));
  return status;
};

const assertSelfReviewAllowed = async (transaction: DbTransaction, workspaceId: number, submitterMembershipId: number, reviewerMembershipId: number, reviewerRole: Membership["role"]) => {
  if (submitterMembershipId !== reviewerMembershipId) return;
  if (reviewerRole !== "admin") throw new ApiError(403, "self_review_not_allowed", "Only a sole workspace admin may review their own week.");
  const activeMembers = await transaction.select({ count: sql<number>`count(*)::int` }).from(workspaceMemberships)
    .where(and(eq(workspaceMemberships.workspaceId, workspaceId), eq(workspaceMemberships.isActive, true)));
  if ((activeMembers[0]?.count ?? 0) > 1) throw new ApiError(403, "self_review_not_allowed", "Self-review is only allowed in a one-member workspace.");
};

timesheetRouter.post("/workspaces/:workspaceId/timesheets/:weekStart/submit", asyncHandler(async (request, response) => {
  const workspaceId = paramId(request.params.workspaceId); const member = await membershipFor(workspaceId, actorId(response)); const weekStart = parse(weekSchema, request.params.weekStart); const end = weekEnd(weekStart);
  await db.transaction(async (transaction) => {
    await lockMemberEntries(transaction, workspaceId, member.id);
    const entries = await transaction.select().from(timeEntries).where(and(eq(timeEntries.workspaceId, workspaceId), eq(timeEntries.membershipId, member.id), gte(timeEntries.workDate, weekStart), lt(timeEntries.workDate, end)));
    if (!entries.length) throw new ApiError(400, "empty_timesheet", "A timesheet with no entries cannot be submitted.");
    const projectTotals = new Map<number, number>(); for (const entry of entries) projectTotals.set(entry.projectId, (projectTotals.get(entry.projectId) ?? 0) + entry.durationMinutes);
    const projectIds = [...projectTotals.keys()]; const projectRows = await transaction.select().from(projects).where(and(eq(projects.workspaceId, workspaceId), inArray(projects.id, projectIds)));
    const taskIds = [...new Set(entries.flatMap((entry) => entry.taskId == null ? [] : [entry.taskId]))];
    const taskRows = taskIds.length ? await transaction.select({ id: tasks.id, name: tasks.name }).from(tasks).where(inArray(tasks.id, taskIds)) : [];
    const taskNames = new Map(taskRows.map((task) => [task.id, task.name]));
    if (projectRows.length !== projectIds.length || projectRows.some((project) => project.isArchived || project.approverMembershipId == null)) throw new ApiError(400, "submission_not_ready", "Every project in the week must be active and have an approver.");
    const approverIds = projectRows.map((project) => project.approverMembershipId!); const validApprovers = await transaction.select({ id: workspaceMemberships.id, role: workspaceMemberships.role }).from(workspaceMemberships).where(and(eq(workspaceMemberships.workspaceId, workspaceId), eq(workspaceMemberships.isActive, true), inArray(workspaceMemberships.id, approverIds)));
    if (validApprovers.length !== approverIds.length || validApprovers.some((approver) => approver.role === "member")) throw new ApiError(400, "submission_not_ready", "Every project approver must be an active manager or admin.");
    const [sheet] = await transaction.insert(weeklyTimesheets).values({ workspaceId, membershipId: member.id, weekStart, status: "submitted", submittedAt: new Date() }).onConflictDoUpdate({ target: [weeklyTimesheets.workspaceId, weeklyTimesheets.membershipId, weeklyTimesheets.weekStart], set: { submittedAt: new Date(), updatedAt: new Date() } }).returning();
    const priorReviews = await transaction.select().from(timesheetProjectReviews).where(eq(timesheetProjectReviews.weeklyTimesheetId, sheet.id));
    for (const project of projectRows) {
      const prior = priorReviews.find((review) => review.projectId === project.id);
      if (prior && prior.status !== "changes_requested") continue;
      const values = { weeklyTimesheetId: sheet.id, projectId: project.id, approverMembershipId: project.approverMembershipId!, projectName: project.name, status: "pending" as const, submittedMinutes: projectTotals.get(project.id)!, submittedAt: new Date(), resolvedAt: null, resolvedByMembershipId: null, returnComment: null, updatedAt: new Date() };
      const [review] = prior ? await transaction.update(timesheetProjectReviews).set(values).where(eq(timesheetProjectReviews.id, prior.id)).returning() : await transaction.insert(timesheetProjectReviews).values(values).returning();
      await transaction.delete(timesheetReviewEntrySnapshots).where(eq(timesheetReviewEntrySnapshots.reviewId, review.id));
      const projectEntries = entries.filter((entry) => entry.projectId === project.id);
      await transaction.insert(timesheetReviewEntrySnapshots).values(projectEntries.map((entry) => ({ reviewId: review.id, sourceEntryId: entry.id, taskId: entry.taskId, taskName: entry.taskId == null ? null : taskNames.get(entry.taskId) ?? null, workDate: entry.workDate, durationMinutes: entry.durationMinutes, startedAt: entry.startedAt, endedAt: entry.endedAt, description: entry.description, isBillable: entry.isBillable })));
      await transaction.insert(timesheetReviewEvents).values({ reviewId: review.id, actorMembershipId: member.id, type: "submitted" });
    }
    const status = await updateSheetStatus(transaction, sheet.id); response.json({ timesheetId: String(sheet.id), weekStart, status });
  });
}));

timesheetRouter.get("/workspaces/:workspaceId/approvals", asyncHandler(async (request, response) => {
  const workspaceId = paramId(request.params.workspaceId); const member = await membershipFor(workspaceId, actorId(response)); requireManager(member);
  const rows = await db.select({ review: timesheetProjectReviews, sheet: weeklyTimesheets, project: projects }).from(timesheetProjectReviews).innerJoin(weeklyTimesheets, eq(timesheetProjectReviews.weeklyTimesheetId, weeklyTimesheets.id)).innerJoin(projects, eq(timesheetProjectReviews.projectId, projects.id)).where(and(eq(weeklyTimesheets.workspaceId, workspaceId), member.role === "admin" ? sql`true` : eq(timesheetProjectReviews.approverMembershipId, member.id))).orderBy(desc(timesheetProjectReviews.submittedAt));
  response.json({ approvals: rows.map(({ review, sheet, project }) => ({ id: String(review.id), status: review.status, submittedMinutes: review.submittedMinutes, submittedAt: review.submittedAt.toISOString(), resolvedAt: review.resolvedAt?.toISOString() ?? null, returnComment: review.returnComment, project: { id: String(project.id), name: review.projectName }, weekStart: sheet.weekStart, submitterMembershipId: String(sheet.membershipId) })) });
}));

timesheetRouter.get("/workspaces/:workspaceId/approval-items/:reviewId", asyncHandler(async (request, response) => {
  const workspaceId = paramId(request.params.workspaceId); const actor = await membershipFor(workspaceId, actorId(response)); requireManager(actor); const reviewId = paramId(request.params.reviewId);
  const [row] = await db.select({ review: timesheetProjectReviews, sheet: weeklyTimesheets, project: projects }).from(timesheetProjectReviews).innerJoin(weeklyTimesheets, eq(timesheetProjectReviews.weeklyTimesheetId, weeklyTimesheets.id)).innerJoin(projects, eq(timesheetProjectReviews.projectId, projects.id)).where(and(eq(timesheetProjectReviews.id, reviewId), eq(weeklyTimesheets.workspaceId, workspaceId), actor.role === "admin" ? sql`true` : eq(timesheetProjectReviews.approverMembershipId, actor.id))).limit(1);
  if (!row) throw notFound();
  const entries = await db.select().from(timesheetReviewEntrySnapshots).where(eq(timesheetReviewEntrySnapshots.reviewId, reviewId)).orderBy(asc(timesheetReviewEntrySnapshots.workDate), asc(timesheetReviewEntrySnapshots.createdAt));
  const events = await db.select().from(timesheetReviewEvents).where(eq(timesheetReviewEvents.reviewId, reviewId)).orderBy(asc(timesheetReviewEvents.createdAt));
  response.json({ approval: { id: String(row.review.id), status: row.review.status, submittedMinutes: row.review.submittedMinutes, submittedAt: row.review.submittedAt.toISOString(), resolvedAt: row.review.resolvedAt?.toISOString() ?? null, returnComment: row.review.returnComment, weekStart: row.sheet.weekStart, submitterMembershipId: String(row.sheet.membershipId), project: { id: String(row.project.id), name: row.review.projectName }, entries: entries.map((entry) => ({ id: String(entry.id), sourceEntryId: String(entry.sourceEntryId), taskId: entry.taskId == null ? null : String(entry.taskId), taskName: entry.taskName, workDate: entry.workDate, durationMinutes: entry.durationMinutes, startedAt: entry.startedAt?.toISOString() ?? null, endedAt: entry.endedAt?.toISOString() ?? null, description: entry.description, isBillable: entry.isBillable })), events: events.map((event) => ({ ...event, id: String(event.id), reviewId: String(event.reviewId), actorMembershipId: event.actorMembershipId == null ? null : String(event.actorMembershipId), createdAt: event.createdAt.toISOString() })) } });
}));

timesheetRouter.post("/workspaces/:workspaceId/approval-items/:reviewId/approve", asyncHandler(async (request, response) => {
  const workspaceId = paramId(request.params.workspaceId); const actor = await membershipFor(workspaceId, actorId(response)); requireManager(actor); const reviewId = paramId(request.params.reviewId); parse(reviewDecisionSchema, request.body ?? {});
  await db.transaction(async (transaction) => {
    const [row] = await transaction.select({ review: timesheetProjectReviews, sheet: weeklyTimesheets }).from(timesheetProjectReviews).innerJoin(weeklyTimesheets, eq(timesheetProjectReviews.weeklyTimesheetId, weeklyTimesheets.id)).where(and(eq(timesheetProjectReviews.id, reviewId), eq(weeklyTimesheets.workspaceId, workspaceId))).limit(1); if (!row) throw notFound();
    if (row.review.status !== "pending") throw new ApiError(409, "invalid_review_state", "Only pending reviews can be approved.");
    if (actor.role !== "admin" && row.review.approverMembershipId !== actor.id) throw notFound();
    await assertSelfReviewAllowed(transaction, workspaceId, row.sheet.membershipId, actor.id, actor.role);
    const [changed] = await transaction.update(timesheetProjectReviews).set({ status: "approved", resolvedAt: new Date(), resolvedByMembershipId: actor.id, updatedAt: new Date() }).where(and(eq(timesheetProjectReviews.id, reviewId), eq(timesheetProjectReviews.status, "pending"))).returning({ id: timesheetProjectReviews.id });
    if (!changed) throw new ApiError(409, "invalid_review_state", "This review was already resolved.");
    await transaction.insert(timesheetReviewEvents).values({ reviewId, actorMembershipId: actor.id, type: "approved" }); const status = await updateSheetStatus(transaction, row.sheet.id); response.json({ id: String(reviewId), status: "approved", timesheetStatus: status });
  });
}));

timesheetRouter.post("/workspaces/:workspaceId/approval-items/:reviewId/request-changes", asyncHandler(async (request, response) => {
  const workspaceId = paramId(request.params.workspaceId); const actor = await membershipFor(workspaceId, actorId(response)); requireManager(actor); const reviewId = paramId(request.params.reviewId); const input = parse(z.object({ comment: z.string().trim().min(1).max(2_000) }).strict(), request.body);
  await db.transaction(async (transaction) => {
    const [row] = await transaction.select({ review: timesheetProjectReviews, sheet: weeklyTimesheets }).from(timesheetProjectReviews).innerJoin(weeklyTimesheets, eq(timesheetProjectReviews.weeklyTimesheetId, weeklyTimesheets.id)).where(and(eq(timesheetProjectReviews.id, reviewId), eq(weeklyTimesheets.workspaceId, workspaceId))).limit(1); if (!row) throw notFound(); if (row.review.status !== "pending") throw new ApiError(409, "invalid_review_state", "Only pending reviews can be returned."); if (actor.role !== "admin" && row.review.approverMembershipId !== actor.id) throw notFound(); await assertSelfReviewAllowed(transaction, workspaceId, row.sheet.membershipId, actor.id, actor.role);
    const [changed] = await transaction.update(timesheetProjectReviews).set({ status: "changes_requested", resolvedAt: new Date(), resolvedByMembershipId: actor.id, returnComment: input.comment, updatedAt: new Date() }).where(and(eq(timesheetProjectReviews.id, reviewId), eq(timesheetProjectReviews.status, "pending"))).returning({ id: timesheetProjectReviews.id });
    if (!changed) throw new ApiError(409, "invalid_review_state", "This review was already resolved.");
    await transaction.insert(timesheetReviewEvents).values({ reviewId, actorMembershipId: actor.id, type: "changes_requested", comment: input.comment }); const status = await updateSheetStatus(transaction, row.sheet.id); response.json({ id: String(reviewId), status: "changes_requested", timesheetStatus: status });
  });
}));
