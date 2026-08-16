import { and, count, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../auth/middleware.js";
import { hashPassword } from "../auth/passwords.js";
import { db } from "../db/client.js";
import { idempotencyOperations, timesheetApprovalRevisions, users, workspaceInvitations, workspaceMemberships, workspaces } from "../db/schema.js";
import { env } from "../config.js";
import { sendWorkspaceInvitation, type InvitationDeliveryStatus } from "../email/sendWorkspaceInvitation.js";
import { ApiError, asyncHandler } from "../errors.js";
import { decryptIdempotencyResponse, encryptIdempotencyResponse, fingerprintRequest, idempotencyKeyReused, idempotencyTtlMs, parseIdempotencyKey, staleOperationMs } from "../idempotency.js";
import { requireRole, requireWorkspaceMembership, parseWorkspaceId, workspaceRoles, type WorkspaceMembership, type WorkspaceRole } from "./access.js";
import { createInvitationToken, hashInvitationToken } from "./invitations.js";
import { audit } from "../workflow/events.js";

export const invitationTtlMs = 7 * 24 * 60 * 60 * 1_000;
const roleSchema = z.enum(workspaceRoles);
const invitationRoleSchema = z.enum(["manager", "member"]);
const createInvitationSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  role: invitationRoleSchema.default("member"),
}).strict();
const updateMemberSchema = z.object({ role: roleSchema.optional(), isActive: z.boolean().optional() }).strict().refine((value) => value.role !== undefined || value.isActive !== undefined, "A role or access change is required.");
const acceptInvitationSchema = z.object({ token: z.string().min(20).max(512) }).strict();

const toPublicWorkspace = (workspace: { id: number; name: string; timezone: string; createdAt: Date }, membership: { id: number; role: WorkspaceRole }) => ({
  id: String(workspace.id),
  name: workspace.name,
  timezone: workspace.timezone,
  membership: { id: String(membership.id), role: membership.role },
  createdAt: workspace.createdAt.toISOString(),
});

const toPublicMember = (membership: { id: number; userId: number; role: WorkspaceRole; isActive: boolean; joinedAt: Date }, user: { email: string }) => ({
  id: String(membership.id),
  userId: String(membership.userId),
  email: user.email,
  role: membership.role,
  isActive: membership.isActive,
  joinedAt: membership.joinedAt.toISOString(),
});

const parseBody = <T>(schema: z.ZodType<T>, body: unknown, message: string): T => {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", message);
  return parsed.data;
};

const assertMembershipCanChange = async (transaction: DatabaseTransaction, workspaceId: number, target: { id: number; role: WorkspaceRole; isActive: boolean }, nextRole?: WorkspaceRole) => {
  if (target.isActive && target.role === "admin" && nextRole !== "admin") {
    const [admins] = await transaction.select({ value: count() }).from(workspaceMemberships).where(and(
      eq(workspaceMemberships.workspaceId, workspaceId),
      eq(workspaceMemberships.role, "admin"),
      eq(workspaceMemberships.isActive, true),
    ));
    if (Number(admins?.value ?? 0) <= 1) {
      throw new ApiError(409, "last_admin", "A workspace must retain at least one active admin.");
    }
  }

  if (nextRole && ["admin", "manager"].includes(nextRole)) return;
  const [pending] = await transaction.select({ value: count() }).from(timesheetApprovalRevisions).where(and(
    eq(timesheetApprovalRevisions.assignedApproverMembershipId, target.id),
    eq(timesheetApprovalRevisions.status, "pending"),
  ));
  if (Number(pending?.value ?? 0) > 0) {
    throw new ApiError(409, "pending_approvals", "Reassign pending approvals before changing this member's role or access.");
  }
};

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const requireAdminInTransaction = async (transaction: DatabaseTransaction, workspaceId: number, userId: number) => {
  const [membership] = await transaction.select().from(workspaceMemberships).where(and(eq(workspaceMemberships.workspaceId, workspaceId), eq(workspaceMemberships.userId, userId), eq(workspaceMemberships.isActive, true))).limit(1);
  if (!membership) throw new ApiError(404, "not_found", "The requested resource was not found.");
  requireRole(membership as WorkspaceMembership, "admin");
  return membership;
};

export const acceptInvitationForUser = async (transaction: DatabaseTransaction, user: { id: number; email: string }, token: string) => {
  const now = new Date();
  const [invitation] = await transaction.select().from(workspaceInvitations).where(and(
    eq(workspaceInvitations.tokenHash, hashInvitationToken(token)),
    eq(workspaceInvitations.status, "pending"),
    isNull(workspaceInvitations.revokedAt),
    gt(workspaceInvitations.expiresAt, now),
  )).limit(1);

  if (!invitation) throw new ApiError(404, "invitation_not_found", "The invitation is invalid, expired, or no longer available.");
  if (invitation.email !== user.email) throw new ApiError(403, "invitation_email_mismatch", "This invitation was issued for a different email address.");
  await transaction.execute(sql`select pg_advisory_xact_lock(${invitation.workspaceId})`);

  const [existing] = await transaction.select({ id: workspaceMemberships.id, isActive: workspaceMemberships.isActive }).from(workspaceMemberships).where(and(
    eq(workspaceMemberships.workspaceId, invitation.workspaceId),
    eq(workspaceMemberships.userId, user.id),
  )).limit(1);
  if (existing?.isActive) throw new ApiError(409, "already_workspace_member", "You are already a member of this workspace.");

  if (existing) {
    const [membership] = await transaction.update(workspaceMemberships).set({ role: invitation.role, isActive: true, updatedAt: now })
      .where(eq(workspaceMemberships.id, existing.id)).returning();
    await transaction.update(workspaceInvitations).set({ status: "accepted", acceptedAt: now, acceptedByUserId: user.id }).where(eq(workspaceInvitations.id, invitation.id));
    await audit(transaction, { workspaceId: invitation.workspaceId, actorMembershipId: membership.id, type: "invitation_accepted", targetMembershipId: membership.id, details: { invitationId: String(invitation.id), reactivated: true } });
    return membership;
  }

  const [membership] = await transaction.insert(workspaceMemberships).values({
    workspaceId: invitation.workspaceId,
    userId: user.id,
    role: invitation.role,
    isActive: true,
  }).returning();
  await transaction.update(workspaceInvitations).set({ status: "accepted", acceptedAt: now, acceptedByUserId: user.id }).where(eq(workspaceInvitations.id, invitation.id));
  await audit(transaction, { workspaceId: invitation.workspaceId, actorMembershipId: membership.id, type: "invitation_accepted", targetMembershipId: membership.id, details: { invitationId: String(invitation.id), reactivated: false } });
  return membership;
};

export const workspaceRouter = Router();
workspaceRouter.use(authenticate);

workspaceRouter.get("/", asyncHandler(async (_request, response) => {
  const userId = Number(response.locals.authUser.id);
  const rows = await db.select({ workspace: workspaces, membership: workspaceMemberships }).from(workspaceMemberships)
    .innerJoin(workspaces, eq(workspaceMemberships.workspaceId, workspaces.id))
    .where(and(eq(workspaceMemberships.userId, userId), eq(workspaceMemberships.isActive, true)));
  response.json({ workspaces: rows.map(({ workspace, membership }) => toPublicWorkspace(workspace, membership as { id: number; role: WorkspaceRole })) });
}));

workspaceRouter.post("/invitations/accept", asyncHandler(async (request, response) => {
  const { token } = parseBody(acceptInvitationSchema, request.body, "A valid invitation token is required.");
  const user = { id: Number(response.locals.authUser.id), email: response.locals.authUser.email };
  const membership = await db.transaction((transaction) => acceptInvitationForUser(transaction, user, token));
  response.status(201).json({ membership: { id: String(membership.id), workspaceId: String(membership.workspaceId), role: membership.role } });
}));

workspaceRouter.get("/:workspaceId/members", asyncHandler(async (request, response) => {
  const workspaceId = parseWorkspaceId(request.params.workspaceId);
  const actor = await requireWorkspaceMembership(response, workspaceId);
  requireRole(actor, "admin", "manager");
  const rows = await db.select({ membership: workspaceMemberships, user: users }).from(workspaceMemberships)
    .innerJoin(users, eq(workspaceMemberships.userId, users.id)).where(eq(workspaceMemberships.workspaceId, workspaceId));
  const pendingRows = await db.select({ membershipId: timesheetApprovalRevisions.assignedApproverMembershipId, value: count() }).from(timesheetApprovalRevisions)
    .innerJoin(workspaceMemberships, eq(timesheetApprovalRevisions.assignedApproverMembershipId, workspaceMemberships.id))
    .where(and(eq(workspaceMemberships.workspaceId, workspaceId), eq(timesheetApprovalRevisions.status, "pending")))
    .groupBy(timesheetApprovalRevisions.assignedApproverMembershipId);
  const pending = new Map(pendingRows.map((row) => [row.membershipId, Number(row.value)]));
  response.json({ members: rows.map(({ membership, user }) => ({ ...toPublicMember(membership as { id: number; userId: number; role: WorkspaceRole; isActive: boolean; joinedAt: Date }, user), ...(actor.role === "admin" ? { pendingApprovalCount: pending.get(membership.id) ?? 0 } : {}) })) });
}));

workspaceRouter.patch("/:workspaceId/members/:membershipId", asyncHandler(async (request, response) => {
  const workspaceId = parseWorkspaceId(request.params.workspaceId);
  await requireWorkspaceMembership(response, workspaceId);
  const userId = Number(response.locals.authUser.id);
  const id = parseWorkspaceId(request.params.membershipId);
  const input = parseBody(updateMemberSchema, request.body, "A valid role or access change is required.");
  const membership = await db.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(${workspaceId})`);
    const actor = await requireAdminInTransaction(transaction, workspaceId, userId);
    const [target] = await transaction.select().from(workspaceMemberships).where(and(eq(workspaceMemberships.id, id), eq(workspaceMemberships.workspaceId, workspaceId))).limit(1);
    if (!target) throw new ApiError(404, "not_found", "The requested resource was not found.");
    const nextRole = input.role ?? target.role;
    const nextActive = input.isActive ?? target.isActive;
    await assertMembershipCanChange(transaction, workspaceId, target as { id: number; role: WorkspaceRole; isActive: boolean }, nextActive ? nextRole : undefined);
    const [updated] = await transaction.update(workspaceMemberships).set({ role: nextRole, isActive: nextActive, updatedAt: new Date() }).where(eq(workspaceMemberships.id, id)).returning();
    await audit(transaction, { workspaceId, actorMembershipId: actor.id, type: target.isActive !== nextActive ? (nextActive ? "member_reactivated" : "member_deactivated") : "member_role_changed", targetMembershipId: id, details: { previousRole: target.role, nextRole, previousActive: target.isActive, nextActive } });
    return updated;
  });
  response.json({ membership: { id: String(membership.id), workspaceId: String(membership.workspaceId), role: membership.role, isActive: membership.isActive } });
}));

workspaceRouter.delete("/:workspaceId/members/:membershipId", asyncHandler(async (request, response) => {
  const workspaceId = parseWorkspaceId(request.params.workspaceId);
  await requireWorkspaceMembership(response, workspaceId);
  const userId = Number(response.locals.authUser.id);
  const id = parseWorkspaceId(request.params.membershipId);
  await db.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(${workspaceId})`);
    const actor = await requireAdminInTransaction(transaction, workspaceId, userId);
    const [target] = await transaction.select().from(workspaceMemberships).where(and(eq(workspaceMemberships.id, id), eq(workspaceMemberships.workspaceId, workspaceId))).limit(1);
    if (!target) throw new ApiError(404, "not_found", "The requested resource was not found.");
    await assertMembershipCanChange(transaction, workspaceId, target as { id: number; role: WorkspaceRole; isActive: boolean });
    await transaction.update(workspaceMemberships).set({ isActive: false, updatedAt: new Date() }).where(eq(workspaceMemberships.id, id));
    await audit(transaction, { workspaceId, actorMembershipId: actor.id, type: "member_deactivated", targetMembershipId: id, details: { previousRole: target.role } });
  });
  response.status(204).send();
}));

workspaceRouter.get("/:workspaceId/invitations", asyncHandler(async (request, response) => {
  const workspaceId = parseWorkspaceId(request.params.workspaceId);
  await requireWorkspaceMembership(response, workspaceId);
  const userId = Number(response.locals.authUser.id);
  const invitations = await db.transaction(async (transaction) => { await transaction.execute(sql`select pg_advisory_xact_lock(${workspaceId})`); await requireAdminInTransaction(transaction, workspaceId, userId); return transaction.select().from(workspaceInvitations).where(eq(workspaceInvitations.workspaceId, workspaceId)); });
  response.json({ invitations: invitations.map((invitation) => ({ id: String(invitation.id), email: invitation.email, role: invitation.role, status: invitation.status, expiresAt: invitation.expiresAt.toISOString(), createdAt: invitation.createdAt.toISOString() })) });
}));

workspaceRouter.post("/:workspaceId/invitations", asyncHandler(async (request, response) => {
  const workspaceId = parseWorkspaceId(request.params.workspaceId);
  await requireWorkspaceMembership(response, workspaceId);
  const userId = Number(response.locals.authUser.id);
  const input = parseBody(createInvitationSchema, request.body, "A valid invitation email and role are required.");
  const idempotencyKey = parseIdempotencyKey(request);
  const requestFingerprint = fingerprintRequest(input);
  type InvitationResponse = {
    delivery: { status: InvitationDeliveryStatus };
    invitation: { id: string; email: string; role: WorkspaceRole; status: string; expiresAt: string; token: string; acceptUrl: string };
  };
  const operation = await db.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(${workspaceId})`);
    const actor = await requireAdminInTransaction(transaction, workspaceId, userId);
    const now = new Date();
    await transaction.delete(idempotencyOperations).where(lt(idempotencyOperations.expiresAt, now));
    const [existing] = await transaction.select().from(idempotencyOperations).where(and(
      eq(idempotencyOperations.workspaceId, workspaceId),
      eq(idempotencyOperations.actorMembershipId, actor.id),
      eq(idempotencyOperations.operation, "workspace_invitation_create"),
      eq(idempotencyOperations.key, idempotencyKey),
    )).limit(1);
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) throw idempotencyKeyReused();
      if (!existing.responsePayload) throw new Error("An idempotency operation is missing its response payload");
      const cached = decryptIdempotencyResponse<InvitationResponse>(existing.responsePayload);
      if (existing.state === "completed") return { kind: "replay" as const, body: cached };
      if (existing.updatedAt.getTime() > now.getTime() - staleOperationMs) return { kind: "processing" as const };
      const failed = { ...cached, delivery: { status: "failed" as const } };
      await transaction.update(idempotencyOperations).set({ state: "completed", responseStatus: 201, responsePayload: encryptIdempotencyResponse(failed), updatedAt: now }).where(eq(idempotencyOperations.id, existing.id));
      return { kind: "replay" as const, body: failed };
    }
    const token = createInvitationToken();
    const provisionedPasswordHash = await hashPassword(createInvitationToken());
    const [workspace] = await transaction.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    const [inviter] = await transaction.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    if (!workspace || !inviter) throw new ApiError(404, "not_found", "The requested resource was not found.");
    const [alreadyMember] = await transaction.select({ id: workspaceMemberships.id }).from(workspaceMemberships).innerJoin(users, eq(workspaceMemberships.userId, users.id)).where(and(eq(workspaceMemberships.workspaceId, workspaceId), eq(users.email, input.email), eq(workspaceMemberships.isActive, true))).limit(1);
    if (alreadyMember) throw new ApiError(409, "already_workspace_member", "This email already belongs to the workspace.");
    await transaction.insert(users).values({ email: input.email, passwordHash: provisionedPasswordHash, requiresPasswordChange: true }).onConflictDoNothing({ target: users.email });
    await transaction.update(workspaceInvitations).set({ status: "revoked", revokedAt: new Date() }).where(and(eq(workspaceInvitations.workspaceId, workspaceId), eq(workspaceInvitations.email, input.email), eq(workspaceInvitations.status, "pending")));
    const [created] = await transaction.insert(workspaceInvitations).values({ workspaceId, email: input.email, role: input.role, tokenHash: hashInvitationToken(token), expiresAt: new Date(Date.now() + invitationTtlMs), invitedByMembershipId: actor.id }).returning();
    await audit(transaction, { workspaceId, actorMembershipId: actor.id, type: "member_invited", details: { email: input.email, role: input.role, invitationId: String(created.id) } });
    const acceptUrl = new URL("/login", env.webOrigin);
    acceptUrl.searchParams.set("inviteToken", token);
    const draft: InvitationResponse = {
      delivery: { status: "failed" },
      invitation: { id: String(created.id), email: created.email, role: created.role, status: created.status, expiresAt: created.expiresAt.toISOString(), token, acceptUrl: acceptUrl.toString() },
    };
    const [claimed] = await transaction.insert(idempotencyOperations).values({ workspaceId, actorMembershipId: actor.id, operation: "workspace_invitation_create", key: idempotencyKey, requestFingerprint, resourceId: created.id, responsePayload: encryptIdempotencyResponse(draft), expiresAt: new Date(now.getTime() + idempotencyTtlMs) }).returning({ id: idempotencyOperations.id });
    return { kind: "created" as const, operationId: claimed.id, invitation: created, workspaceName: workspace.name, inviterEmail: inviter.email, acceptUrl: acceptUrl.toString(), draft };
  });
  if (operation.kind === "processing") {
    response.set("Retry-After", "1");
    response.status(409).json({ error: { code: "idempotency_in_progress", message: "A request with this Idempotency-Key is still being processed." } });
    return;
  }
  if (operation.kind === "replay") {
    response.status(201).json(operation.body);
    return;
  }
  let delivery: { status: InvitationDeliveryStatus };
  try {
    delivery = await sendWorkspaceInvitation({
      recipientEmail: operation.invitation.email,
      inviterEmail: operation.inviterEmail,
      workspaceName: operation.workspaceName,
      role: input.role,
      acceptUrl: operation.acceptUrl,
      expiresAt: operation.invitation.expiresAt,
    });
  } catch (error) {
    console.error("Workspace invitation email delivery failed", { error: error instanceof Error ? error.name : "UnknownError" });
    delivery = { status: "failed" };
  }
  const body: InvitationResponse = { ...operation.draft, delivery };
  const [finalized] = await db.update(idempotencyOperations).set({ state: "completed", responseStatus: 201, responsePayload: encryptIdempotencyResponse(body), updatedAt: new Date() }).where(and(eq(idempotencyOperations.id, operation.operationId), eq(idempotencyOperations.state, "processing"))).returning({ responsePayload: idempotencyOperations.responsePayload });
  if (finalized?.responsePayload) {
    response.status(201).json(body);
    return;
  }
  const [completed] = await db.select({ responsePayload: idempotencyOperations.responsePayload }).from(idempotencyOperations).where(eq(idempotencyOperations.id, operation.operationId)).limit(1);
  if (!completed?.responsePayload) throw new Error("The invitation idempotency operation could not be finalized");
  response.status(201).json(decryptIdempotencyResponse<InvitationResponse>(completed.responsePayload));
}));
