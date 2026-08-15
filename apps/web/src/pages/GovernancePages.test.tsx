import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../test/server";
import type { WorkspaceSummary } from "../types/workspace";
import { MembersPage } from "./MembersPage";
import { ProjectsPage } from "./ProjectsPage";

const adminWorkspace: WorkspaceSummary = { id: "1", name: "Tempo Studio", timezone: "Africa/Johannesburg", membership: { id: "10", role: "admin" }, createdAt: "2026-08-01T00:00:00.000Z" };
const managerWorkspace: WorkspaceSummary = { ...adminWorkspace, membership: { id: "20", role: "manager" } };
const members = [
  { id: "10", userId: "1", email: "admin@example.com", role: "admin" as const, isActive: true, joinedAt: "2026-08-01T00:00:00.000Z", pendingApprovalCount: 0 },
  { id: "20", userId: "2", email: "manager@example.com", role: "manager" as const, isActive: true, joinedAt: "2026-08-01T00:00:00.000Z", pendingApprovalCount: 2 },
  { id: "30", userId: "3", email: "inactive@example.com", role: "manager" as const, isActive: false, joinedAt: "2026-08-01T00:00:00.000Z", pendingApprovalCount: 0 },
  { id: "40", userId: "4", email: "member@example.com", role: "member" as const, isActive: true, joinedAt: "2026-08-01T00:00:00.000Z", pendingApprovalCount: 0 },
];

describe("member governance", () => {
  it("shows pending ownership and explains why deactivation is blocked", async () => {
    server.use(
      http.get("/api/workspaces/1/members", () => HttpResponse.json({ members })),
      http.get("/api/workspaces/1/audit-events", () => HttpResponse.json({ events: [] })),
      http.patch("/api/workspaces/1/members/20", () => HttpResponse.json({ error: { code: "pending_approvals", message: "Transfer pending approvals first." } }, { status: 409 })),
    );
    const user = userEvent.setup();
    render(<MembersPage workspace={adminWorkspace} accessToken="token" />);

    const row = (await screen.findByText("manager@example.com")).closest("tr")!;
    expect(within(row).getByText("2 · transfer first")).toBeInTheDocument();
    await user.click(within(row).getByRole("button", { name: "Deactivate" }));
    expect(await screen.findByText("manager@example.com has 2 pending approval(s). Transfer them before changing access.")).toBeInTheDocument();
  });

  it("limits invitation roles and offers recovery when governance data fails", async () => {
    server.use(
      http.get("/api/workspaces/1/members", () => HttpResponse.json({ members: [] })),
      http.get("/api/workspaces/1/audit-events", () => HttpResponse.json({ error: { code: "unavailable" } }, { status: 500 })),
    );
    const user = userEvent.setup();
    const view = render(<MembersPage workspace={adminWorkspace} accessToken="token" />);
    expect(await screen.findByText("Members unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    view.unmount();

    server.use(
      http.get("/api/workspaces/1/members", () => HttpResponse.json({ members: [] })),
      http.get("/api/workspaces/1/audit-events", () => HttpResponse.json({ events: [] })),
    );
    render(<MembersPage workspace={adminWorkspace} accessToken="token" />);
    await screen.findByText("No governance changes yet.");
    await user.click(screen.getByRole("button", { name: "Invite member" }));
    const role = screen.getByRole("combobox", { name: "Role" });
    expect(within(role).queryByRole("option", { name: "Admin" })).not.toBeInTheDocument();
    expect(within(role).getByRole("option", { name: "Manager" })).toBeInTheDocument();
  });
});

describe("project approver governance", () => {
  it("offers only active Managers and Admins as approvers and flags missing configuration", async () => {
    server.use(
      http.get("/api/workspaces/1/projects", () => HttpResponse.json({ projects: [{ id: "51", workspaceId: "1", name: "Atlas", approverMembershipId: null, approver: null, isArchived: false, submissionReady: false, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" }] })),
      http.get("/api/workspaces/1/members", () => HttpResponse.json({ members })),
    );
    render(<ProjectsPage workspace={adminWorkspace} accessToken="token" />);

    expect(await screen.findByText("Approver required")).toBeInTheDocument();
    const approver = screen.getByRole("combobox", { name: "Primary approver" });
    expect(within(approver).getByRole("option", { name: "admin@example.com (admin)" })).toBeInTheDocument();
    expect(within(approver).getByRole("option", { name: "manager@example.com (manager)" })).toBeInTheDocument();
    expect(within(approver).queryByRole("option", { name: /inactive@example.com/ })).not.toBeInTheDocument();
    expect(within(approver).queryByRole("option", { name: /member@example.com/ })).not.toBeInTheDocument();
  });

  it("keeps approver assignment read-only for Managers", async () => {
    server.use(http.get("/api/workspaces/1/projects", () => HttpResponse.json({ projects: [{ id: "51", workspaceId: "1", name: "Atlas", approverMembershipId: "20", approver: members[1], isArchived: false, submissionReady: true, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" }] })));
    render(<ProjectsPage workspace={managerWorkspace} accessToken="token" />);
    expect(await screen.findByRole("combobox", { name: "Primary approver" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
  });
});
