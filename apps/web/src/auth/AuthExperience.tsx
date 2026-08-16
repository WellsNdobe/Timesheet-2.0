import { FormEvent, useEffect, useMemo, useState } from "react";
import "./auth.css";

type AuthMode = "signup" | "login" | "forgot-password" | "reset-password";
type SignupStep = "account" | "workspace" | "success";

export type AuthResponse = {
  accessToken: string;
  user: { id: string; email: string; createdAt: string };
};

type ApiErrorResponse = { error?: { code?: string; message?: string } };
type SignupErrors = { email?: string; password?: string; organizationName?: string; timezone?: string };
type InvitationDetails = { email: string; workspaceName: string; role: "manager" | "member"; expiresAt: string; requiresPasswordChange: boolean };

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const fallbackTimezones = [
  "Africa/Cairo", "Africa/Johannesburg", "Africa/Lagos", "Africa/Nairobi",
  "America/Chicago", "America/Denver", "America/Los_Angeles", "America/New_York",
  "America/Sao_Paulo", "Asia/Dubai", "Asia/Hong_Kong", "Asia/Kolkata", "Asia/Singapore",
  "Asia/Tokyo", "Australia/Sydney", "Europe/Amsterdam", "Europe/Berlin", "Europe/London",
  "Europe/Paris", "Pacific/Auckland", "UTC",
];

const queryInviteToken = () => new URLSearchParams(window.location.search).get("inviteToken")?.trim() || undefined;
const browserTimezone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; } };
const supportedTimezones = () => {
  const enhancedIntl = Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] };
  try { return enhancedIntl.supportedValuesOf?.("timeZone") ?? fallbackTimezones; } catch { return fallbackTimezones; }
};

function Brand() {
  return <a className="auth-brand" href="/" aria-label="TempoLedger home"><span className="brand-mark">T</span><strong>tempo<span>ledger</span></strong></a>;
}

function InlineFormError({ id, children }: { id: string; children: string }) {
  return <p className="auth-field-error" id={id} role="alert">{children}</p>;
}

function ProductPreview() {
  return <aside className="auth-product" aria-label="TempoLedger product overview">
    <div className="auth-product__copy"><p className="auth-eyebrow">A clearer working week</p><h2>Keep time, budgets, and project progress in one calm workspace.</h2><p>Start quickly, stay on top of billable work, and know what needs attention without chasing spreadsheets.</p></div>
    <div className="auth-preview-card" aria-label="Sample weekly time summary"><div className="auth-preview-card__heading"><div><span>This week</span><strong>24h 40m</strong></div><small>62% of target</small></div><div className="auth-preview-progress"><span /></div><div className="auth-preview-stats"><span>Billable<strong>18h 20m</strong></span><span>Non-billable<strong>6h 20m</strong></span></div><div className="auth-preview-project"><span className="auth-preview-project__initial">N</span><div><strong>Northstar redesign</strong><small>On track</small></div><b>18h 20m</b></div></div>
    <div className="auth-benefits" aria-label="Product benefits"><span><b>01</b>Track work while it is fresh.</span><span><b>02</b>Keep project budgets visible.</span><span><b>03</b>Review progress without extra admin.</span></div>
  </aside>;
}

function AuthFooter({ mode }: { mode: "signup" | "login" }) {
  return <div className="auth-footer"><p>{mode === "signup" ? "Already have an account?" : "New to TempoLedger?"} <a href={mode === "signup" ? "/login" : "/signup"}>{mode === "signup" ? "Log in" : "Create an account"}</a></p>{mode === "signup" && <small>By creating an account, you agree to our <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.</small>}</div>;
}

function PasswordField({ password, showPassword, setPassword, setShowPassword, error, label = "Password" }: { password: string; showPassword: boolean; setPassword: (value: string) => void; setShowPassword: (value: boolean) => void; error?: string; label?: string }) {
  return <><label htmlFor="auth-password">{label}</label><div className="auth-password-field"><input autoComplete="new-password" id="auth-password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} aria-describedby={error ? "password-error" : undefined} aria-invalid={Boolean(error)} placeholder="At least 8 characters" /><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={`${showPassword ? "Hide" : "Show"} password`}>{showPassword ? "Hide" : "Show"}</button></div>{error && <InlineFormError id="password-error">{error}</InlineFormError>}</>;
}

function SignupProgress({ step }: { step: Exclude<SignupStep, "success"> }) {
  const number = step === "account" ? 1 : 2;
  return <div className="auth-progress" aria-label={`Signup step ${number} of 2`}><span className="auth-progress__copy">Step {number} of 2</span><span className="auth-progress__track" aria-hidden="true"><i className={`auth-progress__fill${number === 2 ? " auth-progress__fill--complete" : ""}`} /></span></div>;
}

function SignupForm({ onAuthenticated }: { onAuthenticated: (result: AuthResponse) => void }) {
  const detectedTimezone = useMemo(browserTimezone, []);
  const timezoneOptions = useMemo(() => { const values = new Set(supportedTimezones()); if (detectedTimezone) values.add(detectedTimezone); return [...values].sort(); }, [detectedTimezone]);
  const [step, setStep] = useState<SignupStep>("account");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [organizationName, setOrganizationName] = useState("");
  const [timezone, setTimezone] = useState(detectedTimezone);
  const [fieldErrors, setFieldErrors] = useState<SignupErrors>({});
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validateAccount = () => {
    const errors: SignupErrors = {};
    if (!emailPattern.test(email.trim())) errors.email = "Enter a valid email address.";
    if (password.length < 8) errors.password = "Password must be at least 8 characters.";
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const validateWorkspace = () => {
    const errors: SignupErrors = {};
    if (!organizationName.trim()) errors.organizationName = "Enter your organization name.";
    if (!timezone.trim() || !timezoneOptions.includes(timezone)) errors.timezone = "Choose a valid timezone from the list.";
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const submitRegistration = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (isSubmitting || !validateWorkspace()) return;
    setFormError(""); setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/register", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim(), password, organizationName: organizationName.trim(), timezone }) });
      const body = await response.json() as AuthResponse & ApiErrorResponse;
      if (!response.ok) {
        if (body.error?.code === "email_already_registered") { setStep("account"); setFieldErrors({ email: "An account with this email already exists. Log in instead." }); }
        else setFormError(body.error?.message ?? "We couldn't complete that request. Try again.");
        return;
      }
      setStep("success");
      window.setTimeout(() => onAuthenticated(body), 900);
    } catch { setFormError("We couldn't reach TempoLedger. Check that the API is running and try again."); }
    finally { setIsSubmitting(false); }
  };

  const continueFromAccount = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setFormError("");
    if (!validateAccount()) return;
    setFieldErrors({}); setStep("workspace");
  };

  if (step === "success") return <div className="auth-success" role="status" aria-live="polite"><span className="auth-success__mark" aria-hidden="true">✓</span><h2>Your workspace is ready</h2><p>{`Opening ${organizationName.trim()}…`}</p></div>;

  return <><SignupProgress step={step} />
    {step === "account" ? <form className="auth-form auth-step" onSubmit={continueFromAccount} noValidate>
      <label htmlFor="auth-email">Work email</label><input autoComplete="email" autoFocus id="auth-email" type="email" value={email} onChange={(event) => { setEmail(event.target.value); if (fieldErrors.email) setFieldErrors((current) => ({ ...current, email: undefined })); }} aria-describedby={fieldErrors.email ? "email-error" : "email-help"} aria-invalid={Boolean(fieldErrors.email)} placeholder="you@company.com" />
      {fieldErrors.email ? <InlineFormError id="email-error">{fieldErrors.email}</InlineFormError> : <p className="auth-field-help" id="email-help">Use the email you want connected to your workspace.</p>}
      <PasswordField password={password} showPassword={showPassword} setPassword={(value) => { setPassword(value); if (fieldErrors.password) setFieldErrors((current) => ({ ...current, password: undefined })); }} setShowPassword={setShowPassword} error={fieldErrors.password} />
      {formError && <div className="auth-form-error" role="alert">{formError}</div>}
      <button className="auth-submit" type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>{isSubmitting && <span className="auth-spinner" aria-hidden="true" />}Continue to workspace</button><p className="auth-reassurance">Free to get started · No credit card required</p>
    </form> : <form className="auth-form auth-step" onSubmit={(event) => void submitRegistration(event)} noValidate>
      <label htmlFor="auth-organization">Organization name</label><input autoComplete="organization" autoFocus id="auth-organization" value={organizationName} onChange={(event) => { setOrganizationName(event.target.value); if (fieldErrors.organizationName) setFieldErrors((current) => ({ ...current, organizationName: undefined })); }} aria-describedby={fieldErrors.organizationName ? "organization-error" : "organization-help"} aria-invalid={Boolean(fieldErrors.organizationName)} placeholder="Your organization" maxLength={120} />
      {fieldErrors.organizationName ? <InlineFormError id="organization-error">{fieldErrors.organizationName}</InlineFormError> : <p className="auth-field-help" id="organization-help">This is how your workspace will appear to your team.</p>}
      <label htmlFor="auth-timezone">Workspace timezone</label><input id="auth-timezone" list="auth-timezone-options" value={timezone} onChange={(event) => { setTimezone(event.target.value); if (fieldErrors.timezone) setFieldErrors((current) => ({ ...current, timezone: undefined })); }} aria-describedby={fieldErrors.timezone ? "timezone-error" : "timezone-help"} aria-invalid={Boolean(fieldErrors.timezone)} placeholder="Search for a timezone" autoComplete="off" /><datalist id="auth-timezone-options">{timezoneOptions.map((option) => <option key={option} value={option} />)}</datalist>
      {fieldErrors.timezone ? <InlineFormError id="timezone-error">{fieldErrors.timezone}</InlineFormError> : <p className="auth-field-help" id="timezone-help">{detectedTimezone ? "Detected from your browser. Review before creating the workspace." : "Choose the timezone used for dates and approvals."}</p>}
      {formError && <div className="auth-form-error" role="alert">{formError}</div>}
      <div className="auth-step-actions"><button className="auth-back" type="button" disabled={isSubmitting} onClick={() => { setFormError(""); setFieldErrors({}); setStep("account"); }}>Back</button><button className="auth-submit" type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>{isSubmitting && <span className="auth-spinner" aria-hidden="true" />}{isSubmitting ? "Creating workspace…" : "Create workspace"}</button></div>
    </form>}
  </>;
}

function LoginForm({ onAuthenticated, initialEmail = "", inviteToken }: { onAuthenticated: (result: AuthResponse) => void; initialEmail?: string; inviteToken?: string }) {
  const [email, setEmail] = useState(initialEmail); const [password, setPassword] = useState(""); const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({}); const [formError, setFormError] = useState(""); const [isSubmitting, setIsSubmitting] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setFormError(""); const errors: typeof fieldErrors = {}; if (!emailPattern.test(email.trim())) errors.email = "Enter a valid email address."; if (password.length < 8) errors.password = "Password must be at least 8 characters."; setFieldErrors(errors); if (Object.keys(errors).length) return; setIsSubmitting(true); try { const response = await fetch("/api/auth/login", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim(), password, ...(inviteToken ? { inviteToken } : {}) }) }); const body = await response.json() as AuthResponse & ApiErrorResponse; if (!response.ok) { setFormError(body.error?.code === "invalid_credentials" ? "The email or password is incorrect. Try again." : body.error?.message ?? "We couldn't complete that request. Try again."); return; } onAuthenticated(body); } catch { setFormError("We couldn't reach TempoLedger. Check that the API is running and try again."); } finally { setIsSubmitting(false); } };
  const passwordResetSucceeded = new URLSearchParams(window.location.search).get("passwordReset") === "success";
  return <form className="auth-form" onSubmit={(event) => void submit(event)} noValidate>{passwordResetSucceeded && <div className="auth-form-success" role="status">Password changed—log in with your new password.</div>}<label htmlFor="auth-email">Email</label><input autoComplete="email" autoFocus={!inviteToken} id="auth-email" type="email" value={email} readOnly={Boolean(inviteToken)} aria-readonly={Boolean(inviteToken)} onChange={(event) => { setEmail(event.target.value); if (fieldErrors.email) setFieldErrors((current) => ({ ...current, email: undefined })); }} aria-describedby={fieldErrors.email ? "email-error" : undefined} aria-invalid={Boolean(fieldErrors.email)} placeholder="you@company.com" />{fieldErrors.email && <InlineFormError id="email-error">{fieldErrors.email}</InlineFormError>}<div className="auth-label-row"><label htmlFor="auth-password">Password</label><a href="/forgot-password">Forgot password?</a></div><div className="auth-password-field"><input autoComplete="current-password" autoFocus={Boolean(inviteToken)} id="auth-password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => { setPassword(event.target.value); if (fieldErrors.password) setFieldErrors((current) => ({ ...current, password: undefined })); }} aria-describedby={fieldErrors.password ? "password-error" : undefined} aria-invalid={Boolean(fieldErrors.password)} placeholder="Enter your password" /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={`${showPassword ? "Hide" : "Show"} password`}>{showPassword ? "Hide" : "Show"}</button></div>{fieldErrors.password && <InlineFormError id="password-error">{fieldErrors.password}</InlineFormError>}{formError && <div className="auth-form-error" role="alert">{formError}</div>}<button className="auth-submit" type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>{isSubmitting && <span className="auth-spinner" aria-hidden="true" />}{isSubmitting ? "Logging in…" : "Log in"}</button></form>;
}

function ForgotPasswordForm() {
  const [email, setEmail] = useState(""); const [emailError, setEmailError] = useState(""); const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false); const [submitted, setSubmitted] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setEmailError(""); setFormError("");
    if (!emailPattern.test(email.trim())) { setEmailError("Enter a valid email address."); return; }
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/password-reset/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim() }) });
      if (!response.ok) { const body = await response.json() as ApiErrorResponse; setFormError(body.error?.message ?? "We couldn't complete that request. Try again shortly."); return; }
      setSubmitted(true);
    } catch { setFormError("We couldn't reach TempoLedger. Check your connection and try again."); }
    finally { setIsSubmitting(false); }
  };
  if (submitted) return <div className="auth-success" role="status"><span className="auth-success__mark" aria-hidden="true">✓</span><h2>Check your inbox</h2><p>If an eligible account exists for {email.trim()}, a reset link is on its way. It expires in 30 minutes.</p><button className="auth-text-button" type="button" onClick={() => setSubmitted(false)}>Didn't receive it? Try again after one minute</button><a className="auth-return-link" href="/login">Return to login</a></div>;
  return <><form className="auth-form" onSubmit={(event) => void submit(event)} noValidate><label htmlFor="auth-email">Account email</label><input autoComplete="email" autoFocus id="auth-email" type="email" value={email} onChange={(event) => { setEmail(event.target.value); setEmailError(""); }} aria-describedby={emailError ? "email-error" : "email-help"} aria-invalid={Boolean(emailError)} placeholder="you@company.com" />{emailError ? <InlineFormError id="email-error">{emailError}</InlineFormError> : <p className="auth-field-help" id="email-help">We'll send a private link if this email belongs to an activated account.</p>}{formError && <div className="auth-form-error" role="alert">{formError}</div>}<button className="auth-submit" type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>{isSubmitting && <span className="auth-spinner" aria-hidden="true" />}{isSubmitting ? "Sending reset link…" : "Send reset link"}</button></form><div className="auth-footer"><p><a href="/login">Return to login</a></p></div></>;
}

function ResetPasswordForm() {
  const [token] = useState(() => new URLSearchParams(window.location.search).get("token")?.trim() ?? "");
  const [state, setState] = useState<"checking" | "ready" | "invalid" | "success">("checking");
  const [password, setPassword] = useState(""); const [confirmPassword, setConfirmPassword] = useState(""); const [showPassword, setShowPassword] = useState(false);
  const [fieldError, setFieldError] = useState(""); const [formError, setFormError] = useState(""); const [isSubmitting, setIsSubmitting] = useState(false);
  useEffect(() => { let active = true; void (async () => { if (!token) { setState("invalid"); return; } try { const response = await fetch("/api/auth/password-reset/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) }); const body = await response.json() as { valid?: boolean }; if (active) setState(response.ok && body.valid ? "ready" : "invalid"); } catch { if (active) setState("invalid"); } })(); return () => { active = false; }; }, [token]);
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setFieldError(""); setFormError(""); if (password.length < 8) { setFieldError("Password must be at least 8 characters."); return; } if (password !== confirmPassword) { setFieldError("The passwords do not match."); return; } setIsSubmitting(true); try { const response = await fetch("/api/auth/password-reset/complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) }); if (!response.ok) { const body = await response.json() as ApiErrorResponse; if (body.error?.code === "password_reset_invalid") setState("invalid"); else setFormError(body.error?.message ?? "We couldn't change your password. Try again."); return; } sessionStorage.removeItem("tempoledger.session"); window.history.replaceState({}, "", "/reset-password"); setState("success"); } catch { setFormError("We couldn't reach TempoLedger. Check your connection and try again."); } finally { setIsSubmitting(false); } };
  if (state === "checking") return <div className="auth-invite-loading" role="status"><span className="auth-spinner" aria-hidden="true" />Checking your reset link…</div>;
  if (state === "invalid") return <div className="auth-reset-recovery" role="alert"><h2>This reset link is unavailable</h2><p>It may have expired or already been used. Request a new 30-minute link to continue.</p><a className="auth-submit auth-link-button" href="/forgot-password">Request a new link</a><a className="auth-return-link" href="/login">Return to login</a></div>;
  if (state === "success") return <div className="auth-success" role="status"><span className="auth-success__mark" aria-hidden="true">✓</span><h2>Password changed</h2><p>Your other TempoLedger sessions have been signed out.</p><a className="auth-submit auth-link-button" href="/login?passwordReset=success">Log in with your new password</a></div>;
  return <form className="auth-form" onSubmit={(event) => void submit(event)} noValidate><PasswordField label="New password" password={password} showPassword={showPassword} setPassword={(value) => { setPassword(value); setFieldError(""); }} setShowPassword={setShowPassword} error={fieldError || undefined} /><label htmlFor="auth-confirm-password">Confirm new password</label><div className="auth-password-field"><input autoComplete="new-password" id="auth-confirm-password" type={showPassword ? "text" : "password"} value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setFieldError(""); }} placeholder="Enter the password again" /></div>{formError && <div className="auth-form-error" role="alert">{formError}</div>}<button className="auth-submit" type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>{isSubmitting && <span className="auth-spinner" aria-hidden="true" />}{isSubmitting ? "Changing password…" : "Change password"}</button></form>;
}

function InvitationForm({ token, onAuthenticated }: { token: string; onAuthenticated: (result: AuthResponse) => void }) {
  const [invitation, setInvitation] = useState<InvitationDetails>(); const [loadError, setLoadError] = useState("");
  const [password, setPassword] = useState(""); const [confirmPassword, setConfirmPassword] = useState(""); const [showPassword, setShowPassword] = useState(false);
  const [fieldError, setFieldError] = useState(""); const [formError, setFormError] = useState(""); const [isSubmitting, setIsSubmitting] = useState(false);
  useEffect(() => { let active = true; void (async () => { try { const response = await fetch(`/api/auth/invitations/${encodeURIComponent(token)}`); const body = await response.json() as { invitation?: InvitationDetails } & ApiErrorResponse; if (!response.ok || !body.invitation) throw new Error(body.error?.message ?? "This invitation is invalid, expired, or has been replaced."); if (active) setInvitation(body.invitation); } catch (error) { if (active) setLoadError(error instanceof Error ? error.message : "This invitation is unavailable."); } })(); return () => { active = false; }; }, [token]);
  if (loadError) return <div className="auth-form-error" role="alert">{loadError}</div>;
  if (!invitation) return <div className="auth-invite-loading" role="status"><span className="auth-spinner" aria-hidden="true" />Checking your invitation…</div>;
  if (!invitation.requiresPasswordChange) return <><p className="auth-invite-note">Sign in as <strong>{invitation.email}</strong> to join {invitation.workspaceName}. This invitation is valid until {new Date(invitation.expiresAt).toLocaleString()}.</p><LoginForm onAuthenticated={onAuthenticated} initialEmail={invitation.email} inviteToken={token} /></>;
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setFieldError(""); setFormError(""); if (password.length < 8) { setFieldError("Password must be at least 8 characters."); return; } if (password !== confirmPassword) { setFieldError("The passwords do not match."); return; } setIsSubmitting(true); try { const response = await fetch("/api/auth/invitations/activate", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) }); const body = await response.json() as AuthResponse & ApiErrorResponse; if (!response.ok) { setFormError(body.error?.message ?? "We couldn't activate this invitation."); return; } onAuthenticated(body); } catch { setFormError("We couldn't reach TempoLedger. Try again shortly."); } finally { setIsSubmitting(false); } };
  return <><p className="auth-invite-note">Your access to <strong>{invitation.workspaceName}</strong> is ready for <strong>{invitation.email}</strong>. Set a password to activate it. The invitation is valid until {new Date(invitation.expiresAt).toLocaleString()}.</p><form className="auth-form" onSubmit={(event) => void submit(event)} noValidate><label htmlFor="auth-email">Email</label><input id="auth-email" value={invitation.email} readOnly aria-readonly="true" /><PasswordField password={password} showPassword={showPassword} setPassword={(value) => { setPassword(value); setFieldError(""); }} setShowPassword={setShowPassword} error={fieldError || undefined} /><label htmlFor="auth-confirm-password">Confirm password</label><div className="auth-password-field"><input autoComplete="new-password" id="auth-confirm-password" type={showPassword ? "text" : "password"} value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setFieldError(""); }} placeholder="Enter the password again" /></div>{formError && <div className="auth-form-error" role="alert">{formError}</div>}<button className="auth-submit" type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>{isSubmitting && <span className="auth-spinner" aria-hidden="true" />}{isSubmitting ? "Activating access…" : "Set password and log in"}</button></form></>;
}

function AuthCard({ mode, onAuthenticated }: { mode: AuthMode; onAuthenticated: (result: AuthResponse) => void }) {
  const [providerMessage, setProviderMessage] = useState(""); const isSignUp = mode === "signup"; const inviteToken = mode === "login" ? queryInviteToken() : undefined; const isInvitation = Boolean(inviteToken);
  const copy = isInvitation ? ["Workspace invitation", "Join your workspace", "Your account access is ready. Log in or choose your password to continue."] : mode === "signup" ? ["Get started", "Create your workspace", "Create your account, then shape the workspace your team will use."] : mode === "forgot-password" ? ["Account recovery", "Forgot your password?", "Enter your account email and we'll send a secure password-reset link."] : mode === "reset-password" ? ["Secure password reset", "Choose a new password", "Set a new password for your TempoLedger account."] : ["Continue tracking", "Welcome back", "Log in to continue to your workspace."];
  return <section className="auth-card" aria-labelledby="auth-title"><div className="auth-card__heading"><p className="auth-eyebrow">{copy[0]}</p><h1 id="auth-title">{copy[1]}</h1><p>{copy[2]}</p></div>{isSignUp && !isInvitation && <><button className="auth-provider-button" type="button" onClick={() => setProviderMessage("Microsoft sign-up isn't connected to the current email and password backend yet.")}>Continue with Microsoft</button>{providerMessage && <p className="auth-provider-note" role="status">{providerMessage}</p>}<div className="auth-divider" aria-hidden="true"><span>or use email</span></div></>}{isInvitation && inviteToken ? <InvitationForm token={inviteToken} onAuthenticated={onAuthenticated} /> : mode === "signup" ? <SignupForm onAuthenticated={onAuthenticated} /> : mode === "forgot-password" ? <ForgotPasswordForm /> : mode === "reset-password" ? <ResetPasswordForm /> : <LoginForm onAuthenticated={onAuthenticated} />}{!isInvitation && (mode === "signup" || mode === "login") && <AuthFooter mode={mode} />}</section>;
}

export function AuthExperience({ mode, onAuthenticated }: { mode: AuthMode; onAuthenticated: (result: AuthResponse) => void }) {
  return <main className="auth-shell"><header className="auth-shell__header"><Brand /></header><div className="auth-layout"><ProductPreview /><AuthCard mode={mode} onAuthenticated={onAuthenticated} /></div></main>;
}
