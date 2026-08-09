import { FormEvent, useState } from "react";
import "./auth.css";

type AuthMode = "signup" | "login";

type AuthResponse = {
  accessToken: string;
  user: { id: string; email: string; createdAt: string };
};

type ApiErrorResponse = {
  error?: { code?: string; message?: string };
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function Brand() {
  return <a className="auth-brand" href="/" aria-label="TempoLedger home"><span className="brand-mark">T</span><strong>tempo<span>ledger</span></strong></a>;
}

function InlineFormError({ id, children }: { id: string; children: string }) {
  return <p className="auth-field-error" id={id} role="alert">{children}</p>;
}

function AuthDivider() {
  return <div className="auth-divider" aria-hidden="true"><span>or use email</span></div>;
}

function MicrosoftSignUpButton({ onClick }: { onClick: () => void }) {
  return <button className="auth-provider-button" type="button" onClick={onClick}>Continue with Microsoft</button>;
}

function ProductPreview() {
  return (
    <aside className="auth-product" aria-label="TempoLedger product overview">
      <div className="auth-product__copy">
        <p className="auth-eyebrow">A clearer working week</p>
        <h2>Keep time, budgets, and project progress in one calm workspace.</h2>
        <p>Start quickly, stay on top of billable work, and know what needs attention without chasing spreadsheets.</p>
      </div>
      <div className="auth-preview-card" aria-label="Sample weekly time summary">
        <div className="auth-preview-card__heading"><div><span>This week</span><strong>24h 40m</strong></div><small>62% of target</small></div>
        <div className="auth-preview-progress"><span /></div>
        <div className="auth-preview-stats"><span>Billable<strong>18h 20m</strong></span><span>Non-billable<strong>6h 20m</strong></span></div>
        <div className="auth-preview-project"><span className="auth-preview-project__initial">N</span><div><strong>Northstar redesign</strong><small>On track</small></div><b>18h 20m</b></div>
      </div>
      <div className="auth-benefits" aria-label="Product benefits">
        <span><b>01</b>Track work while it is fresh.</span>
        <span><b>02</b>Keep project budgets visible.</span>
        <span><b>03</b>Review progress without extra admin.</span>
      </div>
    </aside>
  );
}

function AuthFooter({ mode }: { mode: AuthMode }) {
  return (
    <div className="auth-footer">
      <p>{mode === "signup" ? "Already have an account?" : "New to TempoLedger?"} <a href={mode === "signup" ? "/login" : "/signup"}>{mode === "signup" ? "Log in" : "Create an account"}</a></p>
      {mode === "signup" && <small>By creating an account, you agree to our <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.</small>}
    </div>
  );
}

function EmailAuthForm({ mode, onAuthenticated }: { mode: AuthMode; onAuthenticated: (result: AuthResponse) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validate = () => {
    const nextErrors: { email?: string; password?: string } = {};
    if (!emailPattern.test(email.trim())) nextErrors.email = "Enter a valid email address.";
    if (password.length < 8) nextErrors.password = "Password must be at least 8 characters.";
    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");
    if (!validate()) return;
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/auth/${mode === "signup" ? "register" : "login"}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const body = await response.json() as AuthResponse & ApiErrorResponse;
      if (!response.ok) {
        if (body.error?.code === "email_already_registered") setFieldErrors({ email: "An account with this email already exists. Log in instead." });
        else if (body.error?.code === "invalid_credentials") setFormError("The email or password is incorrect. Try again.");
        else setFormError(body.error?.message ?? "We couldn't complete that request. Try again.");
        return;
      }
      onAuthenticated(body);
    } catch {
      setFormError("We couldn't reach TempoLedger. Check that the API is running and try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form className="auth-form" onSubmit={handleSubmit} noValidate>
      <label htmlFor="auth-email">{mode === "signup" ? "Work email" : "Email"}</label>
      <input autoComplete="email" autoFocus id="auth-email" type="email" value={email} onChange={(event) => { setEmail(event.target.value); if (fieldErrors.email) setFieldErrors((current) => ({ ...current, email: undefined })); }} aria-describedby={fieldErrors.email ? "email-error" : mode === "signup" ? "email-help" : undefined} aria-invalid={Boolean(fieldErrors.email)} placeholder="you@company.com" />
      {fieldErrors.email ? <InlineFormError id="email-error">{fieldErrors.email}</InlineFormError> : mode === "signup" && <p className="auth-field-help" id="email-help">Use the email you want connected to your workspace.</p>}

      <div className="auth-label-row"><label htmlFor="auth-password">Password</label>{mode === "login" && <a href="/forgot-password">Forgot password?</a>}</div>
      <div className="auth-password-field">
        <input autoComplete={mode === "signup" ? "new-password" : "current-password"} id="auth-password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => { setPassword(event.target.value); if (fieldErrors.password) setFieldErrors((current) => ({ ...current, password: undefined })); }} aria-describedby={fieldErrors.password ? "password-error" : undefined} aria-invalid={Boolean(fieldErrors.password)} placeholder={mode === "signup" ? "At least 8 characters" : "Enter your password"} />
        <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={`${showPassword ? "Hide" : "Show"} password`}>{showPassword ? "Hide" : "Show"}</button>
      </div>
      {fieldErrors.password && <InlineFormError id="password-error">{fieldErrors.password}</InlineFormError>}
      {formError && <div className="auth-form-error" role="alert">{formError}</div>}
      <button className="auth-submit" type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>{isSubmitting ? (mode === "signup" ? "Creating account…" : "Logging in…") : (mode === "signup" ? "Create account" : "Log in")}</button>
      {mode === "signup" && <p className="auth-reassurance">Free to get started · No credit card required</p>}
    </form>
  );
}

function AuthCard({ mode, onAuthenticated }: { mode: AuthMode; onAuthenticated: (result: AuthResponse) => void }) {
  const [providerMessage, setProviderMessage] = useState("");
  const isSignUp = mode === "signup";
  return (
    <section className="auth-card" aria-labelledby="auth-title">
      <div className="auth-card__heading"><p className="auth-eyebrow">{isSignUp ? "Get started" : "Continue tracking"}</p><h1 id="auth-title">{isSignUp ? "Create your workspace" : "Welcome back"}</h1><p>{isSignUp ? "Track time, keep projects healthy, and make every working hour visible." : "Log in to continue to your workspace."}</p></div>
      {isSignUp && <><MicrosoftSignUpButton onClick={() => setProviderMessage("Microsoft sign-up isn't connected to the current email and password backend yet.")} />{providerMessage && <p className="auth-provider-note" role="status">{providerMessage}</p>}<AuthDivider /></>}
      <EmailAuthForm mode={mode} onAuthenticated={onAuthenticated} />
      <AuthFooter mode={mode} />
    </section>
  );
}

export function AuthExperience({ mode, onAuthenticated }: { mode: AuthMode; onAuthenticated: (result: AuthResponse) => void }) {
  return <main className="auth-shell"><header className="auth-shell__header"><Brand /></header><div className="auth-layout"><ProductPreview /><AuthCard mode={mode} onAuthenticated={onAuthenticated} /></div></main>;
}
