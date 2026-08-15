import { and, count, eq, gt, isNull, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { timesheetApprovalRevisions, users, workspaceInvitations, workspaceMemberships, workspaces } from "../db/schema.js";
import { env } from "../config.js";
import { sendWorkspaceInvitation, type InvitationDeliveryStatus } from "../email/sendWorkspaceInvitation.js";
import { ApiError, asyncHandler } from "../errors.js";
import { requireRole, requireWorkspaceMembership, parseWorkspaceId, workspaceRoles, type WorkspaceMembership, type WorkspaceRole } from "./access.js";
import { createInvitationToken, hashInvitationToken } from "./invitations.js";
import { audit } from "../workflow/events.js";

const invitationTtlMs = 7 * 24 * 60 * 60 * 1_000;
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
  const token = createInvitationToken();
  const invitationContext = await db.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(${workspaceId})`);
    const actor = await requireAdminInTransaction(transaction, workspaceId, userId);
    const [workspace] = await transaction.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    const [inviter] = await transaction.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    if (!workspace || !inviter) throw new ApiError(404, "not_found", "The requested resource was not found.");
    const [alreadyMember] = await transaction.select({ id: workspaceMemberships.id }).from(workspaceMemberships).innerJoin(users, eq(workspaceMemberships.userId, users.id)).where(and(eq(workspaceMemberships.workspaceId, workspaceId), eq(users.email, input.email), eq(workspaceMemberships.isActive, true))).limit(1);
    if (alreadyMember) throw new ApiError(409, "already_workspace_member", "This email already belongs to the workspace.");
    await transaction.update(workspaceInvitations).set({ status: "revoked", revokedAt: new Date() }).where(and(eq(workspaceInvitations.workspaceId, workspaceId), eq(workspaceInvitations.email, input.email), eq(workspaceInvitations.status, "pending")));
    const [created] = await transaction.insert(workspaceInvitations).values({ workspaceId, email: input.email, role: input.role, tokenHash: hashInvitationToken(token), expiresAt: new Date(Date.now() + invitationTtlMs), invitedByMembershipId: actor.id }).returning();
    await audit(transaction, { workspaceId, actorMembershipId: actor.id, type: "member_invited", details: { email: input.email, role: input.role, invitationId: String(created.id) } });
    return { invitation: created, workspaceName: workspace.name, inviterEmail: inviter.email };
  });
  const acceptUrl = new URL("/signup", env.webOrigin);
  acceptUrl.searchParams.set("inviteToken", token);
  let delivery: { status: InvitationDeliveryStatus };
  try {
    delivery = await sendWorkspaceInvitation({
      recipientEmail: invitationContext.invitation.email,
      inviterEmail: invitationContext.inviterEmail,
      workspaceName: invitationContext.workspaceName,
      role: input.role,
      acceptUrl: acceptUrl.toString(),
      expiresAt: invitationContext.invitation.expiresAt,
    });
  } catch (error) {
    console.error("Workspace invitation email delivery failed", { error: error instanceof Error ? error.name : "UnknownError" });
    delivery = { status: "failed" };
  }
  const invitation = invitationContext.invitation;
  response.status(201).json({
    delivery,
    invitation: { id: String(invitation.id), email: invitation.email, role: invitation.role, status: invitation.status, expiresAt: invitation.expiresAt.toISOString(), token, acceptUrl: acceptUrl.toString() },
  });
}));
