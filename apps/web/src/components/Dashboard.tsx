import { useCallback, useEffect, useState } from "react";
import { loadPendingApprovalCount, loadWorkspaces } from "../api/client";
import { AccessStatePage } from "../pages/AccessStatePage";
import { OverviewPage } from "../pages/OverviewPage";
import { PlaceholderPage } from "../pages/PlaceholderPage";
import { SettingsPage } from "../pages/SettingsPage";
import { TimesheetPage } from "../pages/TimesheetPage";
import type { PageKey } from "../types/navigation";
import type { WorkspaceSummary } from "../types/workspace";
import { DashboardLayout } from "./DashboardLayout";

const routes: Record<string, PageKey> = { "/": "Overview", "/time-entries": "Time entries", "/projects": "Projects", "/reports": "Reports", "/approvals": "Approvals", "/members": "Members", "/settings": "Settings" };
const paths = Object.fromEntries(Object.entries(routes).map(([path, page]) => [page, path])) as Record<PageKey, string>;

export function Dashboard({ accessToken, userEmail, path, onNavigate }: { accessToken: string; userEmail: string; path: string; onNavigate: (path: string) => void }) {
  const [state, setState] = useState<{ status: "loading" | "empty" | "error" } | { status: "ready"; workspace: WorkspaceSummary; pendingCount: number }>({ status: "loading" });
  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const { workspaces } = await loadWorkspaces(accessToken);
      if (!workspaces.length) { setState({ status: "empty" }); return; }
      const workspace = workspaces[0];
      const pendingCount = workspace.membership.role === "member" ? 0 : await loadPendingApprovalCount(workspace.id, accessToken);
      setState({ status: "ready", workspace, pendingCount });
    } catch { setState({ status: "error" }); }
  }, [accessToken]);
  useEffect(() => { void load(); }, [load]);

  if (state.status === "loading") return <AccessStatePage title="Loading your workspace" message="Checking your membership and permissions…" />;
  if (state.status === "empty") return <AccessStatePage title="No active workspace" message="Ask an Admin to invite or reactivate you in a workspace." />;
  if (state.status === "error") return <AccessStatePage title="Workspace unavailable" message="We couldn’t load your workspace. Please try again." onRetry={() => void load()} />;

  const unknownPath = routes[path] === undefined;
  const activePage = routes[path] ?? "Overview";
  const role = state.workspace.membership.role;
  const forbidden = (activePage === "Approvals" && role === "member") || (["Members", "Settings"] as PageKey[]).includes(activePage) && role !== "admin";
  return <DashboardLayout activePage={activePage} onSelectPage={(page) => onNavigate(paths[page])} workspace={state.workspace} pendingApprovalCount={state.pendingCount} userEmail={userEmail}>{(onLogTime) => {
    if (unknownPath) return <AccessStatePage title="Page not found" message="The requested page does not exist in this workspace." />;
    if (forbidden) return <AccessStatePage title="Access denied" message="Your workspace role does not allow access to this page." />;
    if (activePage === "Overview") return <OverviewPage onLogTime={onLogTime} />;
    if (activePage === "Time entries") return <TimesheetPage />;
    if (activePage === "Settings") return <SettingsPage />;
    return <PlaceholderPage page={activePage} />;
  }}</DashboardLayout>;
}
