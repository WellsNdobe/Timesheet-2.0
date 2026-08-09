import { and, eq, gt, isNull } from "drizzle-orm";
import { Router, type CookieOptions } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { env } from "../config.js";
import { db } from "../db/client.js";
import { authSessions, users } from "../db/schema.js";
import { ApiError, asyncHandler } from "../errors.js";
import { authenticate } from "./middleware.js";
import { dummyPasswordHash, hashPassword, verifyPassword } from "./passwords.js";
import {
  createAccessToken,
  createRefreshToken,
  getRefreshTokenExpiry,
  hashRefreshToken,
  refreshTokenTtlMs,
} from "./tokens.js";
import { toPublicUser } from "./user.js";

const refreshCookieName = "refresh_token";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(8).max(128),
}).strict();

const refreshCookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: env.nodeEnv === "production",
  path: "/api/auth",
};

const setRefreshCookie = (response: Parameters<Parameters<typeof asyncHandler>[0]>[1], token: string) => {
  response.cookie(refreshCookieName, token, {
    ...refreshCookieOptions,
    maxAge: refreshTokenTtlMs,
  });
};

const clearRefreshCookie = (response: Parameters<Parameters<typeof asyncHandler>[0]>[1]) => {
  response.clearCookie(refreshCookieName, refreshCookieOptions);
};

const parseCredentials = (body: unknown) => {
  const result = credentialsSchema.safeParse(body);

  if (!result.success) {
    throw new ApiError(400, "validation_error", "A valid email and a password of 8 to 128 characters are required.");
  }

  return result.data;
};

const isUniqueViolation = (error: unknown) => {
  let current = error;

  for (let depth = 0; depth < 3 && typeof current === "object" && current !== null; depth += 1) {
    if ("code" in current && current.code === "23505") {
      return true;
    }

    current = "cause" in current ? current.cause : undefined;
  }

  return false;
};

const limiter = rateLimit({
  windowMs: 15 * 60 * 1_000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skip: () => env.nodeEnv === "test",
  handler: (_request, response) => {
    response.status(429).json({
      error: { code: "rate_limited", message: "Too many authentication attempts. Please try again later." },
    });
  },
});

export const authRouter = Router();

authRouter.use(limiter);

authRouter.post("/register", asyncHandler(async (request, response) => {
  const credentials = parseCredentials(request.body);
  const passwordHash = await hashPassword(credentials.password);

  try {
    const result = await db.transaction(async (transaction) => {
      const [user] = await transaction
        .insert(users)
        .values({ email: credentials.email, passwordHash })
        .returning({ id: users.id, email: users.email, createdAt: users.createdAt });

      const refreshToken = createRefreshToken();
      await transaction.insert(authSessions).values({
        userId: user.id,
        refreshTokenHash: hashRefreshToken(refreshToken),
        expiresAt: getRefreshTokenExpiry(),
      });

      return { user, refreshToken };
    });

    setRefreshCookie(response, result.refreshToken);
    response.status(201).json({
      user: toPublicUser(result.user),
      accessToken: await createAccessToken(result.user.id),
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ApiError(409, "email_already_registered", "An account with this email already exists.");
    }

    throw error;
  }
}));

authRouter.post("/login", asyncHandler(async (request, response) => {
  const credentials = parseCredentials(request.body);
  const [user] = await db.select().from(users).where(eq(users.email, credentials.email)).limit(1);
  const passwordMatches = await verifyPassword(user?.passwordHash ?? await dummyPasswordHash, credentials.password);

  if (!user || !user.isActive || !passwordMatches) {
    throw new ApiError(401, "invalid_credentials", "The email or password is incorrect.");
  }

  const refreshToken = createRefreshToken();
  const now = new Date();

  await db.transaction(async (transaction) => {
    await transaction
      .update(users)
      .set({ lastLoginAt: now, updatedAt: now })
      .where(eq(users.id, user.id));
    await transaction.insert(authSessions).values({
      userId: user.id,
      refreshTokenHash: hashRefreshToken(refreshToken),
      expiresAt: getRefreshTokenExpiry(),
    });
  });

  setRefreshCookie(response, refreshToken);
  response.json({ user: toPublicUser(user), accessToken: await createAccessToken(user.id) });
}));

authRouter.post("/refresh", asyncHandler(async (request, response) => {
  const currentToken = request.cookies[refreshCookieName] as string | undefined;

  if (!currentToken) {
    throw new ApiError(401, "invalid_refresh_token", "The refresh session is invalid or expired.");
  }

  const now = new Date();
  const nextToken = createRefreshToken();
  const result = await db.transaction(async (transaction) => {
    const [session] = await transaction
      .update(authSessions)
      .set({ revokedAt: now })
      .where(and(
        eq(authSessions.refreshTokenHash, hashRefreshToken(currentToken)),
        isNull(authSessions.revokedAt),
        gt(authSessions.expiresAt, now),
      ))
      .returning({ userId: authSessions.userId });

    if (!session) {
      return null;
    }

    const [user] = await transaction
      .select({ id: users.id, email: users.email, createdAt: users.createdAt })
      .from(users)
      .where(and(eq(users.id, session.userId), eq(users.isActive, true)))
      .limit(1);

    if (!user) {
      return null;
    }

    await transaction.insert(authSessions).values({
      userId: user.id,
      refreshTokenHash: hashRefreshToken(nextToken),
      expiresAt: getRefreshTokenExpiry(),
    });

    return user;
  });

  if (!result) {
    clearRefreshCookie(response);
    throw new ApiError(401, "invalid_refresh_token", "The refresh session is invalid or expired.");
  }

  setRefreshCookie(response, nextToken);
  response.json({ accessToken: await createAccessToken(result.id) });
}));

authRouter.post("/logout", asyncHandler(async (request, response) => {
  const refreshToken = request.cookies[refreshCookieName] as string | undefined;

  if (refreshToken) {
    await db
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(and(
        eq(authSessions.refreshTokenHash, hashRefreshToken(refreshToken)),
        isNull(authSessions.revokedAt),
      ));
  }

  clearRefreshCookie(response);
  response.status(204).send();
}));

authRouter.get("/me", authenticate, (_request, response) => {
  response.json({ user: response.locals.authUser });
});
