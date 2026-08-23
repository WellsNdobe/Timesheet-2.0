import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { projects, timeEntries, timesheetApprovalItems, timesheetApprovalRevisions, users, weeklyTimesheets, workspaces, workspaceMemberships } from "../db/schema.js";
import { ApiError, asyncHandler } from "../errors.js";
import { parseResourceId, requireWorkspaceMembership } from "../workspaces/access.js";

export const reportsRouter = Router();
reportsRouter.use(authenticate);

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => { const parsed = new Date(`${value}T00:00:00.000Z`); return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value; }, "A real calendar date is required.");
const id = z.coerce.number().int().positive();
const querySchema = z.object({
  dateFrom: date.optional(), dateTo: date.optional(), projectId: id.optional(), memberId: id.optional(),
  approvalStatus: z.enum(["not_submitted", "pending", "approved", "changes_requested", "withdrawn"]).optional(),
}).strict().superRefine((value, context) => { if (value.dateFrom && value.dateTo) { if (value.dateFrom > value.dateTo) context.addIssue({ code: "custom", message: "dateFrom must be on or before dateTo." }); const days = (new Date(`${value.dateTo}T00:00:00.000Z`).getTime() - new Date(`${value.dateFrom}T00:00:00.000Z`).getTime()) / 86_400_000; if (days > 366) context.addIssue({ code: "custom", message: "Reports are limited to 367 calendar days." }); } });

const weekStart = (workDate: string) => {
  const value = new Date(`${workDate}T00:00:00.000Z`);
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() - day + 1);
  return value.toISOString().slice(0, 10);
};
const dateInZone = (value: Date, timezone: string) => { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value); const part = (type: "year" | "month" | "day") => parts.find((item) => item.type === type)?.value ?? ""; return `${part("year")}-${part("month")}-${part("day")}`; };
const subtractDays = (dateValue: string, days: number) => { const value = new Date(`${dateValue}T00:00:00.000Z`); value.setUTCDate(value.getUTCDate() - days); return value.toISOString().slice(0, 10); };
const parse = <T>(schema: z.ZodType<T>, value: unknown): T => { const result = schema.safeParse(value); if (!result.success) throw new ApiError(400, "validation_error", result.error.issues[0]?.message ?? "Invalid report filters."); return result.data; };

reportsRouter.get("/workspaces/:workspaceId/reports", asyncHandler(async (request, response) => {
  const workspaceId = parseResourceId(request.params.workspaceId);
  const actor = await requireWorkspaceMembership(response, workspaceId); const query = parse(querySchema, request.query);
  const [workspace] = await db.select({ timezone: workspaces.timezone }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1); if (!workspace) throw new ApiError(404, "not_found", "The requested resource was not found.");
  const dateTo = query.dateTo ?? dateInZone(new Date(), workspace.timezone); const dateFrom = query.dateFrom ?? subtractDays(dateTo, 29);
  if (dateFrom > dateTo) throw new ApiError(400, "validation_error", "dateFrom must be on or before dateTo.");
  if ((new Date(`${dateTo}T00:00:00.000Z`).getTime() - new Date(`${dateFrom}T00:00:00.000Z`).getTime()) / 86_400_000 > 366) throw new ApiError(400, "validation_error", "Reports are limited to 367 calendar days.");

  const scopedProjects = actor.role === "manager"
    ? (await db.select({ id: projects.id }).from(projects).where(and(eq(projects.workspaceId, workspaceId), eq(projects.approverMembershipId, actor.id)))).map((row) => row.id)
    : null;
  if (actor.role === "manager" && query.projectId != null && !(scopedProjects ?? []).includes(query.projectId)) throw new ApiError(404, "not_found", "The requested resource was not found.");
  if (actor.role === "manager" && !(scopedProjects?.length)) { response.json({ dateFrom, dateTo, summary: { totalMinutes: 0, billableMinutes: 0, entryCount: 0, approval: {} }, daily: [], projects: [], members: [], entries: [] }); return; }

  const rows = await db.select({ entry: timeEntries, project: projects, membership: workspaceMemberships, user: users })
    .from(timeEntries).innerJoin(projects, eq(timeEntries.projectId, projects.id))
    .innerJoin(workspaceMemberships, eq(timeEntries.membershipId, workspaceMemberships.id)).innerJoin(users, eq(workspaceMemberships.userId, users.id))
    .where(and(eq(timeEntries.workspaceId, workspaceId), gte(timeEntries.workDate, dateFrom), lte(timeEntries.workDate, dateTo),
      ...(actor.role === "member" ? [eq(timeEntries.membershipId, actor.id)] : []),
      ...(scopedProjects ? [inArray(timeEntries.projectId, scopedProjects)] : []),
      ...(query.projectId ? [eq(timeEntries.projectId, query.projectId)] : []),
      ...(query.memberId && actor.role !== "member" ? [eq(timeEntries.membershipId, query.memberId)] : []),
    )).orderBy(asc(timeEntries.workDate), asc(timeEntries.createdAt)).limit(5_001);
  if (rows.length > 5_000) throw new ApiError(413, "report_too_large", "This report contains more than 5,000 entries. Narrow the date range or filters.");
  const reportWeeks = [...new Set(rows.map((row) => weekStart(row.entry.workDate)))]; const reportMembers = [...new Set(rows.map((row) => row.entry.membershipId))];
  const sheets = rows.length ? await db.select().from(weeklyTimesheets).where(and(eq(weeklyTimesheets.workspaceId, workspaceId), inArray(weeklyTimesheets.membershipId, reportMembers), inArray(weeklyTimesheets.weekStart, reportWeeks))) : [];
  const revisions = sheets.length ? await db.select({ item: timesheetApprovalItems, revision: timesheetApprovalRevisions, sheet: weeklyTimesheets }).from(timesheetApprovalItems).innerJoin(weeklyTimesheets, eq(timesheetApprovalItems.weeklyTimesheetId, weeklyTimesheets.id)).innerJoin(timesheetApprovalRevisions, eq(timesheetApprovalRevisions.approvalItemId, timesheetApprovalItems.id)).where(and(eq(weeklyTimesheets.workspaceId, workspaceId), inArray(weeklyTimesheets.id, sheets.map((sheet) => sheet.id)))) : [];
  const latest = new Map<number, typeof revisions[number]>(); for (const row of revisions) { const current = latest.get(row.item.id); if (!current || row.revision.revisionNumber > current.revision.revisionNumber) latest.set(row.item.id, row); }
  const statusFor = new Map([...latest.values()].map((row) => [`${row.sheet.membershipId}:${row.item.projectId}:${row.sheet.weekStart}`, row.revision.status]));
  const entries = rows.map(({ entry, project, membership, user }) => ({ id: String(entry.id), workDate: entry.workDate, durationMinutes: entry.durationMinutes, isBillable: entry.isBillable, description: entry.description, project: { id: String(project.id), name: project.name }, member: { id: String(membership.id), email: user.email }, approvalStatus: statusFor.get(`${entry.membershipId}:${entry.projectId}:${weekStart(entry.workDate)}`) ?? "not_submitted" }));
  const filtered = query.approvalStatus ? entries.filter((entry) => entry.approvalStatus === query.approvalStatus) : entries;
  const dailyMap = new Map<string, { totalMinutes: number; billableMinutes: number }>();
  for (const entry of filtered) { const current = dailyMap.get(entry.workDate) ?? { totalMinutes: 0, billableMinutes: 0 }; current.totalMinutes += entry.durationMinutes; if (entry.isBillable) current.billableMinutes += entry.durationMinutes; dailyMap.set(entry.workDate, current); }
  const projectMap = new Map<string, { id: string; name: string; totalMinutes: number; billableMinutes: number }>();
  for (const entry of filtered) { const current = projectMap.get(entry.project.id) ?? { ...entry.project, totalMinutes: 0, billableMinutes: 0 }; current.totalMinutes += entry.durationMinutes; if (entry.isBillable) current.billableMinutes += entry.durationMinutes; projectMap.set(entry.project.id, current); }
  const approval = filtered.reduce<Record<string, number>>((total, entry) => ({ ...total, [entry.approvalStatus]: (total[entry.approvalStatus] ?? 0) + entry.durationMinutes }), {});
  const totalMinutes = filtered.reduce((total, entry) => total + entry.durationMinutes, 0); const billableMinutes = filtered.filter((entry) => entry.isBillable).reduce((total, entry) => total + entry.durationMinutes, 0);
  response.json({ dateFrom, dateTo, summary: { totalMinutes, billableMinutes, entryCount: filtered.length, approval }, daily: [...dailyMap].map(([workDate, totals]) => ({ workDate, ...totals })), projects: [...projectMap.values()].sort((a, b) => b.totalMinutes - a.totalMinutes), members: [...new Map(rows.map((row) => [String(row.membership.id), { id: String(row.membership.id), email: row.user.email }])).values()], entries: filtered });
}));
