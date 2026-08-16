import { env } from "../config.js";

export type EmailDeliveryStatus = "sent" | "disabled";

type TransactionalEmail = {
  fromAddress: string;
  recipientEmail: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string | null;
  attachments?: EmailMessageBuilder["attachments"];
};

const retryableCodes = new Set(["E_RATE_LIMIT_EXCEEDED", "E_DELIVERY_FAILED", "E_INTERNAL_SERVER_ERROR"]);
const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export const sendTransactionalEmail = async (input: TransactionalEmail): Promise<{ status: EmailDeliveryStatus }> => {
  if (env.email.provider === "disabled") return { status: "disabled" };

  const replyTo = input.replyTo === undefined ? env.email.replyTo : input.replyTo;
  const message: EmailMessageBuilder = {
    from: { email: input.fromAddress, name: env.email.fromName },
    to: input.recipientEmail,
    ...(replyTo ? { replyTo } : {}),
    subject: input.subject,
    text: input.text,
    html: input.html,
    ...(input.attachments ? { attachments: input.attachments } : {}),
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
