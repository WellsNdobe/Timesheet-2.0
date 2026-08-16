import { env } from "../config.js";
import { sendTransactionalEmail } from "./sendTransactionalEmail.js";
import { passwordResetEmail, type PasswordResetTemplateInput } from "./templates/passwordReset.js";

export const sendPasswordReset = async (input: PasswordResetTemplateInput) => {
  if (env.email.provider === "disabled") return { status: "disabled" as const };
  const { default: headerImage } = await import("./assets/tempoledger-invite-header.png");
  const content = passwordResetEmail(input);
  return sendTransactionalEmail({
    fromAddress: env.email.passwordResetFromAddress!,
    replyTo: env.email.passwordResetReplyTo ?? env.email.passwordResetFromAddress,
    recipientEmail: input.recipientEmail,
    subject: content.subject,
    text: content.text,
    html: content.html,
    attachments: [{
      content: headerImage,
      filename: "tempoledger-password-reset.png",
      type: "image/png",
      disposition: "inline",
      contentId: "tempoledger-reset-header",
    }],
  });
};
