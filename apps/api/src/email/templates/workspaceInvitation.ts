import { escapeHtml } from "./html.js";

const roleLabel = (role: "manager" | "member") => role === "manager" ? "Manager" : "Member";

export type WorkspaceInvitationTemplateInput = {
  recipientEmail: string;
  inviterEmail: string;
  workspaceName: string;
  role: "manager" | "member";
  acceptUrl: string;
  expiresAt: Date;
};

export const workspaceInvitationEmail = (input: WorkspaceInvitationTemplateInput) => {
  const workspaceName = escapeHtml(input.workspaceName);
  const inviterEmail = escapeHtml(input.inviterEmail);
  const recipientEmail = escapeHtml(input.recipientEmail);
  const acceptUrl = escapeHtml(input.acceptUrl);
  const expiresOn = input.expiresAt.toLocaleString("en-ZA", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Johannesburg", timeZoneName: "short" });
  const role = roleLabel(input.role);
  const subjectWorkspace = input.workspaceName.replace(/[\r\n]+/g, " ").trim();

  return {
    subject: `You're invited to ${subjectWorkspace} on TempoLedger`,
    text: [
      `You've been invited to ${input.workspaceName} on TempoLedger.`,
      "",
      `${input.inviterEmail} invited ${input.recipientEmail} to join as a ${role}.`,
      `Open your invitation and activate access: ${input.acceptUrl}`,
      "Log in with your existing TempoLedger password, or set a password if this is your first invitation.",
      "",
      `This invitation expires on ${expiresOn}. If you weren't expecting it, you can safely ignore this email.`,
      "",
      "The TempoLedger team",
      "Time, projects, and progress—in one calm workspace.",
    ].join("\n"),
    html: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TempoLedger workspace invitation</title></head>
<body style="margin:0;background:#f4f4ef;color:#20231f;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${inviterEmail} invited you to join ${workspaceName} on TempoLedger.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f4ef;"><tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:640px;background:#ffffff;border:1px solid #dedfd8;border-radius:20px;overflow:hidden;">
      <tr><td><img src="cid:tempoledger-invite-header" width="640" alt="TempoLedger workspace overview" style="display:block;width:100%;height:auto;border:0;"></td></tr>
      <tr><td style="padding:38px 42px 18px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="width:34px;height:34px;border-radius:10px;background:#159947;color:#ffffff;font-size:19px;font-weight:800;text-align:center;line-height:34px;">T</td><td style="padding-left:11px;font-size:18px;font-weight:750;letter-spacing:-0.3px;">TempoLedger</td></tr></table>
        <p style="margin:30px 0 8px;color:#159947;font-size:12px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;">Workspace invitation</p>
        <h1 style="margin:0 0 16px;font-size:34px;line-height:1.15;letter-spacing:-1.2px;">Come work with us in<br>${workspaceName}</h1>
        <p style="margin:0 0 26px;color:#64685f;font-size:16px;line-height:1.65;">${inviterEmail} invited <strong style="color:#20231f;">${recipientEmail}</strong> to join the workspace as a <strong style="color:#20231f;">${role}</strong>.</p>
        <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="border-radius:10px;background:#20231f;"><a href="${acceptUrl}" style="display:inline-block;padding:15px 23px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:750;">Activate workspace access&nbsp; →</a></td></tr></table>
        <p style="margin:22px 0 0;color:#85897f;font-size:13px;line-height:1.55;">Open the link to log in, or set a password if this is your first TempoLedger invitation. This private link expires on ${expiresOn}. If you weren't expecting it, you can safely ignore this email.</p>
      </td></tr>
      <tr><td style="padding:24px 42px 38px;">
        <div style="height:1px;background:#ecece6;margin-bottom:24px;"></div>
        <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="vertical-align:top;width:42px;"><div style="width:34px;height:34px;border-radius:50%;background:#dff5e6;color:#159947;font-size:17px;font-weight:800;text-align:center;line-height:34px;">T</div></td><td style="color:#64685f;font-size:13px;line-height:1.5;"><strong style="display:block;color:#20231f;font-size:14px;">The TempoLedger team</strong>Time, projects, and progress—in one calm workspace.</td></tr></table>
      </td></tr>
      <tr><td style="height:8px;background:linear-gradient(90deg,#159947 0 28%,#66aee8 28% 52%,#b6a3ef 52% 75%,#f5aa82 75% 100%);"></td></tr>
    </table>
    <p style="margin:18px 0 0;color:#92968e;font-size:12px;">TempoLedger · Practical time tracking for modern teams</p>
  </td></tr></table>
</body></html>`,
  };
};
