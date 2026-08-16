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

describe("password recovery", () => {
  it("validates the email and shows the same inbox confirmation", async () => {
    window.history.replaceState({}, "", "/forgot-password");
    let requestBody: unknown;
    server.use(http.post("/api/auth/password-reset/request", async ({ request }) => { requestBody = await request.json(); return HttpResponse.json({ message: "If an eligible account exists, a password reset email is on its way." }, { status: 202 }); }));
    const user = userEvent.setup();
    render(<AuthExperience mode="forgot-password" onAuthenticated={() => undefined} />);

    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Account email"), "maia@example.com");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Check your inbox");
    expect(screen.getByText(/Try again after one minute/)).toBeInTheDocument();
    expect(requestBody).toEqual({ email: "maia@example.com" });
    expect(screen.queryByLabelText("Organization name")).not.toBeInTheDocument();
  });

  it("shows recovery for an expired or used link", async () => {
    window.history.replaceState({}, "", "/reset-password?token=expired-password-reset-token-value");
    server.use(http.post("/api/auth/password-reset/validate", () => HttpResponse.json({ valid: false })));
    render(<AuthExperience mode="reset-password" onAuthenticated={() => undefined} />);
    expect(await screen.findByText("This reset link is unavailable")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Request a new link" })).toHaveAttribute("href", "/forgot-password");
  });

  it("checks confirmation, completes the reset, and removes the token from browser history", async () => {
    window.history.replaceState({}, "", "/reset-password?token=valid-password-reset-token-value");
    let requestBody: unknown;
    server.use(
      http.post("/api/auth/password-reset/validate", () => HttpResponse.json({ valid: true })),
      http.post("/api/auth/password-reset/complete", async ({ request }) => { requestBody = await request.json(); return new HttpResponse(null, { status: 204 }); }),
    );
    const user = userEvent.setup();
    render(<AuthExperience mode="reset-password" onAuthenticated={() => undefined} />);
    expect(await screen.findByRole("button", { name: "Change password" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("New password"), "new-correct-horse-battery");
    await user.type(screen.getByLabelText("Confirm new password"), "different-password");
    await user.click(screen.getByRole("button", { name: "Change password" }));
    expect(screen.getByText("The passwords do not match.")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Confirm new password"));
    await user.type(screen.getByLabelText("Confirm new password"), "new-correct-horse-battery");
    await user.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByText("Password changed")).toBeInTheDocument();
    expect(requestBody).toEqual({ token: "valid-password-reset-token-value", password: "new-correct-horse-battery" });
    expect(window.location.search).toBe("");
    expect(screen.getByRole("link", { name: "Log in with your new password" })).toHaveAttribute("href", "/login?passwordReset=success");
  });

  it("shows the password-changed notice on login", () => {
    window.history.replaceState({}, "", "/login?passwordReset=success");
    render(<AuthExperience mode="login" onAuthenticated={() => undefined} />);
    expect(screen.getByRole("status")).toHaveTextContent("Password changed—log in with your new password.");
  });
});
