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

export const parseWorkspaceId = (value: string) => {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new ApiError(404, "not_found", "The requested resource was not found.");
  }

  return id;
};

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
    throw new ApiError(403, "insufficient_permissions", "You do not have permission to perform this action.");
  }
};
