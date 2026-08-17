import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "../test/server";
import type { WorkspaceSummary } from "../types/workspace";
import { TimesheetPage } from "./TimesheetPage";

const workspace: WorkspaceSummary = {
  id: "1",
  name: "Tempo Studio",
  timezone: "Africa/Johannesburg",
  membership: { id: "30", role: "member" },
  createdAt: "2026-08-01T00:00:00.000Z",
};

const approver = { id: "20", email: "manager@example.com", role: "manager" as const, isActive: true };
const project = (id: string, name: string) => ({
  id,
  workspaceId: "1",
  name,
  approverMembershipId: "20",
  approver,
  isArchived: false,
  submissionReady: true,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
});

const entry = (changes: Partial<{ id: string; projectId: string; workDate: string; durationMinutes: number; description: string | null }> = {}) => ({
  id: changes.id ?? "101",
  projectId: changes.projectId ?? "11",
  taskId: null,
  workDate: changes.workDate ?? "2025-03-10",
  durationMinutes: changes.durationMinutes ?? 60,
  description: changes.description ?? "Implementation",
  isBillable: true,
});

const useDraftWeek = (entries: ReturnType<typeof entry>[] = []) => {
  server.use(
    http.get("/api/workspaces/1/time-entries", () => HttpResponse.json({
      weekStart: "2025-03-10",
      status: "draft",
      totalMinutes: entries.reduce((total, item) => total + item.durationMinutes, 0),
      billableMinutes: entries.reduce((total, item) => total + item.durationMinutes, 0),
      entries,
    })),
    http.get("/api/workspaces/1/timesheets/2025-03-10/status", () => HttpResponse.json({ weekStart: "2025-03-10", status: "draft", portions: [] })),
    http.get("/api/workspaces/1/projects", () => HttpResponse.json({ projects: [project("11", "Northstar redesign")] })),
  );
};

beforeEach(() => {
  window.history.replaceState({}, "", "/time-entries?week=2025-03-10");
});

describe("inline time entry", () => {
  it("creates an entry on Enter and keeps the confirmed value and totals visible", async () => {
    useDraftWeek();
    let createCount = 0;
    server.use(http.post("/api/workspaces/1/time-entries", async ({ request }) => {
      createCount += 1;
      const body = await request.json() as { workDate: string; durationMinutes: number; description: string | null };
      return HttpResponse.json({ entry: entry({ id: "201", workDate: body.workDate, durationMinutes: body.durationMinutes, description: body.description }) }, { status: 201 });
    }));

    const user = userEvent.setup();
    render(<TimesheetPage workspace={workspace} accessToken="token" />);
    await screen.findByRole("heading", { name: "Log your hours" });
    await user.click(screen.getAllByRole("button", { name: "Add row" })[0]);

    const duration = screen.getByLabelText(/Northstar redesign on Mon/);
    await user.type(duration, "7:30{Enter}");

    await waitFor(() => expect(createCount).toBe(1));
    expect(duration).toHaveValue("7:30");
    expect(screen.getAllByText("7h 30m").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Submit timesheet" })).toBeEnabled();
  });

  it("updates an existing entry and deletes it when the cell is cleared", async () => {
    useDraftWeek([entry()]);
    let patchCount = 0;
    let deleteCount = 0;
    server.use(
      http.patch("/api/workspaces/1/time-entries/101", async ({ request }) => {
        patchCount += 1;
        const body = await request.json() as { durationMinutes: number };
        return HttpResponse.json({ entry: entry({ durationMinutes: body.durationMinutes }) });
      }),
      http.delete("/api/workspaces/1/time-entries/101", () => {
        deleteCount += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const user = userEvent.setup();
    render(<TimesheetPage workspace={workspace} accessToken="token" />);
    const duration = await screen.findByLabelText(/Northstar redesign on Mon/);
    await user.clear(duration);
    await user.type(duration, "2:15{Enter}");
    await waitFor(() => expect(patchCount).toBe(1));
    expect(duration).toHaveValue("2:15");
    fireEvent.blur(duration);
    expect(patchCount).toBe(1);

    await user.clear(duration);
    fireEvent.blur(duration);
    await waitFor(() => expect(deleteCount).toBe(1));
    expect(screen.queryByLabelText(/Northstar redesign on Mon/)).not.toBeInTheDocument();
  });

  it("keeps invalid input in place and explains the required h:mm format", async () => {
    useDraftWeek();
    let createCount = 0;
    server.use(http.post("/api/workspaces/1/time-entries", () => {
      createCount += 1;
      return HttpResponse.json({ entry: entry() }, { status: 201 });
    }));

    const user = userEvent.setup();
    render(<TimesheetPage workspace={workspace} accessToken="token" />);
    await screen.findByRole("heading", { name: "Log your hours" });
    await user.click(screen.getAllByRole("button", { name: "Add row" })[0]);
    const duration = screen.getByLabelText(/Northstar redesign on Mon/);
    await user.type(duration, "1:75{Enter}");

    expect(await screen.findByText("Enter time as h:mm, for example 7:30.")).toBeInTheDocument();
    expect(duration).toHaveValue("1:75");
    expect(duration).toHaveAttribute("aria-invalid", "true");
    expect(createCount).toBe(0);

    await user.clear(duration);
    await user.type(duration, "24:01{Enter}");
    expect(await screen.findByText("A single entry cannot be longer than 24:00.")).toBeInTheDocument();
    expect(duration).toHaveValue("24:01");
    expect(createCount).toBe(0);
  });

  it("retains a failed value so the user can correct or retry it", async () => {
    useDraftWeek();
    let attempts = 0;
    server.use(http.post("/api/workspaces/1/time-entries", () => {
      attempts += 1;
      if (attempts === 1) return HttpResponse.json({
        error: { code: "unavailable", message: "Saving is temporarily unavailable." },
      }, { status: 503 });
      return HttpResponse.json({ entry: entry({ id: "202", durationMinutes: 240 }) }, { status: 201 });
    }));

    const user = userEvent.setup();
    render(<TimesheetPage workspace={workspace} accessToken="token" />);
    await screen.findByRole("heading", { name: "Log your hours" });
    await user.click(screen.getAllByRole("button", { name: "Add row" })[0]);
    const duration = screen.getByLabelText(/Northstar redesign on Mon/);
    await user.type(duration, "4:00{Enter}");

    expect(await screen.findByText("Saving is temporarily unavailable.")).toBeInTheDocument();
    expect(duration).toHaveValue("4:00");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument());
    expect(duration).toHaveValue("4:00");
    expect(attempts).toBe(2);
  });
});

describe("member review status", () => {
  it("locks approved and pending portions while keeping returned work editable and resubmittable", async () => {
    const entries = [
      entry({ id: "101", projectId: "11", workDate: "2025-03-10", description: "Approved entry" }),
      entry({ id: "102", projectId: "12", workDate: "2025-03-11", description: "Returned entry" }),
      entry({ id: "103", projectId: "13", workDate: "2025-03-12", description: "Pending entry" }),
    ];
    server.use(
      http.get("/api/workspaces/1/time-entries", () => HttpResponse.json({ weekStart: "2025-03-10", status: "partially_approved", totalMinutes: 180, billableMinutes: 180, entries })),
      http.get("/api/workspaces/1/projects", () => HttpResponse.json({ projects: [project("11", "Northstar redesign"), project("12", "Cedar & Co. website"), project("13", "Atlas product audit")] })),
      http.get("/api/workspaces/1/timesheets/2025-03-10/status", () => HttpResponse.json({
        weekStart: "2025-03-10",
        status: "partially_approved",
        portions: [
          { approvalItemId: "1", project: { id: "11", name: "Northstar redesign" }, revisionNumber: 1, status: "approved", submittedMinutes: 60, returnComment: null, assignedApprover: approver, editable: false },
          { approvalItemId: "2", project: { id: "12", name: "Cedar & Co. website" }, revisionNumber: 1, status: "changes_requested", submittedMinutes: 60, returnComment: "Split research from implementation", assignedApprover: approver, editable: true },
          { approvalItemId: "3", project: { id: "13", name: "Atlas product audit" }, revisionNumber: 1, status: "pending", submittedMinutes: 60, returnComment: null, assignedApprover: approver, editable: false },
        ],
      })),
    );

    render(<TimesheetPage workspace={workspace} accessToken="token" />);
    expect((await screen.findAllByText("Changes requested")).length).toBeGreaterThan(0);
    expect(screen.getByText("Split research from implementation")).toBeInTheDocument();
    expect(within(screen.getByText("Approved entry").closest("tr")!).getAllByRole("textbox")[0]).toBeDisabled();
    expect(within(screen.getByText("Returned entry").closest("tr")!).getAllByRole("textbox")[0]).toBeEnabled();
    expect(within(screen.getByText("Pending entry").closest("tr")!).getAllByRole("textbox")[0]).toBeDisabled();
    expect(screen.getByRole("button", { name: "Resubmit returned work" })).toBeEnabled();
  });

  it("surfaces a recoverable status-loading failure without exposing administrative details", async () => {
    server.use(
      http.get("/api/workspaces/1/time-entries", () => HttpResponse.json({ weekStart: "2025-03-10", status: "draft", totalMinutes: 0, billableMinutes: 0, entries: [] })),
      http.get("/api/workspaces/1/projects", () => HttpResponse.json({ projects: [project("11", "Northstar redesign")] })),
      http.get("/api/workspaces/1/timesheets/2025-03-10/status", () => HttpResponse.json({ error: { code: "unavailable", internalReason: "Database failover" } }, { status: 500 })),
    );
    render(<TimesheetPage workspace={workspace} accessToken="token" />);
    expect(await screen.findByText("This week could not be loaded. Try again.")).toBeInTheDocument();
    expect(screen.queryByText("Database failover")).not.toBeInTheDocument();
  });
});
