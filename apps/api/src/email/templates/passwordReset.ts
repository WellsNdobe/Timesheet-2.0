import { escapeHtml } from "./html.js";

export type PasswordResetTemplateInput = {
  recipientEmail: string;
  resetUrl: string;
  expiresAt: Date;
};

const formatExpiry = (expiresAt: Date) => expiresAt.toLocaleString("en-ZA", {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Africa/Johannesburg",
  timeZoneName: "short",
});

export const passwordResetEmail = (input: PasswordResetTemplateInput) => {
  const recipientEmail = escapeHtml(input.recipientEmail);
  const resetUrl = escapeHtml(input.resetUrl);
  const expiresOn = formatExpiry(input.expiresAt);

  return {
    subject: "Reset your TempoLedger password",
    text: [
      "Reset your TempoLedger password",
      "",
      `We received a password reset request for ${input.recipientEmail}.`,
      `Choose a new password: ${input.resetUrl}`,
      "",
      `This private link expires on ${expiresOn} (30 minutes after it was requested) and can only be used once.`,
      "If you did not request a password reset, you can safely ignore this email. Your password has not changed.",
      "",
      "The TempoLedger team",
    ].join("\n"),
    html: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reset your TempoLedger password</title></head>
<body style="margin:0;background:#f4f4ef;color:#20231f;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Use this private link to choose a new TempoLedger password.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f4ef;"><tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:640px;background:#ffffff;border:1px solid #dedfd8;border-radius:20px;overflow:hidden;">
      <tr><td><img src="cid:tempoledger-reset-header" width="640" alt="TempoLedger" style="display:block;width:100%;height:auto;border:0;"></td></tr>
      <tr><td style="padding:38px 42px 18px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="width:34px;height:34px;border-radius:10px;background:#159947;color:#ffffff;font-size:19px;font-weight:800;text-align:center;line-height:34px;">T</td><td style="padding-left:11px;font-size:18px;font-weight:750;letter-spacing:-0.3px;">TempoLedger</td></tr></table>
        <p style="margin:30px 0 8px;color:#159947;font-size:12px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;">Password reset</p>
        <h1 style="margin:0 0 16px;font-size:34px;line-height:1.15;letter-spacing:-1.2px;">Choose a new password</h1>
        <p style="margin:0 0 26px;color:#64685f;font-size:16px;line-height:1.65;">We received a password reset request for <strong style="color:#20231f;">${recipientEmail}</strong>.</p>
        <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="border-radius:10px;background:#20231f;"><a href="${resetUrl}" style="display:inline-block;padding:15px 23px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:750;">Reset password&nbsp; →</a></td></tr></table>
        <p style="margin:22px 0 0;color:#85897f;font-size:13px;line-height:1.55;">This private link expires on ${expiresOn} (30 minutes after it was requested) and can only be used once.</p>
        <p style="margin:14px 0 0;padding:14px 16px;border-radius:8px;background:#f4f4ef;color:#64685f;font-size:13px;line-height:1.55;"><strong style="color:#20231f;">Didn't request this?</strong><br>You can safely ignore this email. Your password has not changed.</p>
      </td></tr>
      <tr><td style="padding:24px 42px 38px;color:#64685f;font-size:13px;"><div style="height:1px;background:#ecece6;margin-bottom:24px;"></div><strong style="display:block;color:#20231f;font-size:14px;">The TempoLedger team</strong>Time, projects, and progress—in one calm workspace.</td></tr>
      <tr><td style="height:8px;background:linear-gradient(90deg,#159947 0 28%,#66aee8 28% 52%,#b6a3ef 52% 75%,#f5aa82 75% 100%);"></td></tr>
    </table>
  </td></tr></table>
</body></html>`,
  };
};
