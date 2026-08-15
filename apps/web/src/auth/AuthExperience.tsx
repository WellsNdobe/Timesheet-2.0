import { FormEvent, useMemo, useState } from "react";
import "./auth.css";

type AuthMode = "signup" | "login";
type SignupStep = "account" | "workspace" | "success";

export type AuthResponse = {
  accessToken: string;
  user: { id: string; email: string; createdAt: string };
};

type ApiErrorResponse = { error?: { code?: string; message?: string } };
type SignupErrors = { email?: string; password?: string; organizationName?: string; timezone?: string };

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

function AuthFooter({ mode }: { mode: AuthMode }) {
  return <div className="auth-footer"><p>{mode === "signup" ? "Already have an account?" : "New to TempoLedger?"} <a href={mode === "signup" ? "/login" : "/signup"}>{mode === "signup" ? "Log in" : "Create an account"}</a></p>{mode === "signup" && <small>By creating an account, you agree to our <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.</small>}</div>;
}

function PasswordField({ password, showPassword, setPassword, setShowPassword, error }: { password: string; showPassword: boolean; setPassword: (value: string) => void; setShowPassword: (value: boolean) => void; error?: string }) {
  return <><label htmlFor="auth-password">Password</label><div className="auth-password-field"><input autoComplete="new-password" id="auth-password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} aria-describedby={error ? "password-error" : undefined} aria-invalid={Boolean(error)} placeholder="At least 8 characters" /><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={`${showPassword ? "Hide" : "Show"} password`}>{showPassword ? "Hide" : "Show"}</button></div>{error && <InlineFormError id="password-error">{error}</InlineFormError>}</>;
}

function SignupProgress({ step }: { step: Exclude<SignupStep, "success"> }) {
  const number = step === "account" ? 1 : 2;
  return <div className="auth-progress" aria-label={`Signup step ${number} of 2`}><span className="auth-progress__copy">Step {number} of 2</span><span className="auth-progress__track" aria-hidden="true"><i className={`auth-progress__fill${number === 2 ? " auth-progress__fill--complete" : ""}`} /></span></div>;
}

function SignupForm({ onAuthenticated }: { onAuthenticated: (result: AuthResponse) => void }) {
  const inviteToken = useMemo(queryInviteToken, []);
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
    if (isSubmitting || (!inviteToken && !validateWorkspace())) return;
    setFormError(""); setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/register", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(inviteToken ? { email: email.trim(), password, inviteToken } : { email: email.trim(), password, organizationName: organizationName.trim(), timezone }) });
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
    if (inviteToken) void submitRegistration(); else { setFieldErrors({}); setStep("workspace"); }
  };

  if (step === "success") return <div className="auth-success" role="status" aria-live="polite"><span className="auth-success__mark" aria-hidden="true">✓</span><h2>{inviteToken ? "You're all set" : "Your workspace is ready"}</h2><p>{inviteToken ? "Taking you to your team’s workspace…" : `Opening ${organizationName.trim()}…`}</p></div>;

  return <>{!inviteToken && <SignupProgress step={step} />}{inviteToken && <p className="auth-invite-note">You’ve been invited to an existing workspace. Create your account to join it.</p>}
    {step === "account" ? <form className="auth-form auth-step" onSubmit={continueFromAccount} noValidate>
      <label htmlFor="auth-email">Work email</label><input autoComplete="email" autoFocus id="auth-email" type="email" value={email} onChange={(event) => { setEmail(event.target.value); if (fieldErrors.email) setFieldErrors((current) => ({ ...current, email: undefined })); }} aria-describedby={fieldErrors.email ? "email-error" : "email-help"} aria-invalid={Boolean(fieldErrors.email)} placeholder="you@company.com" />
      {fieldErrors.email ? <InlineFormError id="email-error">{fieldErrors.email}</InlineFormError> : <p className="auth-field-help" id="email-help">Use the email you want connected to your workspace.</p>}
      <PasswordField password={password} showPassword={showPassword} setPassword={(value) => { setPassword(value); if (fieldErrors.password) setFieldErrors((current) => ({ ...current, password: undefined })); }} setShowPassword={setShowPassword} error={fieldErrors.password} />
      {formError && <div className="auth-form-error" role="alert">{formError}</div>}
      <button className="auth-submit" type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>{isSubmitting && <span className="auth-spinner" aria-hidden="true" />}{isSubmitting ? "Joining workspace…" : inviteToken ? "Create account and join" : "Continue to workspace"}</button><p className="auth-reassurance">Free to get started · No credit card required</p>
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

function LoginForm({ onAuthenticated }: { onAuthenticated: (result: AuthResponse) => void }) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({}); const [formError, setFormError] = useState(""); const [isSubmitting, setIsSubmitting] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setFormError(""); const errors: typeof fieldErrors = {}; if (!emailPattern.test(email.trim())) errors.email = "Enter a valid email address."; if (password.length < 8) errors.password = "Password must be at least 8 characters."; setFieldErrors(errors); if (Object.keys(errors).length) return; setIsSubmitting(true); try { const response = await fetch("/api/auth/login", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim(), password }) }); const body = await response.json() as AuthResponse & ApiErrorResponse; if (!response.ok) { setFormError(body.error?.code === "invalid_credentials" ? "The email or password is incorrect. Try again." : body.error?.message ?? "We couldn't complete that request. Try again."); return; } onAuthenticated(body); } catch { setFormError("We couldn't reach TempoLedger. Check that the API is running and try again."); } finally { setIsSubmitting(false); } };
  return <form className="auth-form" onSubmit={(event) => void submit(event)} noValidate><label htmlFor="auth-email">Email</label><input autoComplete="email" autoFocus id="auth-email" type="email" value={email} onChange={(event) => { setEmail(event.target.value); if (fieldErrors.email) setFieldErrors((current) => ({ ...current, email: undefined })); }} aria-describedby={fieldErrors.email ? "email-error" : undefined} aria-invalid={Boolean(fieldErrors.email)} placeholder="you@company.com" />{fieldErrors.email && <InlineFormError id="email-error">{fieldErrors.email}</InlineFormError>}<div className="auth-label-row"><label htmlFor="auth-password">Password</label><a href="/forgot-password">Forgot password?</a></div><div className="auth-password-field"><input autoComplete="current-password" id="auth-password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => { setPassword(event.target.value); if (fieldErrors.password) setFieldErrors((current) => ({ ...current, password: undefined })); }} aria-describedby={fieldErrors.password ? "password-error" : undefined} aria-invalid={Boolean(fieldErrors.password)} placeholder="Enter your password" /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={`${showPassword ? "Hide" : "Show"} password`}>{showPassword ? "Hide" : "Show"}</button></div>{fieldErrors.password && <InlineFormError id="password-error">{fieldErrors.password}</InlineFormError>}{formError && <div className="auth-form-error" role="alert">{formError}</div>}<button className="auth-submit" type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>{isSubmitting && <span className="auth-spinner" aria-hidden="true" />}{isSubmitting ? "Logging in…" : "Log in"}</button></form>;
}

function AuthCard({ mode, onAuthenticated }: { mode: AuthMode; onAuthenticated: (result: AuthResponse) => void }) {
  const [providerMessage, setProviderMessage] = useState(""); const isSignUp = mode === "signup"; const isInvitation = isSignUp && Boolean(queryInviteToken());
  return <section className="auth-card" aria-labelledby="auth-title"><div className="auth-card__heading"><p className="auth-eyebrow">{isSignUp ? "Get started" : "Continue tracking"}</p><h1 id="auth-title">{isInvitation ? "Join your workspace" : isSignUp ? "Create your workspace" : "Welcome back"}</h1><p>{isInvitation ? "Create your account to join the team that invited you." : isSignUp ? "Create your account, then shape the workspace your team will use." : "Log in to continue to your workspace."}</p></div>{isSignUp && <><button className="auth-provider-button" type="button" onClick={() => setProviderMessage("Microsoft sign-up isn't connected to the current email and password backend yet.")}>Continue with Microsoft</button>{providerMessage && <p className="auth-provider-note" role="status">{providerMessage}</p>}<div className="auth-divider" aria-hidden="true"><span>or use email</span></div></>}{isSignUp ? <SignupForm onAuthenticated={onAuthenticated} /> : <LoginForm onAuthenticated={onAuthenticated} />}<AuthFooter mode={mode} /></section>;
}

export function AuthExperience({ mode, onAuthenticated }: { mode: AuthMode; onAuthenticated: (result: AuthResponse) => void }) {
  return <main className="auth-shell"><header className="auth-shell__header"><Brand /></header><div className="auth-layout"><ProductPreview /><AuthCard mode={mode} onAuthenticated={onAuthenticated} /></div></main>;
}
