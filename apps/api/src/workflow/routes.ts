import { and, count, desc, eq, isNull } from "drizzle-orm";
import { Router } from "express";
import { authenticate } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { workflowNotifications, workspaceAuditEvents } from "../db/schema.js";
import { asyncHandler } from "../errors.js";
import { parseResourceId, requireAdmin, requireWorkspaceMembership } from "../workspaces/access.js";

export const workflowRouter = Router();
workflowRouter.use(authenticate);

workflowRouter.get("/workspaces/:workspaceId/notifications", asyncHandler(async (request, response) => {
  const workspaceId = parseResourceId(request.params.workspaceId);
  const actor = await requireWorkspaceMembership(response, workspaceId);
  const rows = await db.select().from(workflowNotifications).where(and(
    eq(workflowNotifications.workspaceId, workspaceId),
    eq(workflowNotifications.recipientMembershipId, actor.id),
  )).orderBy(desc(workflowNotifications.createdAt)).limit(50);
  const [unread] = await db.select({ value: count() }).from(workflowNotifications).where(and(eq(workflowNotifications.workspaceId, workspaceId), eq(workflowNotifications.recipientMembershipId, actor.id), isNull(workflowNotifications.readAt)));
  response.json({
    unreadCount: Number(unread?.value ?? 0),
    notifications: rows.map((row) => ({ ...row, id: String(row.id), workspaceId: String(row.workspaceId), recipientMembershipId: String(row.recipientMembershipId), readAt: row.readAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString() })),
  });
}));

workflowRouter.patch("/workspaces/:workspaceId/notifications/read-all", asyncHandler(async (request, response) => {
  const workspaceId = parseResourceId(request.params.workspaceId);
  const actor = await requireWorkspaceMembership(response, workspaceId);
  await db.update(workflowNotifications).set({ readAt: new Date() }).where(and(
    eq(workflowNotifications.workspaceId, workspaceId),
    eq(workflowNotifications.recipientMembershipId, actor.id),
    isNull(workflowNotifications.readAt),
  ));
  response.status(204).send();
}));

workflowRouter.patch("/workspaces/:workspaceId/notifications/:notificationId/read", asyncHandler(async (request, response) => {
  const workspaceId = parseResourceId(request.params.workspaceId);
  const notificationId = parseResourceId(request.params.notificationId);
  const actor = await requireWorkspaceMembership(response, workspaceId);
  const [updated] = await db.update(workflowNotifications).set({ readAt: new Date() }).where(and(
    eq(workflowNotifications.id, notificationId),
    eq(workflowNotifications.workspaceId, workspaceId),
    eq(workflowNotifications.recipientMembershipId, actor.id),
  )).returning({ id: workflowNotifications.id });
  if (!updated) return response.status(404).json({ error: { code: "not_found", message: "The requested resource was not found." } });
  response.status(204).send();
}));

workflowRouter.get("/workspaces/:workspaceId/audit-events", asyncHandler(async (request, response) => {
  const workspaceId = parseResourceId(request.params.workspaceId);
  const actor = await requireWorkspaceMembership(response, workspaceId);
  requireAdmin(actor);
  const rows = await db.select().from(workspaceAuditEvents).where(eq(workspaceAuditEvents.workspaceId, workspaceId)).orderBy(desc(workspaceAuditEvents.createdAt)).limit(100);
  response.json({ events: rows.map((row) => ({ ...row, id: String(row.id), workspaceId: String(row.workspaceId), actorMembershipId: row.actorMembershipId == null ? null : String(row.actorMembershipId), targetMembershipId: row.targetMembershipId == null ? null : String(row.targetMembershipId), targetProjectId: row.targetProjectId == null ? null : String(row.targetProjectId), createdAt: row.createdAt.toISOString() })) });
}));
