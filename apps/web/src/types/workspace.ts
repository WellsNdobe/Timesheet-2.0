export type WorkspaceRole = "admin" | "manager" | "member";

export type WorkspaceSummary = {
  id: string;
  name: string;
  timezone: string;
  membership: { id: string; role: WorkspaceRole };
  createdAt: string;
};
