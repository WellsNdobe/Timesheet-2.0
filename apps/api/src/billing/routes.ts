import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { billingBatchEntries, billingBatches, clients, projectRates, projects, timesheetApprovalItems, timesheetApprovalRevisions, timesheetReviewEntrySnapshots, users, weeklyTimesheets, workspaceMemberships } from "../db/schema.js";
import { ApiError, asyncHandler } from "../errors.js";
import { fingerprintRequest, idempotencyKeyReused, parseIdempotencyKey } from "../idempotency.js";
import { notFound, parseResourceId, requireAdmin, requireWorkspaceMembership } from "../workspaces/access.js";
import { audit } from "../workflow/events.js";
import { entryAmount } from "./rates.js";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return value >= "1900-01-01" && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Use a real calendar date from 1900 onwards.");
const id = z.coerce.number().int().positive().safe();
const filtersSchema = z.object({ dateFrom: date, dateTo: date, clientId: id.optional(), projectId: id.optional() }).strict().refine((value) => {
  const days = (Date.parse(value.dateTo) - Date.parse(value.dateFrom)) / 86400000;
  return days >= 0 && days <= 366;
}, "Choose an ordered date range of at most 367 days.");
const rateSchema = z.object({ effectiveFrom: date, hourlyRateCents: z.number().int().min(0).max(100_000_000), currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/), reason: z.string().trim().min(1).max(500) }).strict();
const selectionSchema = z.object({ snapshotId: id, fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const batchSchema = z.object({ entries: z.array(selectionSchema).min(1).max(100) }).strict().refine((value) => new Set(value.entries.map((entry) => entry.snapshotId)).size === value.entries.length, "Select each entry only once.");
const parse = <T>(schema: z.ZodType<T>, input: unknown): T => {
  const result = schema.safeParse(input);
  if (!result.success) throw new ApiError(400, "validation_error", result.error.issues[0]?.message ?? "Invalid billing request.");
  return result.data;
};

// Use the same workspace lock as role changes, project configuration and approval decisions.
async function lockedAdmin(transaction: Transaction, workspaceId: number, userId: number) {
  await transaction.execute(sql`select pg_advisory_xact_lock(${workspaceId})`);
  const [actor] = await transaction.select().from(workspaceMemberships).where(and(eq(workspaceMemberships.workspaceId, workspaceId), eq(workspaceMemberships.userId, userId), eq(workspaceMemberships.isActive, true))).limit(1);
  if (!actor) throw notFound();
  requireAdmin(actor);
  return actor;
}

async function candidates(connection: Pick<Transaction, "select">, workspaceId: number, filters?: z.infer<typeof filtersSchema>, snapshotIds?: number[]) {
  const rows = await connection.select({
    snapshotId: timesheetReviewEntrySnapshots.id, sourceEntryId: timesheetReviewEntrySnapshots.sourceEntryId,
    revisionId: timesheetApprovalRevisions.id, projectId: projects.id, projectName: timesheetApprovalRevisions.projectName,
    clientId: clients.id, clientName: clients.name, memberEmail: users.email,
    taskName: timesheetReviewEntrySnapshots.taskName, description: timesheetReviewEntrySnapshots.description,
    workDate: timesheetReviewEntrySnapshots.workDate, durationMinutes: timesheetReviewEntrySnapshots.durationMinutes,
    rateId: projectRates.id, hourlyRateCents: projectRates.hourlyRateCents, currency: projectRates.currency, legacyRate: projectRates.isLegacy,
  }).from(timesheetReviewEntrySnapshots)
    .innerJoin(timesheetApprovalRevisions, eq(timesheetReviewEntrySnapshots.revisionId, timesheetApprovalRevisions.id))
    .innerJoin(timesheetApprovalItems, eq(timesheetApprovalRevisions.approvalItemId, timesheetApprovalItems.id))
    .innerJoin(weeklyTimesheets, eq(timesheetApprovalItems.weeklyTimesheetId, weeklyTimesheets.id))
    .innerJoin(projects, and(eq(projects.id, timesheetApprovalItems.projectId), eq(projects.workspaceId, workspaceId)))
    .innerJoin(workspaceMemberships, eq(weeklyTimesheets.membershipId, workspaceMemberships.id))
    .innerJoin(users, eq(workspaceMemberships.userId, users.id))
    .leftJoin(clients, and(eq(projects.clientId, clients.id), eq(clients.workspaceId, workspaceId)))
    .leftJoin(projectRates, eq(projectRates.id, sql`(select pr.id from project_rates pr where pr.project_id = ${projects.id} and pr.effective_from <= ${timesheetReviewEntrySnapshots.workDate} order by pr.effective_from desc limit 1)`))
    .leftJoin(billingBatchEntries, and(eq(billingBatchEntries.workspaceId, workspaceId), eq(billingBatchEntries.sourceEntryId, timesheetReviewEntrySnapshots.sourceEntryId)))
    .where(and(eq(weeklyTimesheets.workspaceId, workspaceId), eq(timesheetApprovalRevisions.status, "approved"), eq(timesheetReviewEntrySnapshots.isBillable, true), isNull(billingBatchEntries.id),
      sql`not exists (select 1 from timesheet_approval_revisions newer where newer.approval_item_id = ${timesheetApprovalRevisions.approvalItemId} and newer.revision_number > ${timesheetApprovalRevisions.revisionNumber})`,
      ...(filters ? [gte(timesheetReviewEntrySnapshots.workDate, filters.dateFrom), lte(timesheetReviewEntrySnapshots.workDate, filters.dateTo)] : []),
      ...(filters?.clientId ? [eq(clients.id, filters.clientId)] : []), ...(filters?.projectId ? [eq(projects.id, filters.projectId)] : []),
      ...(snapshotIds ? [inArray(timesheetReviewEntrySnapshots.id, snapshotIds)] : []),
    )).orderBy(asc(timesheetReviewEntrySnapshots.workDate), asc(timesheetReviewEntrySnapshots.id)).limit(5001);
  if (rows.length > 5000) throw new ApiError(413, "billing_too_large", "More than 5,000 entries match. Narrow the dates, client or project.");
  return rows.map((row) => {
    const entry = { ...row, amountCents: row.hourlyRateCents == null ? null : entryAmount(row.durationMinutes, row.hourlyRateCents), issue: row.clientId == null ? "Assign a client in Projects" : row.rateId == null ? "Add a rate covering this work date" : row.legacyRate ? "Confirm a dated rate in Projects" : null };
    return { ...entry, fingerprint: fingerprintRequest(entry) };
  });
}

const publicBatch = (batch: typeof billingBatches.$inferSelect) => ({ id: String(batch.id), clientName: batch.clientName, currency: batch.currency, totalMinutes: batch.totalMinutes, totalCents: batch.totalCents, entryCount: batch.entryCount, dateFrom: batch.dateFrom, dateTo: batch.dateTo, createdAt: batch.createdAt.toISOString(), invoiceReference: batch.invoiceReference, handedOffAt: batch.handedOffAt?.toISOString() ?? null });
export const billingRouter = Router();
billingRouter.use(authenticate);

billingRouter.get("/workspaces/:workspaceId/projects/:projectId/rates", asyncHandler(async (request, response) => {
  const workspaceId = parseResourceId(request.params.workspaceId); const projectId = parseResourceId(request.params.projectId);
  requireAdmin(await requireWorkspaceMembership(response, workspaceId));
  const [project] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId))).limit(1);
  if (!project) throw notFound();
  const rates = await db.select().from(projectRates).where(eq(projectRates.projectId, projectId)).orderBy(desc(projectRates.effectiveFrom));
  response.set("Cache-Control", "no-store").json({ rates });
}));

billingRouter.post("/workspaces/:workspaceId/projects/:projectId/rates", asyncHandler(async (request, response) => {
  const workspaceId = parseResourceId(request.params.workspaceId); const projectId = parseResourceId(request.params.projectId); const input = parse(rateSchema, request.body);
  const rate = await db.transaction(async (transaction) => {
    const actor = await lockedAdmin(transaction, workspaceId, Number(response.locals.authUser.id));
    const [project] = await transaction.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId))).limit(1);
    if (!project) throw notFound();
    const [latest] = await transaction.select().from(projectRates).where(eq(projectRates.projectId, projectId)).orderBy(desc(projectRates.effectiveFrom)).limit(1);
    // Safe retry after a lost response, without allowing an existing rate to be overwritten.
    if (latest && latest.effectiveFrom === input.effectiveFrom && latest.hourlyRateCents === input.hourlyRateCents && latest.currency === input.currency && latest.reason === input.reason && !latest.isLegacy) return latest;
    if (latest && input.effectiveFrom <= latest.effectiveFrom) throw new ApiError(409, "rate_date_conflict", "The effective date must be after the latest rate. Existing rates cannot be overwritten.");
    const [billed] = await transaction.select({ id: billingBatchEntries.id }).from(billingBatchEntries).where(and(eq(billingBatchEntries.workspaceId, workspaceId), eq(billingBatchEntries.projectId, projectId), gte(billingBatchEntries.workDate, input.effectiveFrom))).limit(1);
    if (billed) throw new ApiError(409, "rate_overlaps_billed_work", "This date would reprice finalised work. Choose a date after this project's billed work.");
    const [created] = await transaction.insert(projectRates).values({ projectId, ...input, createdByMembershipId: actor.id }).returning();
    await audit(transaction, { workspaceId, actorMembershipId: actor.id, type: "project_rate_added", targetProjectId: projectId, details: { rateId: String(created.id), ...input } });
    return created;
  });
  response.status(201).json({ rate });
}));

billingRouter.get("/workspaces/:workspaceId/billing/unbilled", asyncHandler(async (request, response) => {
  const workspaceId = parseResourceId(request.params.workspaceId); requireAdmin(await requireWorkspaceMembership(response, workspaceId));
  const filters = parse(filtersSchema, request.query);
  response.set("Cache-Control", "no-store").json({ entries: await candidates(db, workspaceId, filters) });
}));

billingRouter.post("/workspaces/:workspaceId/billing/batches", asyncHandler(async (request, response) => {
  const workspaceId = parseResourceId(request.params.workspaceId); const input = parse(batchSchema, request.body); const key = parseIdempotencyKey(request);
  const fingerprint = fingerprintRequest([...input.entries].sort((a, b) => a.snapshotId - b.snapshotId));
  const batch = await db.transaction(async (transaction) => {
    const actor = await lockedAdmin(transaction, workspaceId, Number(response.locals.authUser.id));
    const [prior] = await transaction.select().from(billingBatches).where(and(eq(billingBatches.workspaceId, workspaceId), eq(billingBatches.idempotencyKey, key))).limit(1);
    if (prior) { if (prior.requestFingerprint !== fingerprint) throw idempotencyKeyReused(); return prior; }
    const entries = await candidates(transaction, workspaceId, undefined, input.entries.map((entry) => entry.snapshotId));
    if (entries.length !== input.entries.length || entries.some((entry) => input.entries.find((selected) => selected.snapshotId === entry.snapshotId)?.fingerprint !== entry.fingerprint)) throw new ApiError(409, "billing_selection_changed", "Selected work has changed or was already billed. Refresh and review it again.");
    if (entries.some((entry) => entry.issue)) throw new ApiError(400, "billing_not_ready", "Every selected entry needs a client and a confirmed rate for its work date.");
    const first = entries[0];
    if (entries.some((entry) => entry.clientId !== first.clientId || entry.currency !== first.currency)) throw new ApiError(400, "mixed_billing_batch", "A batch must contain one client and one currency.");
    const [created] = await transaction.insert(billingBatches).values({ workspaceId, clientId: first.clientId!, clientName: first.clientName!, currency: first.currency!, totalMinutes: entries.reduce((sum, entry) => sum + entry.durationMinutes, 0), totalCents: entries.reduce((sum, entry) => sum + entry.amountCents!, 0), entryCount: entries.length, dateFrom: entries[0].workDate, dateTo: entries[entries.length - 1].workDate, idempotencyKey: key, requestFingerprint: fingerprint, createdByMembershipId: actor.id }).returning();
    await transaction.insert(billingBatchEntries).values(entries.map((entry) => ({ batchId: created.id, workspaceId, snapshotId: entry.snapshotId, sourceEntryId: entry.sourceEntryId, revisionId: entry.revisionId, projectId: entry.projectId, projectName: entry.projectName, memberEmail: entry.memberEmail, taskName: entry.taskName, description: entry.description, workDate: entry.workDate, durationMinutes: entry.durationMinutes, rateId: entry.rateId!, hourlyRateCents: entry.hourlyRateCents!, amountCents: entry.amountCents! })));
    await audit(transaction, { workspaceId, actorMembershipId: actor.id, type: "billing_batch_finalised", details: { batchId: String(created.id), clientName: created.clientName, currency: created.currency, totalCents: created.totalCents, entryCount: created.entryCount } });
    return created;
  });
  response.status(201).json({ batch: publicBatch(batch) });
}));

billingRouter.get("/workspaces/:workspaceId/billing/batches", asyncHandler(async (request, response) => {
  const workspaceId = parseResourceId(request.params.workspaceId); requireAdmin(await requireWorkspaceMembership(response, workspaceId));
  const query = parse(z.object({ before: id.optional() }).strict(), request.query);
  const rows = await db.select().from(billingBatches).where(and(eq(billingBatches.workspaceId, workspaceId), ...(query.before ? [lt(billingBatches.id, query.before)] : []))).orderBy(desc(billingBatches.id)).limit(51);
  response.set("Cache-Control", "no-store").json({ batches: rows.slice(0, 50).map(publicBatch), nextCursor: rows.length > 50 ? String(rows[49].id) : null });
}));

billingRouter.patch("/workspaces/:workspaceId/billing/batches/:batchId/handoff", asyncHandler(async (request, response) => {
  const workspaceId = parseResourceId(request.params.workspaceId); const batchId = parseResourceId(request.params.batchId);
  const input = parse(z.object({ invoiceReference: z.string().trim().min(1).max(160) }).strict(), request.body);
  const batch = await db.transaction(async (transaction) => {
    const actor = await lockedAdmin(transaction, workspaceId, Number(response.locals.authUser.id));
    const [existing] = await transaction.select().from(billingBatches).where(and(eq(billingBatches.id, batchId), eq(billingBatches.workspaceId, workspaceId))).limit(1);
    if (!existing) throw notFound();
    const [updated] = await transaction.update(billingBatches).set({ invoiceReference: input.invoiceReference, handedOffAt: existing.handedOffAt ?? new Date() }).where(eq(billingBatches.id, existing.id)).returning();
    await audit(transaction, { workspaceId, actorMembershipId: actor.id, type: "billing_batch_handed_off", details: { batchId: String(batchId), previousReference: existing.invoiceReference, invoiceReference: input.invoiceReference } });
    return updated;
  });
  response.json({ batch: publicBatch(batch) });
}));

const csvCell = (value: string | number | null) => {
  let text = value == null ? "" : String(value);
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
billingRouter.get("/workspaces/:workspaceId/billing/batches/:batchId/export.csv", asyncHandler(async (request, response) => {
  const workspaceId = parseResourceId(request.params.workspaceId); requireAdmin(await requireWorkspaceMembership(response, workspaceId));
  const batchId = parseResourceId(request.params.batchId);
  const [batch] = await db.select().from(billingBatches).where(and(eq(billingBatches.id, batchId), eq(billingBatches.workspaceId, workspaceId))).limit(1);
  if (!batch) throw notFound();
  const entries = await db.select().from(billingBatchEntries).where(eq(billingBatchEntries.batchId, batchId)).orderBy(asc(billingBatchEntries.id));
  // Mutable handoff metadata is deliberately absent, so repeated exports remain identical.
  const rows: (string | number | null)[][] = [["Batch", "Client", "Work date", "Project", "Member", "Task", "Description", "Minutes", "Hours", "Hourly rate", "Currency", "Amount", "Source entry", "Approval revision"]];
  for (const entry of entries) rows.push([batch.id, batch.clientName, entry.workDate, entry.projectName, entry.memberEmail, entry.taskName, entry.description, entry.durationMinutes, (entry.durationMinutes / 60).toFixed(4), (entry.hourlyRateCents / 100).toFixed(2), batch.currency, (entry.amountCents / 100).toFixed(2), entry.sourceEntryId, entry.revisionId]);
  response.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="billing-batch-${batch.id}.csv"`, "Cache-Control": "no-store" }).send(`\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`);
}));
