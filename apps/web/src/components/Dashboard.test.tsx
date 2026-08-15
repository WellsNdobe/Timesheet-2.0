import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceRole } from "../types/workspace";
import { server } from "../test/server";
import { Dashboard } from "./Dashboard";

const workspaceHandler = (role: WorkspaceRole) => http.get("/api/workspaces", () => HttpResponse.json({ workspaces: [{ id: "1", name: "Tempo Studio", timezone: "Africa/Johannesburg", membership: { id: "10", role }, createdAt: new Date().toISOString() }] }));
const countHandler = (count = 3) => http.get("/api/workspaces/1/approvals/pending-count", () => HttpResponse.json({ count }));
const notificationHandler = () => http.get("/api/workspaces/1/notifications", () => HttpResponse.json({ unreadCount: 0, notifications: [] }));
const renderDashboard = (role: WorkspaceRole, path = "/") => { server.use(workspaceHandler(role), countHandler(), notificationHandler()); return render(<Dashboard accessToken="token" userEmail="maia@example.com" path={path} onNavigate={() => undefined} />); };

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

describe("workflow notifications", () => {
  it("shows unread state, marks a notification read, and follows its exact permitted link", async () => {
    const onNavigate = vi.fn();
    server.use(
      workspaceHandler("manager"),
      countHandler(1),
      http.get("/api/workspaces/1/notifications", () => HttpResponse.json({ unreadCount: 1, notifications: [{ id: "91", type: "submission", title: "Timesheet ready for review", body: "Atlas · week of 2026-08-03", href: "/approvals/101", readAt: null, createdAt: "2026-08-05T08:00:00.000Z" }] })),
      http.patch("/api/workspaces/1/notifications/91/read", () => new HttpResponse(null, { status: 204 })),
    );
    const user = userEvent.setup();
    render(<Dashboard accessToken="token" userEmail="maia@example.com" path="/" onNavigate={onNavigate} />);

    await user.click(await screen.findByRole("button", { name: "Notifications" }));
    expect(screen.getByText("1 unread")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Timesheet ready for review/ }));
    expect(onNavigate).toHaveBeenCalledWith("/approvals/101");
  });

  it("marks all current notifications read without navigating", async () => {
    const onNavigate = vi.fn();
    server.use(
      workspaceHandler("admin"),
      countHandler(0),
      http.get("/api/workspaces/1/notifications", () => HttpResponse.json({ unreadCount: 2, notifications: [
        { id: "91", type: "submission", title: "First", body: "Atlas", href: "/approvals/101", readAt: null, createdAt: "2026-08-05T08:00:00.000Z" },
        { id: "92", type: "transfer", title: "Second", body: "Beacon", href: "/approvals/102", readAt: null, createdAt: "2026-08-05T09:00:00.000Z" },
      ] })),
      http.patch("/api/workspaces/1/notifications/read-all", () => new HttpResponse(null, { status: 204 })),
    );
    const user = userEvent.setup();
    render(<Dashboard accessToken="token" userEmail="maia@example.com" path="/" onNavigate={onNavigate} />);
    await user.click(await screen.findByRole("button", { name: "Notifications" }));
    await user.click(screen.getByRole("button", { name: "Mark all read" }));
    expect(screen.getByText("0 unread")).toBeInTheDocument();
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
