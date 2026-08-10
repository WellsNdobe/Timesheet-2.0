import type { WorkspaceSummary } from "../types/workspace";

type ApiErrorBody = { error?: { code?: string; message?: string } };

export class ApiClientError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code);
  }
}

export async function apiRequest<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetch(path, { credentials: "include", headers: { Authorization: `Bearer ${accessToken}` } });
  const body = await response.json() as T & ApiErrorBody;
  if (!response.ok) throw new ApiClientError(response.status, body.error?.code ?? "request_failed");
  return body;
}

export const loadWorkspaces = (accessToken: string) => apiRequest<{ workspaces: WorkspaceSummary[] }>("/api/workspaces", accessToken);
export const loadPendingApprovalCount = async (workspaceId: string, accessToken: string) => {
  const body = await apiRequest<{ count: number }>(`/api/workspaces/${workspaceId}/approvals/pending-count`, accessToken);
  return body.count;
};
