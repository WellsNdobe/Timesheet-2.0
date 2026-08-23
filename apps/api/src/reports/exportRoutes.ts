import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { projects, tasks, timeEntries, timesheetApprovalItems, timesheetApprovalRevisions, users, weeklyTimesheets, workspaceMemberships } from "../db/schema.js";
import { ApiError, asyncHandler } from "../errors.js";
import { notFound, parseResourceId, requireManagerOrAdmin, requireWorkspaceMembership } from "../workspaces/access.js";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "A real calendar date is required.");
const querySchema = z.object({
  dateFrom: dateSchema,
  dateTo: dateSchema,
  projectId: z.coerce.number().int().positive().optional(),
  memberId: z.coerce.number().int().positive().optional(),
  approvalStatus: z.enum(["not_submitted", "pending", "approved", "changes_requested", "withdrawn"]).optional(),
}).strict().superRefine((value, context) => {
  if (value.dateFrom > value.dateTo) context.addIssue({ code: "custom", message: "dateFrom must be on or before dateTo." });
  const rangeDays = (new Date(`${value.dateTo}T00:00:00.000Z`).getTime() - new Date(`${value.dateFrom}T00:00:00.000Z`).getTime()) / 86_400_000;
  if (rangeDays > 366) context.addIssue({ code: "custom", message: "Exports are limited to 367 calendar days." });
});

const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(400, "validation_error", result.error.issues[0]?.message ?? "Invalid export filters.");
  return result.data;
};

const weekStartFor = (date: string) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
  return value.toISOString().slice(0, 10);
};

// Prevent spreadsheet applications interpreting an entered description as a formula.
const csvCell = (value: string | number | boolean | null | undefined) => {
  let text = value == null ? "" : String(value);
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export const reportExportRouter = Router();
reportExportRouter.use(authenticate);

reportExportRouter.get("/workspaces/:workspaceId/reports/export.csv", asyncHandler(async (request, response) => {
  const workspaceId = parseResourceId(request.params.workspaceId);
  const filters = parse(querySchema, request.query);
  const actor = await requireWorkspaceMembership(response, workspaceId);
  requireManagerOrAdmin(actor);

  let allowedProjectIds: number[] | undefined;
  if (actor.role === "manager") {
    allowedProjectIds = (await db.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.workspaceId, workspaceId), eq(projects.approverMembershipId, actor.id)))).map((project) => project.id);
    if (filters.projectId != null && !allowedProjectIds.includes(filters.projectId)) throw notFound();
  }

  const conditions = [
    eq(timeEntries.workspaceId, workspaceId),
    gte(timeEntries.workDate, filters.dateFrom),
    lte(timeEntries.workDate, filters.dateTo),
    ...(filters.projectId == null ? [] : [eq(timeEntries.projectId, filters.projectId)]),
    ...(filters.memberId == null ? [] : [eq(timeEntries.membershipId, filters.memberId)]),
    ...(allowedProjectIds === undefined ? [] : [inArray(timeEntries.projectId, allowedProjectIds)]),
  ];

  const entries = await db.select({
    workDate: timeEntries.workDate, durationMinutes: timeEntries.durationMinutes, isBillable: timeEntries.isBillable, description: timeEntries.description,
    projectId: projects.id, projectName: projects.name, taskName: tasks.name,
    membershipId: workspaceMemberships.id, memberEmail: users.email,
  }).from(timeEntries)
    .innerJoin(projects, eq(timeEntries.projectId, projects.id))
    .innerJoin(workspaceMemberships, eq(timeEntries.membershipId, workspaceMemberships.id))
    .innerJoin(users, eq(workspaceMemberships.userId, users.id))
    .leftJoin(tasks, eq(timeEntries.taskId, tasks.id))
    .where(and(...conditions)).orderBy(asc(timeEntries.workDate), asc(projects.name), asc(users.email)).limit(50_001);

  if (entries.length > 50_000) throw new ApiError(413, "export_too_large", "This export contains more than 50,000 entries. Narrow the date range or filters.");

  const weekStarts = [...new Set(entries.map((entry) => weekStartFor(entry.workDate)))];
  const sheets = weekStarts.length === 0 ? [] : await db.select({ id: weeklyTimesheets.id, membershipId: weeklyTimesheets.membershipId, weekStart: weeklyTimesheets.weekStart })
    .from(weeklyTimesheets).where(and(eq(weeklyTimesheets.workspaceId, workspaceId), inArray(weeklyTimesheets.weekStart, weekStarts)));
  const sheetByMemberWeek = new Map(sheets.map((sheet) => [`${sheet.membershipId}:${sheet.weekStart}`, sheet.id]));
  const approvalItems = sheets.length === 0 ? [] : await db.select({ id: timesheetApprovalItems.id, weeklyTimesheetId: timesheetApprovalItems.weeklyTimesheetId, projectId: timesheetApprovalItems.projectId })
    .from(timesheetApprovalItems).where(inArray(timesheetApprovalItems.weeklyTimesheetId, sheets.map((sheet) => sheet.id)));
  const itemBySheetProject = new Map(approvalItems.map((item) => [`${item.weeklyTimesheetId}:${item.projectId}`, item.id]));
  const revisions = approvalItems.length === 0 ? [] : await db.select({ approvalItemId: timesheetApprovalRevisions.approvalItemId, revisionNumber: timesheetApprovalRevisions.revisionNumber, status: timesheetApprovalRevisions.status })
    .from(timesheetApprovalRevisions).where(inArray(timesheetApprovalRevisions.approvalItemId, approvalItems.map((item) => item.id)));
  const latestRevision = new Map<number, { revisionNumber: number; status: string }>();
  for (const revision of revisions) {
    const existing = latestRevision.get(revision.approvalItemId);
    if (!existing || revision.revisionNumber > existing.revisionNumber) latestRevision.set(revision.approvalItemId, revision);
  }

  const rows = entries.map((entry) => {
    const sheetId = sheetByMemberWeek.get(`${entry.membershipId}:${weekStartFor(entry.workDate)}`);
    const itemId = sheetId == null ? undefined : itemBySheetProject.get(`${sheetId}:${entry.projectId}`);
    return { ...entry, approvalStatus: itemId == null ? "not_submitted" : latestRevision.get(itemId)?.status ?? "not_submitted" };
  }).filter((entry) => filters.approvalStatus == null || entry.approvalStatus === filters.approvalStatus);

  const header = ["Work date", "Project", "Task", "Member", "Hours", "Billable", "Approval status", "Description"];
  const csv = [header, ...rows.map((entry) => [
    entry.workDate, entry.projectName, entry.taskName, entry.memberEmail, (entry.durationMinutes / 60).toFixed(2), entry.isBillable ? "Yes" : "No", entry.approvalStatus, entry.description,
  ])].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const filename = `time-report-${filters.dateFrom}-to-${filters.dateTo}.csv`;
  response.set({
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename=\"${filename}\"`,
    "Cache-Control": "no-store",
    "X-Report-Filters": JSON.stringify(filters),
  });
  response.send(`\uFEFF${csv}\r\n`);
}));
