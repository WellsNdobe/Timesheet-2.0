import { render, screen } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import type { WorkspaceRole } from "../types/workspace";
import { server } from "../test/server";
import { Dashboard } from "./Dashboard";

const workspaceHandler = (role: WorkspaceRole) => http.get("/api/workspaces", () => HttpResponse.json({ workspaces: [{ id: "1", name: "Tempo Studio", timezone: "Africa/Johannesburg", membership: { id: "10", role }, createdAt: new Date().toISOString() }] }));
const countHandler = (count = 3) => http.get("/api/workspaces/1/approvals/pending-count", () => HttpResponse.json({ count }));
const renderDashboard = (role: WorkspaceRole, path = "/") => { server.use(workspaceHandler(role), countHandler()); return render(<Dashboard accessToken="token" userEmail="maia@example.com" path={path} onNavigate={() => undefined} />); };

describe("role-aware navigation", () => {
  it("hides approval and Admin destinations from Members and denies the direct approval route", async () => {
    renderDashboard("member", "/approvals");
    expect(await screen.findByRole("heading", { name: "Access denied" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Approvals/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Members/ })).not.toBeInTheDocument();
  });

  it("shows the assigned pending count to Managers without Admin destinations", async () => {
    renderDashboard("manager");
    expect(await screen.findByLabelText("3 pending approvals")).toBeInTheDocument();
    expect(screen.getByText("Approvals")).toBeInTheDocument();
    expect(screen.queryByText("Members")).not.toBeInTheDocument();
  });

  it("shows approval and management destinations to Admins", async () => {
    renderDashboard("admin");
    expect(await screen.findByText("Approvals")).toBeInTheDocument();
    expect(screen.getByText("Members")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("renders empty and error workspace states", async () => {
    server.use(http.get("/api/workspaces", () => HttpResponse.json({ workspaces: [] })));
    const view = render(<Dashboard accessToken="token" userEmail="maia@example.com" path="/" onNavigate={() => undefined} />);
    expect(await screen.findByRole("heading", { name: "No active workspace" })).toBeInTheDocument();
    view.unmount();
    server.use(http.get("/api/workspaces", () => HttpResponse.json({ error: { code: "unavailable" } }, { status: 500 })));
    render(<Dashboard accessToken="token" userEmail="maia@example.com" path="/" onNavigate={() => undefined} />);
    expect(await screen.findByRole("heading", { name: "Workspace unavailable" })).toBeInTheDocument();
  });
});
