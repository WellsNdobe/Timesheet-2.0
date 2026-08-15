import { env } from "../config.js";
import headerImage from "./assets/tempoledger-invite-header.png";
import { workspaceInvitationEmail, type WorkspaceInvitationTemplateInput } from "./templates/workspaceInvitation.js";

export type InvitationDeliveryStatus = "sent" | "queued" | "disabled" | "failed";

const retryableCodes = new Set(["E_RATE_LIMIT_EXCEEDED", "E_DELIVERY_FAILED", "E_INTERNAL_SERVER_ERROR"]);

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export const sendWorkspaceInvitation = async (input: WorkspaceInvitationTemplateInput): Promise<{ status: InvitationDeliveryStatus }> => {
  if (env.email.provider === "disabled") return { status: "disabled" };

  const fromAddress = env.email.fromAddress!;
  const content = workspaceInvitationEmail(input);
  const message: EmailMessageBuilder = {
    from: { email: fromAddress, name: env.email.fromName },
    to: input.recipientEmail,
    ...(env.email.replyTo ? { replyTo: env.email.replyTo } : {}),
    subject: content.subject,
    text: content.text,
    html: content.html,
    attachments: [{
      content: headerImage,
      filename: "tempoledger-workspace.png",
      type: "image/png",
      disposition: "inline",
      contentId: "tempoledger-invite-header",
    }],
  };
  const { env: workerEnv } = await import("cloudflare:workers");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await workerEnv.EMAIL.send(message);
      return { status: "sent" };
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : undefined;
      if (!code || !retryableCodes.has(code) || attempt === 2) throw error;
      await delay(250 * 2 ** attempt);
    }
  }

  throw new Error("Cloudflare Email Service did not accept the message");
};
