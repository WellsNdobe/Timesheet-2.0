import { and, eq, gte, lt, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { timeEntries, timeExpectancyExceptions, workspaceMemberships, workspaceTimePolicies } from "../db/schema.js";
import { ApiError, asyncHandler } from "../errors.js";
import { parseResourceId, requireAdmin, requireWorkspaceMembership } from "../workspaces/access.js";

const router = Router();
const idSchema = z.coerce.number().int().positive();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "A real calendar date is required.");
const weekSchema = dateSchema.refine((value) => new Date(`${value}T00:00:00.000Z`).getUTCDay() === 1, "weekStart must be a Monday.");
const policySchema = z.object({ expectedWeeklyMinutes: z.number().int().min(5).max(10080).refine((value) => value % 5 === 0, "Expected weekly hours must be in five-minute increments.") }).strict();
const exceptionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("public_holiday"), workDate: dateSchema, name: z.string().trim().min(1).max(160), durationMinutes: z.number().int().min(1).max(1440) }).strict(),
  z.object({ type: z.literal("leave"), membershipId: idSchema, workDate: dateSchema, name: z.string().trim().min(1).max(160), durationMinutes: z.number().int().min(1).max(1440) }).strict(),
]);

const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(400, "validation_error", result.error.issues[0]?.message ?? "Invalid request.");
  return result.data;
};
const weekDays = (weekStart: string) => Array.from({ length: 5 }, (_, index) => {
  const date = new Date(`${weekStart}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + index);
  return date.toISOString().slice(0, 10);
});
const weekEnd = (weekStart: string) => {
  const date = new Date(`${weekStart}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 7);
  return date.toISOString().slice(0, 10);
};
const publicException = (value: typeof timeExpectancyExceptions.$inferSelect) => ({
  id: String(value.id), membershipId: value.membershipId == null ? null : String(value.membershipId), workDate: value.workDate,
  type: value.type as "public_holiday" | "leave", name: value.name, durationMinutes: value.durationMinutes,
});

async function completeness(workspaceId: number, membershipId: number, weekStart: string) {
  const days = weekDays(weekStart);
  const [policy] = await db.select().from(workspaceTimePolicies).where(eq(workspaceTimePolicies.workspaceId, workspaceId)).limit(1);
  const expectedWeeklyMinutes = policy?.expectedWeeklyMinutes ?? 2400;
  const expectedDailyMinutes = expectedWeeklyMinutes / 5;
  const [entries, exceptions] = await Promise.all([
    db.select({ workDate: timeEntries.workDate, minutes: sql<number>`coalesce(sum(${timeEntries.durationMinutes}), 0)::int` }).from(timeEntries)
      .where(and(eq(timeEntries.workspaceId, workspaceId), eq(timeEntries.membershipId, membershipId), gte(timeEntries.workDate, weekStart), lt(timeEntries.workDate, weekEnd(weekStart)))).groupBy(timeEntries.workDate),
    db.select().from(timeExpectancyExceptions).where(and(eq(timeExpectancyExceptions.workspaceId, workspaceId), gte(timeExpectancyExceptions.workDate, weekStart), lt(timeExpectancyExceptions.workDate, weekEnd(weekStart)), sql`(${timeExpectancyExceptions.membershipId} is null or ${timeExpectancyExceptions.membershipId} = ${membershipId})`)),
  ]);
  const loggedByDate = new Map(entries.map((entry) => [entry.workDate, Number(entry.minutes)]));
  const exceptionsByDate = new Map<string, typeof exceptions>();
  for (const exception of exceptions) exceptionsByDate.set(exception.workDate, [...(exceptionsByDate.get(exception.workDate) ?? []), exception]);
  const workingDays = days.map((workDate) => {
    // Holiday and leave can coexist; cap their combined effect at that day's normal expectation.
    const exceptionMinutes = Math.min(expectedDailyMinutes, (exceptionsByDate.get(workDate) ?? []).reduce((total, exception) => total + exception.durationMinutes, 0));
    const expectedMinutes = expectedDailyMinutes - exceptionMinutes;
    const loggedMinutes = loggedByDate.get(workDate) ?? 0;
    return { workDate, expectedMinutes, loggedMinutes, exceptionMinutes, missingMinutes: Math.max(0, expectedMinutes - loggedMinutes), exceptions: (exceptionsByDate.get(workDate) ?? []).map(publicException) };
  });
  const expectedMinutes = workingDays.reduce((total, day) => total + day.expectedMinutes, 0);
  const loggedMinutes = workingDays.reduce((total, day) => total + day.loggedMinutes, 0);
  return { weekStart, expectedWeeklyMinutes, expectedMinutes, loggedMinutes, exceptionMinutes: expectedWeeklyMinutes - expectedMinutes, remainingMinutes: Math.max(0, expectedMinutes - loggedMinutes), readyToSubmit: workingDays.every((day) => day.missingMinutes === 0), missingWorkingDays: workingDays.filter((day) => day.missingMinutes > 0), workingDays };
}

router.use(authenticate);

router.get("/workspaces/:workspaceId/timesheets/:weekStart/completeness", asyncHandler(async (request, response) => {
  const workspaceId = parseResourceId(request.params.workspaceId);
  const weekStart = parse(weekSchema, request.params.weekStart);
  const membership = await requireWorkspaceMembership(response, workspaceId);
  response.json(await completeness(workspaceId, membership.id, weekStart));
}));

router.get("/workspaces/:workspaceId/time-policy", asyncHandler(async (request, response) => {
  const workspaceId = parseResourceId(request.params.workspaceId);
  const membership = await requireWorkspaceMembership(response, workspaceId);
  const [policy] = await db.select().from(workspaceTimePolicies).where(eq(workspaceTimePolicies.workspaceId, workspaceId)).limit(1);
  response.json({ expectedWeeklyMinutes: policy?.expectedWeeklyMinutes ?? 2400, canManage: membership.role === "admin" });
}));

router.put("/workspaces/:workspaceId/time-policy", asyncHandler(async (request, response) => {
  const workspaceId = parseResourceId(request.params.workspaceId);
  const input = parse(policySchema, request.body);
  const membership = await requireWorkspaceMembership(response, workspaceId); requireAdmin(membership);
  const [policy] = await db.insert(workspaceTimePolicies).values({ workspaceId, expectedWeeklyMinutes: input.expectedWeeklyMinutes, updatedAt: new Date() })
    .onConflictDoUpdate({ target: workspaceTimePolicies.workspaceId, set: { expectedWeeklyMinutes: input.expectedWeeklyMinutes, updatedAt: new Date() } }).returning();
  response.json({ expectedWeeklyMinutes: policy.expectedWeeklyMinutes });
}));

router.get("/workspaces/:workspaceId/time-exceptions", asyncHandler(async (request, response) => {
  const workspaceId = parseResourceId(request.params.workspaceId);
  const membership = await requireWorkspaceMembership(response, workspaceId); requireAdmin(membership);
  const query = parse(z.object({ from: dateSchema.optional(), to: dateSchema.optional() }).strict(), request.query);
  const rows = await db.select().from(timeExpectancyExceptions).where(and(eq(timeExpectancyExceptions.workspaceId, workspaceId), ...(query.from ? [gte(timeExpectancyExceptions.workDate, query.from)] : []), ...(query.to ? [lt(timeExpectancyExceptions.workDate, query.to)] : []))).orderBy(timeExpectancyExceptions.workDate);
  response.json({ exceptions: rows.map(publicException) });
}));

router.post("/workspaces/:workspaceId/time-exceptions", asyncHandler(async (request, response) => {
  const workspaceId = parseResourceId(request.params.workspaceId);
  const input = parse(exceptionSchema, request.body);
  const membership = await requireWorkspaceMembership(response, workspaceId); requireAdmin(membership);
  if (new Date(`${input.workDate}T00:00:00.000Z`).getUTCDay() === 0 || new Date(`${input.workDate}T00:00:00.000Z`).getUTCDay() === 6) throw new ApiError(400, "invalid_exception", "Exceptions may only be recorded for working days.");
  if (input.type === "leave") {
    const [target] = await db.select({ id: workspaceMemberships.id }).from(workspaceMemberships).where(and(eq(workspaceMemberships.id, input.membershipId), eq(workspaceMemberships.workspaceId, workspaceId))).limit(1);
    if (!target) throw new ApiError(400, "invalid_member", "Leave must be recorded for a member of this workspace.");
  }
  try {
    const [created] = await db.insert(timeExpectancyExceptions).values({ workspaceId, membershipId: input.type === "leave" ? input.membershipId : null, workDate: input.workDate, type: input.type, name: input.name, durationMinutes: input.durationMinutes, createdByMembershipId: membership.id }).returning();
    response.status(201).json({ exception: publicException(created) });
  } catch (error) {
    if (error instanceof Error && /unique/i.test(error.message)) throw new ApiError(409, "exception_exists", "An exception of this type already exists for that date.");
    throw error;
  }
}));

router.delete("/workspaces/:workspaceId/time-exceptions/:exceptionId", asyncHandler(async (request, response) => {
  const workspaceId = parseResourceId(request.params.workspaceId);
  const exceptionId = parseResourceId(request.params.exceptionId);
  const membership = await requireWorkspaceMembership(response, workspaceId); requireAdmin(membership);
  const [deleted] = await db.delete(timeExpectancyExceptions).where(and(eq(timeExpectancyExceptions.id, exceptionId), eq(timeExpectancyExceptions.workspaceId, workspaceId))).returning({ id: timeExpectancyExceptions.id });
  if (!deleted) throw new ApiError(404, "not_found", "The requested exception was not found.");
  response.status(204).end();
}));

export const completenessRouter = router;
