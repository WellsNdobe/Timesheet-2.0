import { render, screen, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../test/server";
import type { WorkspaceSummary } from "../types/workspace";
import { TimesheetPage } from "./TimesheetPage";

const workspace: WorkspaceSummary = { id: "1", name: "Tempo Studio", timezone: "Africa/Johannesburg", membership: { id: "30", role: "member" }, createdAt: "2026-08-01T00:00:00.000Z" };
const approver = { id: "20", email: "manager@example.com", role: "manager", isActive: true };
const project = (id: string, name: string) => ({ id, workspaceId: "1", name, approverMembershipId: "20", approver, isArchived: false, submissionReady: true, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" });
const weekHandler = () => http.get("/api/workspaces/1/time-entries", () => HttpResponse.json({ weekStart: "2025-03-10", status: "partially_approved", totalMinutes: 180, billableMinutes: 120, entries: [
  { id: "101", projectId: "11", taskId: null, workDate: "2025-03-10", durationMinutes: 60, description: "Approved entry", isBillable: true },
  { id: "102", projectId: "12", taskId: null, workDate: "2025-03-11", durationMinutes: 60, description: "Returned entry", isBillable: true },
  { id: "103", projectId: "13", taskId: null, workDate: "2025-03-12", durationMinutes: 60, description: "Pending entry", isBillable: false },
] }));
const projectsHandler = () => http.get("/api/workspaces/1/projects", () => HttpResponse.json({ projects: [project("11", "Northstar redesign"), project("12", "Cedar & Co. website"), project("13", "Atlas product audit")] }));

describe("member review status", () => {
  it("locks approved and pending portions while keeping returned work editable and resubmittable", async () => {
    server.use(weekHandler(), projectsHandler(), http.get("/api/workspaces/1/timesheets/2025-03-10/status", () => HttpResponse.json({
      weekStart: "2025-03-10",
      status: "partially_approved",
      portions: [
        { approvalItemId: "1", project: { id: "11", name: "Northstar redesign" }, revisionNumber: 1, status: "approved", submittedMinutes: 600, returnComment: null, assignedApprover: approver, editable: false },
        { approvalItemId: "2", project: { id: "12", name: "Cedar & Co. website" }, revisionNumber: 1, status: "changes_requested", submittedMinutes: 300, returnComment: "Split research from implementation", assignedApprover: approver, editable: true },
        { approvalItemId: "3", project: { id: "13", name: "Atlas product audit" }, revisionNumber: 1, status: "pending", submittedMinutes: 250, returnComment: null, assignedApprover: approver, editable: false },
      ],
    })));
    render(<TimesheetPage workspace={workspace} accessToken="token" />);

    expect((await screen.findAllByText("Changes requested")).length).toBeGreaterThan(0);
    expect(screen.getByText("Split research from implementation")).toBeInTheDocument();
    expect(within(screen.getByText("Approved entry").closest("tr")!).queryByRole("button", { name: "Edit entry" })).not.toBeInTheDocument();
    expect(within(screen.getByText("Returned entry").closest("tr")!).getByRole("button", { name: "Edit entry" })).toBeInTheDocument();
    expect(within(screen.getByText("Pending entry").closest("tr")!).queryByRole("button", { name: "Edit entry" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resubmit returned work" })).toBeEnabled();
  });

  it("surfaces a recoverable status-loading failure without exposing administrative details", async () => {
    server.use(weekHandler(), projectsHandler(), http.get("/api/workspaces/1/timesheets/2025-03-10/status", () => HttpResponse.json({ error: { code: "unavailable", internalReason: "Database failover" } }, { status: 500 })));
    render(<TimesheetPage workspace={workspace} accessToken="token" />);
    expect(await screen.findByText("This week could not be loaded. Try again.")).toBeInTheDocument();
    expect(screen.queryByText("Database failover")).not.toBeInTheDocument();
  });
});
