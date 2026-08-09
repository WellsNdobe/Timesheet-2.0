import { and, count, eq, gt, isNull, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { timesheetProjectReviews, users, workspaceInvitations, workspaceMemberships, workspaces } from "../db/schema.js";
import { ApiError, asyncHandler } from "../errors.js";
import { requireRole, requireWorkspaceMembership, parseWorkspaceId, workspaceRoles, type WorkspaceRole } from "./access.js";
import { createInvitationToken, hashInvitationToken } from "./invitations.js";

const invitationTtlMs = 7 * 24 * 60 * 60 * 1_000;
const roleSchema = z.enum(workspaceRoles);
const invitationRoleSchema = z.enum(["manager", "member"]);
const createInvitationSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  role: invitationRoleSchema.default("member"),
}).strict();
const updateMemberSchema = z.object({ role: roleSchema }).strict();
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

const getTargetMembership = async (workspaceId: number, membershipId: number) => {
  const [membership] = await db.select().from(workspaceMemberships).where(and(
    eq(workspaceMemberships.id, membershipId),
    eq(workspaceMemberships.workspaceId, workspaceId),
  )).limit(1);
  if (!membership) throw new ApiError(404, "not_found", "The requested resource was not found.");
  return membership;
};

const assertMembershipCanChange = async (workspaceId: number, target: { id: number; role: WorkspaceRole }, nextRole?: WorkspaceRole) => {
  if (target.role === "admin" && nextRole !== "admin") {
    const [admins] = await db.select({ value: count() }).from(workspaceMemberships).where(and(
      eq(workspaceMemberships.workspaceId, workspaceId),
      eq(workspaceMemberships.role, "admin"),
      eq(workspaceMemberships.isActive, true),
    ));
    if (Number(admins?.value ?? 0) <= 1) {
      throw new ApiError(409, "last_admin", "A workspace must retain at least one active admin.");
    }
  }

  if (nextRole && ["admin", "manager"].includes(nextRole)) return;
  const [pending] = await db.select({ value: count() }).from(timesheetProjectReviews).where(and(
    eq(timesheetProjectReviews.approverMembershipId, target.id),
    eq(timesheetProjectReviews.status, "pending"),
  ));
  if (Number(pending?.value ?? 0) > 0) {
    throw new ApiError(409, "pending_approvals", "Reassign pending approvals before changing this member's role or access.");
  }
};

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

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

  const [existing] = await transaction.select({ id: workspaceMemberships.id, isActive: workspaceMemberships.isActive }).from(workspaceMemberships).where(and(
    eq(workspaceMemberships.workspaceId, invitation.workspaceId),
    eq(workspaceMemberships.userId, user.id),
  )).limit(1);
  if (existing?.isActive) throw new ApiError(409, "already_workspace_member", "You are already a member of this workspace.");

  if (existing) {
    const [membership] = await transaction.update(workspaceMemberships).set({ role: invitation.role, isActive: true, updatedAt: now })
      .where(eq(workspaceMemberships.id, existing.id)).returning();
    await transaction.update(workspaceInvitations).set({ status: "accepted", acceptedAt: now, acceptedByUserId: user.id }).where(eq(workspaceInvitations.id, invitation.id));
    return membership;
  }

  const [membership] = await transaction.insert(workspaceMemberships).values({
    workspaceId: invitation.workspaceId,
    userId: user.id,
    role: invitation.role,
    isActive: true,
  }).returning();
  await transaction.update(workspaceInvitations).set({ status: "accepted", acceptedAt: now, acceptedByUserId: user.id }).where(eq(workspaceInvitations.id, invitation.id));
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
  response.json({ members: rows.map(({ membership, user }) => toPublicMember(membership as { id: number; userId: number; role: WorkspaceRole; isActive: boolean; joinedAt: Date }, user)) });
}));

workspaceRouter.patch("/:workspaceId/members/:membershipId", asyncHandler(async (request, response) => {
  const workspaceId = parseWorkspaceId(request.params.workspaceId);
  const actor = await requireWorkspaceMembership(response, workspaceId);
  requireRole(actor, "admin");
  const id = parseWorkspaceId(request.params.membershipId);
  const { role } = parseBody(updateMemberSchema, request.body, "A valid workspace role is required.");
  const membership = await db.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(${workspaceId})`);
    const [target] = await transaction.select().from(workspaceMemberships).where(and(eq(workspaceMemberships.id, id), eq(workspaceMemberships.workspaceId, workspaceId))).limit(1);
    if (!target) throw new ApiError(404, "not_found", "The requested resource was not found.");
    await assertMembershipCanChange(workspaceId, target as { id: number; role: WorkspaceRole }, role);
    const [updated] = await transaction.update(workspaceMemberships).set({ role, updatedAt: new Date() }).where(eq(workspaceMemberships.id, id)).returning();
    return updated;
  });
  response.json({ membership: { id: String(membership.id), workspaceId: String(membership.workspaceId), role: membership.role, isActive: membership.isActive } });
}));

workspaceRouter.delete("/:workspaceId/members/:membershipId", asyncHandler(async (request, response) => {
  const workspaceId = parseWorkspaceId(request.params.workspaceId);
  const actor = await requireWorkspaceMembership(response, workspaceId);
  requireRole(actor, "admin");
  const id = parseWorkspaceId(request.params.membershipId);
  await db.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(${workspaceId})`);
    const [target] = await transaction.select().from(workspaceMemberships).where(and(eq(workspaceMemberships.id, id), eq(workspaceMemberships.workspaceId, workspaceId))).limit(1);
    if (!target) throw new ApiError(404, "not_found", "The requested resource was not found.");
    await assertMembershipCanChange(workspaceId, target as { id: number; role: WorkspaceRole });
    await transaction.update(workspaceMemberships).set({ isActive: false, updatedAt: new Date() }).where(eq(workspaceMemberships.id, id));
  });
  response.status(204).send();
}));

workspaceRouter.get("/:workspaceId/invitations", asyncHandler(async (request, response) => {
  const workspaceId = parseWorkspaceId(request.params.workspaceId);
  const actor = await requireWorkspaceMembership(response, workspaceId);
  requireRole(actor, "admin");
  const invitations = await db.select().from(workspaceInvitations).where(eq(workspaceInvitations.workspaceId, workspaceId));
  response.json({ invitations: invitations.map((invitation) => ({ id: String(invitation.id), email: invitation.email, role: invitation.role, status: invitation.status, expiresAt: invitation.expiresAt.toISOString(), createdAt: invitation.createdAt.toISOString() })) });
}));

workspaceRouter.post("/:workspaceId/invitations", asyncHandler(async (request, response) => {
  const workspaceId = parseWorkspaceId(request.params.workspaceId);
  const actor = await requireWorkspaceMembership(response, workspaceId);
  requireRole(actor, "admin");
  const input = parseBody(createInvitationSchema, request.body, "A valid invitation email and role are required.");
  const [alreadyMember] = await db.select({ id: workspaceMemberships.id }).from(workspaceMemberships)
    .innerJoin(users, eq(workspaceMemberships.userId, users.id))
    .where(and(eq(workspaceMemberships.workspaceId, workspaceId), eq(users.email, input.email), eq(workspaceMemberships.isActive, true))).limit(1);
  if (alreadyMember) throw new ApiError(409, "already_workspace_member", "This email already belongs to the workspace.");
  const token = createInvitationToken();
  await db.update(workspaceInvitations).set({ status: "revoked", revokedAt: new Date() }).where(and(
    eq(workspaceInvitations.workspaceId, workspaceId),
    eq(workspaceInvitations.email, input.email),
    eq(workspaceInvitations.status, "pending"),
  ));
  const [invitation] = await db.insert(workspaceInvitations).values({
    workspaceId, email: input.email, role: input.role, tokenHash: hashInvitationToken(token), expiresAt: new Date(Date.now() + invitationTtlMs), invitedByMembershipId: actor.id,
  }).returning();
  response.status(201).json({ invitation: { id: String(invitation.id), email: invitation.email, role: invitation.role, status: invitation.status, expiresAt: invitation.expiresAt.toISOString(), token } });
}));
