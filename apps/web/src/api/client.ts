import type { WorkspaceRole, WorkspaceSummary } from "../types/workspace";

type ApiErrorBody = { error?: { code?: string; message?: string } };
export type MemberIdentity = { id: string; email: string; role: WorkspaceRole; isActive: boolean };
export type ApprovalStatus = "pending" | "approved" | "changes_requested" | "withdrawn";
export type ApprovalSummary = { id: string; revisionId: string; revisionNumber: number; status: ApprovalStatus; submittedMinutes: number; submittedAt: string; resolvedAt: string | null; returnComment: string | null; project: { id: string; name: string }; weekStart: string; submitter: MemberIdentity | null; assignedApprover: MemberIdentity | null };
export type ReviewEntry = { id: string; revisionId: string; sourceEntryId: string; taskId: string | null; taskName: string | null; workDate: string; durationMinutes: number; description: string | null; isBillable: boolean };
export type ApprovalRevision = { id: string; revisionNumber: number; status: ApprovalStatus; projectName: string; submittedMinutes: number; submittedAt: string; resolvedAt: string | null; returnComment: string | null; assignedApprover: MemberIdentity | null; resolvedBy: MemberIdentity | null; entries: ReviewEntry[]; diff: { added: ReviewEntry[]; removed: ReviewEntry[]; changed: { before: ReviewEntry; after: ReviewEntry }[] }; events: { id: string; type: string; comment: string | null; internalReason?: string | null; actor: MemberIdentity | null; previousApprover: MemberIdentity | null; nextApprover: MemberIdentity | null; createdAt: string }[] };
export type ApprovalDetail = { id: string; weekStart: string; submitter: MemberIdentity | null; project: { id: string; name: string }; latestRevision: Omit<ApprovalRevision, "entries" | "diff" | "events" | "assignedApprover" | "resolvedBy"> & { assignedApproverMembershipId: string }; revisions: ApprovalRevision[] };
export type WorkspaceMember = MemberIdentity & { userId: string; joinedAt: string; pendingApprovalCount: number };
export type Project = { id: string; workspaceId: string; name: string; approverMembershipId: string | null; approver: MemberIdentity | null; isArchived: boolean; submissionReady: boolean; createdAt: string; updatedAt: string };
export type WeekStatus = { weekStart: string; status: string; portions: { approvalItemId: string; project: { id: string; name: string }; revisionNumber: number; status: ApprovalStatus; submittedMinutes: number; returnComment: string | null; assignedApprover: MemberIdentity | null; editable: boolean }[] };
export type TimeEntry = { id: string; projectId: string; taskId: string | null; workDate: string; durationMinutes: number; description: string | null; isBillable: boolean };
export type TimeEntryWeek = { weekStart: string; entries: TimeEntry[]; totalMinutes: number; billableMinutes: number; status: string };
export type WorkflowNotification = { id: string; type: string; title: string; body: string; href: string; readAt: string | null; createdAt: string };
export type AuditEvent = { id: string; type: string; actorMembershipId: string | null; targetMembershipId: string | null; targetProjectId: string | null; details: Record<string, unknown>; createdAt: string };

export class ApiClientError extends Error {
  constructor(public readonly status: number, public readonly code: string, message?: string) { super(message ?? code); }
}

export async function apiRequest<T>(path: string, accessToken: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, credentials: "include", headers: { Authorization: `Bearer ${accessToken}`, ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers } });
  if (response.status === 204) { if (!response.ok) throw new ApiClientError(response.status, "request_failed"); return undefined as T; }
  const body = await response.json() as T & ApiErrorBody;
  if (!response.ok) throw new ApiClientError(response.status, body.error?.code ?? "request_failed", body.error?.message);
  return body;
}

const json = (method: string, body?: unknown): RequestInit => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
export const loadWorkspaces = (token: string) => apiRequest<{ workspaces: WorkspaceSummary[] }>("/api/workspaces", token);
export const loadPendingApprovalCount = async (id: string, token: string) => (await apiRequest<{ count: number }>(`/api/workspaces/${id}/approvals/pending-count`, token)).count;
export const loadApprovals = async (id: string, token: string) => (await apiRequest<{ approvals: ApprovalSummary[] }>(`/api/workspaces/${id}/approvals`, token)).approvals;
export const loadApproval = async (id: string, approvalId: string, token: string) => (await apiRequest<{ approval: ApprovalDetail }>(`/api/workspaces/${id}/approval-items/${approvalId}`, token)).approval;
export const decideApproval = (id: string, approvalId: string, revisionId: string, action: "approve" | "request-changes" | "transfer" | "approve-as-admin", body: unknown, token: string) => apiRequest(`/api/workspaces/${id}/approval-items/${approvalId}/revisions/${revisionId}/${action}`, token, json("POST", body));
export const loadMembers = async (id: string, token: string) => (await apiRequest<{ members: WorkspaceMember[] }>(`/api/workspaces/${id}/members`, token)).members;
export const updateMember = (id: string, memberId: string, changes: { role?: WorkspaceRole; isActive?: boolean }, token: string) => apiRequest(`/api/workspaces/${id}/members/${memberId}`, token, json("PATCH", changes));
export const inviteMember = (id: string, email: string, role: "manager" | "member", token: string) => apiRequest<{ delivery: { status: "sent" | "queued" | "disabled" | "failed" }; invitation: { id: string; email: string; role: string; token: string; acceptUrl: string; expiresAt: string } }>(`/api/workspaces/${id}/invitations`, token, json("POST", { email, role }));
export const loadProjects = async (id: string, token: string, includeArchived = false) => (await apiRequest<{ projects: Project[] }>(`/api/workspaces/${id}/projects${includeArchived ? "?includeArchived=true" : ""}`, token)).projects;
export const createProject = (id: string, name: string, approverMembershipId: string | null, token: string) => apiRequest<{ project: Project }>(`/api/workspaces/${id}/projects`, token, json("POST", { name, approverMembershipId }));
export const updateProject = (id: string, projectId: string, changes: { name?: string; approverMembershipId?: string | null; isArchived?: boolean }, token: string) => apiRequest(`/api/workspaces/${id}/projects/${projectId}`, token, json("PATCH", changes));
export const loadWeekStatus = (id: string, week: string, token: string) => apiRequest<WeekStatus>(`/api/workspaces/${id}/timesheets/${week}/status`, token);
export const submitTimesheet = (id: string, week: string, token: string) => apiRequest(`/api/workspaces/${id}/timesheets/${week}/submit`, token, json("POST", {}));
export const loadTimeEntries = (id: string, week: string, token: string) => apiRequest<TimeEntryWeek>(`/api/workspaces/${id}/time-entries?weekStart=${week}`, token);
export const createTimeEntry = (id: string, entry: Omit<TimeEntry, "id">, token: string) => apiRequest<{ entry: TimeEntry }>(`/api/workspaces/${id}/time-entries`, token, json("POST", entry));
export const updateTimeEntry = (id: string, entryId: string, changes: Partial<Omit<TimeEntry, "id">>, token: string) => apiRequest<{ entry: TimeEntry }>(`/api/workspaces/${id}/time-entries/${entryId}`, token, json("PATCH", changes));
export const deleteTimeEntry = (id: string, entryId: string, token: string) => apiRequest<void>(`/api/workspaces/${id}/time-entries/${entryId}`, token, json("DELETE"));
export const loadNotifications = (id: string, token: string) => apiRequest<{ unreadCount: number; notifications: WorkflowNotification[] }>(`/api/workspaces/${id}/notifications`, token);
export const markNotificationRead = (id: string, notificationId: string, token: string) => apiRequest<void>(`/api/workspaces/${id}/notifications/${notificationId}/read`, token, json("PATCH"));
export const markAllNotificationsRead = (id: string, token: string) => apiRequest<void>(`/api/workspaces/${id}/notifications/read-all`, token, json("PATCH"));
export const loadAuditEvents = async (id: string, token: string) => (await apiRequest<{ events: AuditEvent[] }>(`/api/workspaces/${id}/audit-events`, token)).events;
