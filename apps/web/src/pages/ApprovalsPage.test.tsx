import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
import { server } from "../test/server";
import type { WorkspaceRole, WorkspaceSummary } from "../types/workspace";
import { ApprovalsPage } from "./ApprovalsPage";

const workspace = (role: WorkspaceRole, membershipId = role === "admin" ? "10" : "20"): WorkspaceSummary => ({
  id: "1",
  name: "Tempo Studio",
  timezone: "Africa/Johannesburg",
  membership: { id: membershipId, role },
  createdAt: "2026-08-01T00:00:00.000Z",
});

const identity = (id: string, email: string, role: WorkspaceRole) => ({ id, email, role, isActive: true });
const pending = {
  id: "101", revisionId: "1001", revisionNumber: 2, status: "pending" as const, submittedMinutes: 135,
  submittedAt: "2026-08-05T08:00:00.000Z", resolvedAt: null, returnComment: null,
  project: { id: "31", name: "Atlas" }, weekStart: "2026-08-03",
  submitter: identity("30", "member@example.com", "member"), assignedApprover: identity("20", "manager@example.com", "manager"),
};
const approved = { ...pending, id: "102", revisionId: "1002", revisionNumber: 1, status: "approved" as const, submittedMinutes: 60, resolvedAt: "2026-08-04T10:00:00.000Z", project: { id: "32", name: "Beacon" }, assignedApprover: identity("10", "admin@example.com", "admin") };

const renderPage = (role: WorkspaceRole, approvalId?: string) => {
  const onPendingCountChange = vi.fn();
  const result = render(<ApprovalsPage workspace={workspace(role)} accessToken="token" approvalId={approvalId} onNavigate={vi.fn()} onPendingCountChange={onPendingCountChange} />);
  return { ...result, onPendingCountChange };
};

describe("approval inbox", () => {
  it("defaults to actionable pending work, keeps history secondary, and reports a consistent badge count", async () => {
    server.use(http.get("/api/workspaces/1/approvals", () => HttpResponse.json({ approvals: [pending, approved] })));
    const user = userEvent.setup();
    const { onPendingCountChange } = renderPage("admin");

    expect(await screen.findByText("Atlas")).toBeInTheDocument();
    expect(screen.queryByText("Beacon")).not.toBeInTheDocument();
    expect(onPendingCountChange).toHaveBeenLastCalledWith(1);
    await user.click(screen.getByRole("button", { name: "History" }));
    expect(screen.getByText("Beacon")).toBeInTheDocument();
  });

  it("offers recovery for an API error and a clear empty actionable state", async () => {
    server.use(http.get("/api/workspaces/1/approvals", () => HttpResponse.json({ error: { code: "unavailable" } }, { status: 500 })));
    const view = renderPage("manager");
    expect(await screen.findByText("Approvals unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    view.unmount();

    server.use(http.get("/api/workspaces/1/approvals", () => HttpResponse.json({ approvals: [] })));
    renderPage("manager");
    expect(await screen.findByText("You're all caught up")).toBeInTheDocument();
  });
});

describe("approval detail actions", () => {
  const detail = (assignedApproverMembershipId: string, internalReason?: string) => ({
    approval: {
      id: "101", weekStart: "2026-08-03", submitter: identity("30", "member@example.com", "member"), project: { id: "31", name: "Atlas" },
      latestRevision: { id: "1001", revisionNumber: 2, status: "pending", projectName: "Atlas", submittedMinutes: 135, submittedAt: "2026-08-05T08:00:00.000Z", resolvedAt: null, returnComment: null, assignedApproverMembershipId },
      revisions: [{
        id: "1001", revisionNumber: 2, status: "pending", projectName: "Atlas", submittedMinutes: 135, submittedAt: "2026-08-05T08:00:00.000Z", resolvedAt: null, returnComment: null,
        assignedApprover: identity(assignedApproverMembershipId, assignedApproverMembershipId === "20" ? "manager@example.com" : "other@example.com", "manager"), resolvedBy: null,
        entries: [{ id: "501", revisionId: "1001", sourceEntryId: "91", taskId: null, taskName: null, workDate: "2026-08-03", durationMinutes: 135, description: "Implementation", isBillable: true }],
        diff: { added: [], removed: [], changed: [] },
        events: [{ id: "701", type: "transferred", comment: null, ...(internalReason === undefined ? {} : { internalReason }), actor: identity("10", "admin@example.com", "admin"), previousApprover: null, nextApprover: null, createdAt: "2026-08-05T08:00:00.000Z" }],
      }],
    },
  });

  it("shows normal review actions only to the assigned Manager and requires a change comment", async () => {
    server.use(http.get("/api/workspaces/1/approval-items/101", () => HttpResponse.json(detail("20"))));
    const user = userEvent.setup();
    renderPage("manager", "101");

    expect(await screen.findByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request changes" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Transfer" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Admin reason:/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Request changes" }));
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "Member-facing comment" }), "Please clarify the work");
    expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();
  });

  it("shows transfer and audited override controls to an unassigned Admin", async () => {
    server.use(
      http.get("/api/workspaces/1/approval-items/101", () => HttpResponse.json(detail("20", "Manager unavailable"))),
      http.get("/api/workspaces/1/members", () => HttpResponse.json({ members: [
        { ...identity("10", "admin@example.com", "admin"), userId: "1", joinedAt: "2026-08-01T00:00:00.000Z", pendingApprovalCount: 0 },
        { ...identity("20", "manager@example.com", "manager"), userId: "2", joinedAt: "2026-08-01T00:00:00.000Z", pendingApprovalCount: 1 },
      ] })),
    );
    renderPage("admin", "101");

    expect(await screen.findByRole("button", { name: "Transfer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve as Admin" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request changes" })).not.toBeInTheDocument();
    expect(screen.getByText("Admin reason: Manager unavailable")).toBeInTheDocument();
  });

  it("turns stale decision conflicts into a refresh instruction", async () => {
    server.use(
      http.get("/api/workspaces/1/approval-items/101", () => HttpResponse.json(detail("20"))),
      http.post("/api/workspaces/1/approval-items/101/revisions/1001/approve", () => HttpResponse.json({ error: { code: "invalid_review_state", message: "Already resolved" } }, { status: 409 })),
    );
    const user = userEvent.setup();
    renderPage("manager", "101");
    await user.click(await screen.findByRole("button", { name: "Approve" }));
    expect(await screen.findByText("This approval changed while you were reviewing it. Refresh and try again.")).toBeInTheDocument();
  });
});
