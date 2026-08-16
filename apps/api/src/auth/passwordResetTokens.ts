import { createHash, randomBytes } from "node:crypto";

export const passwordResetTokenTtlMs = 30 * 60 * 1_000;

export const createPasswordResetToken = () => randomBytes(32).toString("base64url");
export const hashPasswordResetToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const getPasswordResetTokenExpiry = () => new Date(Date.now() + passwordResetTokenTtlMs);
