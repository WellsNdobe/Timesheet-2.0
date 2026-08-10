import { and, eq } from "drizzle-orm";
import type { Response } from "express";
import { db } from "../db/client.js";
import { workspaceMemberships } from "../db/schema.js";
import { ApiError } from "../errors.js";

export const workspaceRoles = ["admin", "manager", "member"] as const;
export type WorkspaceRole = (typeof workspaceRoles)[number];

export type WorkspaceMembership = {
  id: number;
  workspaceId: number;
  userId: number;
  role: WorkspaceRole;
  isActive: boolean;
};

export type ProjectAccess = {
  approverMembershipId: number | null;
};

export const notFound = () => new ApiError(404, "not_found", "The requested resource was not found.");
export const insufficientPermissions = () => new ApiError(403, "insufficient_permissions", "You do not have permission to perform this action.");

export const parseWorkspaceId = (value: string | string[] | undefined) => {
  const id = Number(Array.isArray(value) ? value[0] : value);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw notFound();
  }

  return id;
};

export const parseResourceId = parseWorkspaceId;

export const requireWorkspaceMembership = async (response: Response, workspaceId: number): Promise<WorkspaceMembership> => {
  const userId = Number(response.locals.authUser.id);
  const [membership] = await db
    .select({
      id: workspaceMemberships.id,
      workspaceId: workspaceMemberships.workspaceId,
      userId: workspaceMemberships.userId,
      role: workspaceMemberships.role,
      isActive: workspaceMemberships.isActive,
    })
    .from(workspaceMemberships)
    .where(and(
      eq(workspaceMemberships.workspaceId, workspaceId),
      eq(workspaceMemberships.userId, userId),
      eq(workspaceMemberships.isActive, true),
    ))
    .limit(1);

  if (!membership) {
    throw new ApiError(404, "not_found", "The requested resource was not found.");
  }

  return membership as WorkspaceMembership;
};

export const requireRole = (membership: WorkspaceMembership, ...roles: WorkspaceRole[]) => {
  if (!roles.includes(membership.role)) {
    throw insufficientPermissions();
  }
};

export const requireAdmin = (membership: WorkspaceMembership) => requireRole(membership, "admin");
export const requireManagerOrAdmin = (membership: WorkspaceMembership) => requireRole(membership, "admin", "manager");

export const requireAssignedProjectManager = (membership: WorkspaceMembership, project: ProjectAccess) => {
  if (membership.role === "admin") return;
  requireRole(membership, "manager");
  if (project.approverMembershipId !== membership.id) throw notFound();
};

export const requireAssignedApprover = (membership: WorkspaceMembership, approverMembershipId: number) => {
  requireManagerOrAdmin(membership);
  if (approverMembershipId === membership.id) return;
  if (membership.role === "admin") throw insufficientPermissions();
  throw notFound();
};
