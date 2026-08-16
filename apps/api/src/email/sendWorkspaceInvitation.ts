import { env } from "../config.js";
import { sendTransactionalEmail } from "./sendTransactionalEmail.js";
import { workspaceInvitationEmail, type WorkspaceInvitationTemplateInput } from "./templates/workspaceInvitation.js";

export type InvitationDeliveryStatus = "sent" | "queued" | "disabled" | "failed";

export const sendWorkspaceInvitation = async (input: WorkspaceInvitationTemplateInput): Promise<{ status: InvitationDeliveryStatus }> => {
  if (env.email.provider === "disabled") return { status: "disabled" };
  const { default: headerImage } = await import("./assets/tempoledger-invite-header.png");
  const content = workspaceInvitationEmail(input);
  return sendTransactionalEmail({
    fromAddress: env.email.fromAddress!,
    recipientEmail: input.recipientEmail,
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
  });
};
