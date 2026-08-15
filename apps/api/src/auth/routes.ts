import { and, eq, gt, isNull } from "drizzle-orm";
import { Router, type CookieOptions, type RequestHandler } from "express";
import { z } from "zod";
import { env } from "../config.js";
import { db } from "../db/client.js";
import { authSessions, users, workspaceMemberships, workspaces } from "../db/schema.js";
import { ApiError, asyncHandler } from "../errors.js";
import { authenticate } from "./middleware.js";
import { getDummyPasswordHash, hashPassword, verifyPassword } from "./passwords.js";
import {
  createAccessToken,
  createRefreshToken,
  getRefreshTokenExpiry,
  hashRefreshToken,
  refreshTokenTtlMs,
} from "./tokens.js";
import { toPublicUser } from "./user.js";
import { acceptInvitationForUser } from "../workspaces/routes.js";

const refreshCookieName = "refresh_token";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(8).max(128),
}).strict();

const timezoneSchema = z.string().trim().min(1).max(100).refine((timezone) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}, "A valid IANA timezone is required.");

const directRegistrationSchema = credentialsSchema.extend({
  organizationName: z.string().trim().min(1).max(120),
  timezone: timezoneSchema,
}).strict();

const invitationRegistrationSchema = credentialsSchema.extend({
  inviteToken: z.string().trim().min(20).max(512),
}).strict();

const registrationSchema = z.union([directRegistrationSchema, invitationRegistrationSchema]);

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

const authLimit = 20;
const authWindowMs = 15 * 60 * 1_000;
const authAttempts = new Map<string, { count: number; resetAt: number }>();

const limiter: RequestHandler = (request, response, next) => {
  if (env.nodeEnv === "test") return next();

  const now = Date.now();
  const key = request.get("cf-connecting-ip") ?? request.ip ?? "unknown";
  const previous = authAttempts.get(key);
  const attempt = !previous || previous.resetAt <= now
    ? { count: 1, resetAt: now + authWindowMs }
    : { count: previous.count + 1, resetAt: previous.resetAt };
  authAttempts.set(key, attempt);

  response.setHeader("RateLimit-Limit", authLimit);
  response.setHeader("RateLimit-Remaining", Math.max(0, authLimit - attempt.count));
  response.setHeader("RateLimit-Reset", Math.ceil((attempt.resetAt - now) / 1_000));

  if (attempt.count > authLimit) {
    response.status(429).json({
      error: { code: "rate_limited", message: "Too many authentication attempts. Please try again later." },
    });
    return;
  }

  next();
};

export const authRouter = Router();

authRouter.use(limiter);

authRouter.post("/register", asyncHandler(async (request, response) => {
  const parsedRegistration = registrationSchema.safeParse(request.body);
  if (!parsedRegistration.success) {
    throw new ApiError(400, "validation_error", "Valid account and workspace details are required.");
  }
  const credentials = parsedRegistration.data;
  const passwordHash = await hashPassword(credentials.password);

  try {
    const result = await db.transaction(async (transaction) => {
      const [user] = await transaction
        .insert(users)
        .values({ email: credentials.email, passwordHash })
        .returning({ id: users.id, email: users.email, createdAt: users.createdAt });

      if ("inviteToken" in credentials) {
        await acceptInvitationForUser(transaction, { id: user.id, email: user.email }, credentials.inviteToken);
      } else {
        const [workspace] = await transaction.insert(workspaces).values({
          name: credentials.organizationName,
          timezone: credentials.timezone,
          createdByUserId: user.id,
        }).returning({ id: workspaces.id });
        await transaction.insert(workspaceMemberships).values({ workspaceId: workspace.id, userId: user.id, role: "admin" });
      }

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
  const passwordMatches = await verifyPassword(user?.passwordHash ?? await getDummyPasswordHash(), credentials.password);

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
