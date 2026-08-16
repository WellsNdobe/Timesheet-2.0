import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { env } from "../config.js";

const issuer = "tempoledger-api";
const audience = "tempoledger-web";
const accessTokenTtl = "15m";

export const refreshTokenTtlMs = 30 * 24 * 60 * 60 * 1_000;

const signingKey = new TextEncoder().encode(env.jwtAccessSecret);

export const createAccessToken = (userId: number, authVersion: number) => new SignJWT({ auth_version: authVersion })
  .setProtectedHeader({ alg: "HS256" })
  .setSubject(String(userId))
  .setIssuer(issuer)
  .setAudience(audience)
  .setIssuedAt()
  .setExpirationTime(accessTokenTtl)
  .sign(signingKey);

export const verifyAccessToken = async (token: string) => {
  const { payload } = await jwtVerify(token, signingKey, { issuer, audience });
  const userId = Number(payload.sub);

  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new Error("Invalid access token subject");
  }

  const authVersion = payload.auth_version === undefined ? 0 : Number(payload.auth_version);
  if (!Number.isSafeInteger(authVersion) || authVersion < 0) {
    throw new Error("Invalid access token auth version");
  }

  return { userId, authVersion };
};

export const createRefreshToken = () => randomBytes(32).toString("base64url");

export const hashRefreshToken = (token: string) => createHash("sha256").update(token).digest("hex");

export const getRefreshTokenExpiry = () => new Date(Date.now() + refreshTokenTtlMs);
