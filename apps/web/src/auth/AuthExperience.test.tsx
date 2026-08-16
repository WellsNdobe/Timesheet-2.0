import { HttpResponse, delay, http } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server";
import { AuthExperience } from "./AuthExperience";

const authResponse = { accessToken: "access-token", user: { id: "1", email: "maia@example.com", createdAt: "2026-08-15T00:00:00.000Z" } };

describe("workspace signup onboarding", () => {
  beforeEach(() => window.history.replaceState({}, "", "/signup"));

  it("validates account details before opening workspace setup and preserves them when going back", async () => {
    const user = userEvent.setup();
    render(<AuthExperience mode="signup" onAuthenticated={() => undefined} />);

    await user.click(screen.getByRole("button", { name: "Continue to workspace" }));
    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.getByText("Password must be at least 8 characters.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Work email"), "maia@example.com");
    await user.type(screen.getByLabelText("Password"), "correct-horse-battery");
    await user.click(screen.getByRole("button", { name: "Continue to workspace" }));
    expect(screen.getByLabelText("Organization name")).toBeInTheDocument();
    expect(screen.getByLabelText("Workspace timezone")).toHaveValue(Intl.DateTimeFormat().resolvedOptions().timeZone);

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText("Work email")).toHaveValue("maia@example.com");
    expect(screen.getByLabelText("Password")).toHaveValue("correct-horse-battery");
  });

  it("submits confirmed workspace details once and announces success", async () => {
    let requestBody: unknown;
    let requestCount = 0;
    server.use(http.post("/api/auth/register", async ({ request }) => { requestCount += 1; requestBody = await request.json(); await delay(30); return HttpResponse.json(authResponse, { status: 201 }); }));
    const user = userEvent.setup();
    render(<AuthExperience mode="signup" onAuthenticated={() => undefined} />);

    await user.type(screen.getByLabelText("Work email"), "maia@example.com");
    await user.type(screen.getByLabelText("Password"), "correct-horse-battery");
    await user.click(screen.getByRole("button", { name: "Continue to workspace" }));
    await user.type(screen.getByLabelText("Organization name"), "Tempo Studio");
    const createButton = screen.getByRole("button", { name: "Create workspace" });
    await user.click(createButton);
    await user.click(createButton);

    expect(await screen.findByRole("status")).toHaveTextContent("Your workspace is ready");
    expect(requestCount).toBe(1);
    expect(requestBody).toEqual(expect.objectContaining({ email: "maia@example.com", organizationName: "Tempo Studio", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }));
  });

  it("activates a provisioned invited account without showing signup", async () => {
    window.history.replaceState({}, "", "/login?inviteToken=valid-invitation-token-value");
    let requestBody: unknown;
    server.use(
      http.get("/api/auth/invitations/valid-invitation-token-value", () => HttpResponse.json({ invitation: { email: "maia@example.com", workspaceName: "Tempo Studio", role: "member", requiresPasswordChange: true, expiresAt: "2026-08-22T10:00:00.000Z" } })),
      http.post("/api/auth/invitations/activate", async ({ request }) => { requestBody = await request.json(); return HttpResponse.json(authResponse); }),
    );
    const onAuthenticated = vi.fn();
    const user = userEvent.setup();
    render(<AuthExperience mode="login" onAuthenticated={onAuthenticated} />);

    expect(await screen.findByDisplayValue("maia@example.com")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Password"), "correct-horse-battery");
    await user.type(screen.getByLabelText("Confirm password"), "correct-horse-battery");
    await user.click(screen.getByRole("button", { name: "Set password and log in" }));

    await waitFor(() => expect(requestBody).toEqual({ password: "correct-horse-battery", token: "valid-invitation-token-value" }));
    expect(screen.queryByLabelText("Organization name")).not.toBeInTheDocument();
    expect(onAuthenticated).toHaveBeenCalledWith(authResponse);
  });

  it("keeps workspace details available when registration fails", async () => {
    server.use(http.post("/api/auth/register", () => HttpResponse.json({ error: { code: "request_failed", message: "Workspace creation is temporarily unavailable." } }, { status: 503 })));
    const user = userEvent.setup();
    render(<AuthExperience mode="signup" onAuthenticated={() => undefined} />);

    await user.type(screen.getByLabelText("Work email"), "maia@example.com");
    await user.type(screen.getByLabelText("Password"), "correct-horse-battery");
    await user.click(screen.getByRole("button", { name: "Continue to workspace" }));
    await user.type(screen.getByLabelText("Organization name"), "Tempo Studio");
    await user.click(screen.getByRole("button", { name: "Create workspace" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Workspace creation is temporarily unavailable.");
    expect(screen.getByLabelText("Organization name")).toHaveValue("Tempo Studio");
    expect(screen.getByRole("button", { name: "Create workspace" })).toBeEnabled();
  });
});
