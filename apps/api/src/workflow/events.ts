import { workflowNotifications, workspaceAuditEvents, workspaceMemberships } from "../db/schema.js";
import { db } from "../db/client.js";
import { and, eq } from "drizzle-orm";

export type WorkflowTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const notify = async (transaction: WorkflowTransaction, input: {
  workspaceId: number;
  recipientMembershipId: number;
  type: string;
  title: string;
  body: string;
  href: string;
  sourceKey: string;
}) => {
  const [recipient] = await transaction.select({ id: workspaceMemberships.id }).from(workspaceMemberships).where(and(eq(workspaceMemberships.id, input.recipientMembershipId), eq(workspaceMemberships.workspaceId, input.workspaceId), eq(workspaceMemberships.isActive, true))).limit(1);
  if (!recipient) return;
  await transaction.insert(workflowNotifications).values(input).onConflictDoNothing();
};

export const audit = async (transaction: WorkflowTransaction, input: {
  workspaceId: number;
  actorMembershipId: number | null;
  type: string;
  targetMembershipId?: number | null;
  targetProjectId?: number | null;
  details?: Record<string, unknown>;
}) => {
  await transaction.insert(workspaceAuditEvents).values({ ...input, details: input.details ?? {} });
};
