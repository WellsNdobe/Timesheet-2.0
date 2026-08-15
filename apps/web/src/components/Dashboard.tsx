import { useCallback, useEffect, useState } from "react";
import { loadPendingApprovalCount, loadWorkspaces } from "../api/client";
import { AccessStatePage } from "../pages/AccessStatePage";
import { ApprovalsPage } from "../pages/ApprovalsPage";
import { MembersPage } from "../pages/MembersPage";
import { OverviewPage } from "../pages/OverviewPage";
import { PlaceholderPage } from "../pages/PlaceholderPage";
import { ProjectsPage } from "../pages/ProjectsPage";
import { SettingsPage } from "../pages/SettingsPage";
import { TimesheetPage } from "../pages/TimesheetPage";
import type { PageKey } from "../types/navigation";
import type { WorkspaceSummary } from "../types/workspace";
import { DashboardLayout } from "./DashboardLayout";

const routes: Record<string, PageKey> = { "/": "Overview", "/time-entries": "Time entries", "/projects": "Projects", "/reports": "Reports", "/approvals": "Approvals", "/members": "Members", "/settings": "Settings" };
const paths = Object.fromEntries(Object.entries(routes).map(([path, page]) => [page, path])) as Record<PageKey, string>;
type State = { status: "loading" | "empty" | "error" } | { status: "ready"; workspace: WorkspaceSummary; pendingCount: number };

export function Dashboard({ accessToken, userEmail, path, onNavigate }: { accessToken: string; userEmail: string; path: string; onNavigate: (path: string) => void }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const load = useCallback(async () => { setState({ status: "loading" }); try { const { workspaces } = await loadWorkspaces(accessToken); if (!workspaces.length) return setState({ status: "empty" }); const workspace = workspaces[0]; const pendingCount = workspace.membership.role === "member" ? 0 : await loadPendingApprovalCount(workspace.id, accessToken); setState({ status: "ready", workspace, pendingCount }); } catch { setState({ status: "error" }); } }, [accessToken]);
  useEffect(() => { void load(); }, [load]);
  const updatePendingCount = useCallback((count: number) => setState((current) => current.status === "ready" ? { ...current, pendingCount: count < 0 ? Math.max(0, current.pendingCount + count) : count } : current), []);
  const readyWorkspaceId = state.status === "ready" ? state.workspace.id : null; const readyRole = state.status === "ready" ? state.workspace.membership.role : null;
  useEffect(() => { if (!readyWorkspaceId || readyRole === "member") return; const refresh = async () => { try { updatePendingCount(await loadPendingApprovalCount(readyWorkspaceId, accessToken)); } catch { /* Retain the last known count. */ } }; const onFocus = () => void refresh(); window.addEventListener("focus", onFocus); const timer = window.setInterval(() => void refresh(), 60_000); return () => { window.removeEventListener("focus", onFocus); window.clearInterval(timer); }; }, [accessToken, readyRole, readyWorkspaceId, updatePendingCount]);

  if (state.status === "loading") return <AccessStatePage title="Loading your workspace" message="Checking your membership and permissions..." />;
  if (state.status === "empty") return <AccessStatePage title="No active workspace" message="Ask an Admin to invite or reactivate you in a workspace." />;
  if (state.status === "error") return <AccessStatePage title="Workspace unavailable" message="We could not load your workspace. Please try again." onRetry={() => void load()} />;
  const pathname = path.split("?")[0]; const approvalMatch = pathname.match(/^\/approvals\/([^/]+)$/); const unknownPath = routes[pathname] === undefined && !approvalMatch; const activePage = approvalMatch ? "Approvals" : routes[pathname] ?? "Overview"; const role = state.workspace.membership.role;
  const forbidden = (activePage === "Approvals" && role === "member") || (["Members", "Settings"] as PageKey[]).includes(activePage) && role !== "admin";
  return <DashboardLayout activePage={activePage} onSelectPage={(page) => onNavigate(paths[page])} onNavigate={onNavigate} accessToken={accessToken} workspace={state.workspace} pendingApprovalCount={state.pendingCount} userEmail={userEmail}>{(onLogTime) => {
    if (unknownPath) return <AccessStatePage title="Page not found" message="The requested page does not exist in this workspace." />;
    if (forbidden) return <AccessStatePage title="Access denied" message="Your workspace role does not allow access to this page." />;
    if (activePage === "Overview") return <OverviewPage onLogTime={onLogTime} />;
    if (activePage === "Time entries") return <TimesheetPage workspace={state.workspace} accessToken={accessToken} />;
    if (activePage === "Approvals") return <ApprovalsPage workspace={state.workspace} accessToken={accessToken} approvalId={approvalMatch?.[1]} onNavigate={onNavigate} onPendingCountChange={updatePendingCount} />;
    if (activePage === "Members") return <MembersPage workspace={state.workspace} accessToken={accessToken} onNavigate={onNavigate} />;
    if (activePage === "Projects") return <ProjectsPage workspace={state.workspace} accessToken={accessToken} />;
    if (activePage === "Settings") return <SettingsPage />;
    return <PlaceholderPage page={activePage} />;
  }}</DashboardLayout>;
}
