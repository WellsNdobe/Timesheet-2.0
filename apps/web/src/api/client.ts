import type { WorkspaceRole, WorkspaceSummary } from "../types/workspace";

type ApiErrorBody = { error?: { code?: string; message?: string } };
export type MemberIdentity = { id: string; email: string; role: WorkspaceRole; isActive: boolean };
export type ApprovalStatus = "pending" | "approved" | "changes_requested" | "withdrawn";
export type ApprovalSummary = { id: string; revisionId: string; revisionNumber: number; status: ApprovalStatus; submittedMinutes: number; submittedAt: string; resolvedAt: string | null; returnComment: string | null; project: { id: string; name: string }; weekStart: string; submitter: MemberIdentity | null; assignedApprover: MemberIdentity | null };
export type ReviewEntry = { id: string; revisionId: string; sourceEntryId: string; taskId: string | null; taskName: string | null; workDate: string; durationMinutes: number; description: string | null; isBillable: boolean };
export type ApprovalRevision = { id: string; revisionNumber: number; status: ApprovalStatus; projectName: string; submittedMinutes: number; submittedAt: string; resolvedAt: string | null; returnComment: string | null; assignedApprover: MemberIdentity | null; resolvedBy: MemberIdentity | null; entries: ReviewEntry[]; diff: { added: ReviewEntry[]; removed: ReviewEntry[]; changed: { before: ReviewEntry; after: ReviewEntry }[] }; events: { id: string; type: string; comment: string | null; internalReason?: string | null; actor: MemberIdentity | null; previousApprover: MemberIdentity | null; nextApprover: MemberIdentity | null; createdAt: string }[] };
export type ApprovalDetail = { id: string; weekStart: string; submitter: MemberIdentity | null; project: { id: string; name: string }; latestRevision: Omit<ApprovalRevision, "entries" | "diff" | "events" | "assignedApprover" | "resolvedBy"> & { assignedApproverMembershipId: string }; revisions: ApprovalRevision[] };
export type WorkspaceMember = MemberIdentity & { userId: string; joinedAt: string; pendingApprovalCount: number };
export type Client = { id: string; workspaceId: string; name: string; isArchived: boolean; createdAt: string; updatedAt: string };
export type ProjectBudgetProgress = { hoursPercent: number | null; moneyPercent: number | null; attention: "on_track" | "attention" | "over" };
export type ProjectCommercial = { hourlyRateCents: number | null; rateCurrency: string | null; budgetHours: number | null; budgetCents: number | null; budgetCurrency: string | null; usedHours: number; billableHours: number; billableValueCents: number | null; valuesByCurrency?: Record<string, number>; unpricedMinutes?: number; legacyMinutes?: number };
export type Project = { id: string; workspaceId: string; name: string; clientId: string | null; client: Client | null; approverMembershipId: string | null; approver: MemberIdentity | null; isArchived: boolean; submissionReady: boolean; budgetProgress?: ProjectBudgetProgress; commercial?: ProjectCommercial; createdAt: string; updatedAt: string };
export type WeekStatus = { weekStart: string; status: string; portions: { approvalItemId: string; project: { id: string; name: string }; revisionNumber: number; status: ApprovalStatus; submittedMinutes: number; returnComment: string | null; assignedApprover: MemberIdentity | null; editable: boolean }[] };
export type TimeEntry = { id: string; projectId: string; taskId: string | null; workDate: string; durationMinutes: number; description: string | null; isBillable: boolean };
export type TimeEntryWeek = { weekStart: string; entries: TimeEntry[]; totalMinutes: number; billableMinutes: number; status: string };
export type TimeException = { id: string; membershipId: string | null; workDate: string; type: "public_holiday" | "leave"; name: string; durationMinutes: number };
export type WeekCompleteness = { weekStart: string; expectedWeeklyMinutes: number; expectedMinutes: number; loggedMinutes: number; exceptionMinutes: number; remainingMinutes: number; readyToSubmit: boolean; missingWorkingDays: { workDate: string; expectedMinutes: number; loggedMinutes: number; exceptionMinutes: number; missingMinutes: number; exceptions: TimeException[] }[]; workingDays: { workDate: string; expectedMinutes: number; loggedMinutes: number; exceptionMinutes: number; missingMinutes: number; exceptions: TimeException[] }[] };
export type WorkflowNotification = { id: string; type: string; title: string; body: string; href: string; readAt: string | null; createdAt: string };
export type AuditEvent = { id: string; type: string; actorMembershipId: string | null; targetMembershipId: string | null; targetProjectId: string | null; details: Record<string, unknown>; createdAt: string };
export type ReportStatus = "not_submitted" | "pending" | "approved" | "changes_requested" | "withdrawn";
export type ReportData = { dateFrom: string; dateTo: string; summary: { totalMinutes: number; billableMinutes: number; entryCount: number; approval: Record<string, number> }; daily: { workDate: string; totalMinutes: number; billableMinutes: number }[]; projects: { id: string; name: string; totalMinutes: number; billableMinutes: number }[]; members: { id: string; email: string }[]; entries: { id: string; workDate: string; durationMinutes: number; isBillable: boolean; description: string | null; project: { id: string; name: string }; member: { id: string; email: string }; approvalStatus: ReportStatus }[] };

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
export const inviteMember = (id: string, email: string, role: "manager" | "member", idempotencyKey: string, token: string) => apiRequest<{ delivery: { status: "sent" | "queued" | "disabled" | "failed" }; invitation: { id: string; email: string; role: string; token: string; acceptUrl: string; expiresAt: string } }>(`/api/workspaces/${id}/invitations`, token, { ...json("POST", { email, role }), headers: { "Idempotency-Key": idempotencyKey } });
export const loadProjects = async (id: string, token: string, includeArchived = false) => (await apiRequest<{ projects: Project[] }>(`/api/workspaces/${id}/projects${includeArchived ? "?includeArchived=true" : ""}`, token)).projects;
export type ProjectChanges = { name?: string; approverMembershipId?: string | null; isArchived?: boolean; clientId?: string | null; hourlyRateCents?: number | null; rateCurrency?: string | null; rateEffectiveFrom?: string; budgetHours?: number | null; budgetCents?: number | null; budgetCurrency?: string | null };
export const createProject = (id: string, changes: Required<Pick<ProjectChanges, "name">> & ProjectChanges, idempotencyKey: string, token: string) => apiRequest<{ project: Project }>(`/api/workspaces/${id}/projects`, token, { ...json("POST", changes), headers: { "Idempotency-Key": idempotencyKey } });
export const updateProject = (id: string, projectId: string, changes: ProjectChanges, token: string) => apiRequest(`/api/workspaces/${id}/projects/${projectId}`, token, json("PATCH", changes));
export const loadClients = async (id: string, token: string, includeArchived = false) => (await apiRequest<{ clients: Client[] }>(`/api/workspaces/${id}/clients${includeArchived ? "?includeArchived=true" : ""}`, token)).clients;
export const createClient = (id: string, name: string, token: string) => apiRequest<{ client: Client }>(`/api/workspaces/${id}/clients`, token, json("POST", { name }));
export const updateClient = (id: string, clientId: string, changes: { name?: string; isArchived?: boolean }, token: string) => apiRequest<{ client: Client }>(`/api/workspaces/${id}/clients/${clientId}`, token, json("PATCH", changes));
export const loadWeekStatus = (id: string, week: string, token: string) => apiRequest<WeekStatus>(`/api/workspaces/${id}/timesheets/${week}/status`, token);
export const loadWeekCompleteness = (id: string, week: string, token: string) => apiRequest<WeekCompleteness>(`/api/workspaces/${id}/timesheets/${week}/completeness`, token);
export const loadTimePolicy = (id: string, token: string) => apiRequest<{ expectedWeeklyMinutes: number; canManage: boolean }>(`/api/workspaces/${id}/time-policy`, token);
export const updateTimePolicy = (id: string, expectedWeeklyMinutes: number, token: string) => apiRequest<{ expectedWeeklyMinutes: number }>(`/api/workspaces/${id}/time-policy`, token, json("PUT", { expectedWeeklyMinutes }));
export const loadTimeExceptions = async (id: string, token: string) => (await apiRequest<{ exceptions: TimeException[] }>(`/api/workspaces/${id}/time-exceptions`, token)).exceptions;
export const createTimeException = (id: string, exception: { type: "public_holiday"; workDate: string; name: string; durationMinutes: number } | { type: "leave"; membershipId: string; workDate: string; name: string; durationMinutes: number }, token: string) => apiRequest<{ exception: TimeException }>(`/api/workspaces/${id}/time-exceptions`, token, json("POST", exception));
export const deleteTimeException = (id: string, exceptionId: string, token: string) => apiRequest<void>(`/api/workspaces/${id}/time-exceptions/${exceptionId}`, token, json("DELETE"));
export const submitTimesheet = (id: string, week: string, token: string) => apiRequest(`/api/workspaces/${id}/timesheets/${week}/submit`, token, json("POST", {}));
export const loadTimeEntries = (id: string, week: string, token: string) => apiRequest<TimeEntryWeek>(`/api/workspaces/${id}/time-entries?weekStart=${week}`, token);
export const createTimeEntry = (id: string, entry: Omit<TimeEntry, "id">, token: string) => apiRequest<{ entry: TimeEntry }>(`/api/workspaces/${id}/time-entries`, token, json("POST", entry));
export const updateTimeEntry = (id: string, entryId: string, changes: Partial<Omit<TimeEntry, "id">>, token: string) => apiRequest<{ entry: TimeEntry }>(`/api/workspaces/${id}/time-entries/${entryId}`, token, json("PATCH", changes));
export const deleteTimeEntry = (id: string, entryId: string, token: string) => apiRequest<void>(`/api/workspaces/${id}/time-entries/${entryId}`, token, json("DELETE"));
export const loadNotifications = (id: string, token: string) => apiRequest<{ unreadCount: number; notifications: WorkflowNotification[] }>(`/api/workspaces/${id}/notifications`, token);
export const markNotificationRead = (id: string, notificationId: string, token: string) => apiRequest<void>(`/api/workspaces/${id}/notifications/${notificationId}/read`, token, json("PATCH"));
export const markAllNotificationsRead = (id: string, token: string) => apiRequest<void>(`/api/workspaces/${id}/notifications/read-all`, token, json("PATCH"));
export const loadAuditEvents = async (id: string, token: string) => (await apiRequest<{ events: AuditEvent[] }>(`/api/workspaces/${id}/audit-events`, token)).events;
export const loadReport = (id: string, filters: { dateFrom?: string; dateTo?: string; projectId?: string; memberId?: string; approvalStatus?: ReportStatus }, token: string) => { const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value).map(([key, value]) => [key, value as string])); return apiRequest<ReportData>(`/api/workspaces/${id}/reports${query.size ? `?${query}` : ""}`, token); };
