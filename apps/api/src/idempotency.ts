import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { Request } from "express";
import { z } from "zod";
import { env } from "./config.js";
import { ApiError } from "./errors.js";

export const idempotencyTtlMs = 24 * 60 * 60 * 1_000;
export const staleOperationMs = 5 * 60 * 1_000;

const idempotencyKeySchema = z.string().uuid();
const encryptionKey = createHash("sha256")
  .update("tempoledger:idempotency-response:v1:")
  .update(env.jwtAccessSecret)
  .digest();

export const parseIdempotencyKey = (request: Request) => {
  const parsed = idempotencyKeySchema.safeParse(request.get("Idempotency-Key"));
  if (!parsed.success) throw new ApiError(400, "invalid_idempotency_key", "A valid UUID Idempotency-Key header is required.");
  return parsed.data;
};

export const fingerprintRequest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export const encryptIdempotencyResponse = (value: unknown) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
};

export const decryptIdempotencyResponse = <T>(payload: string): T => {
  const [ivValue, tagValue, ciphertextValue] = payload.split(".");
  if (!ivValue || !tagValue || !ciphertextValue) throw new Error("Invalid encrypted idempotency response");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextValue, "base64url")), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as T;
};

export const idempotencyKeyReused = () => new ApiError(409, "idempotency_key_reused", "This Idempotency-Key was already used with different request data.");
