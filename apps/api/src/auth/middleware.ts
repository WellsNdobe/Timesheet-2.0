import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { ApiError, asyncHandler } from "../errors.js";
import { verifyAccessToken } from "./tokens.js";
import { toPublicUser } from "./user.js";

export const authenticate = asyncHandler(async (request, response, next) => {
  const authorization = request.header("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    throw new ApiError(401, "auth_required", "Authentication is required.");
  }

  try {
    const userId = await verifyAccessToken(authorization.slice("Bearer ".length));
    const [user] = await db
      .select({ id: users.id, email: users.email, createdAt: users.createdAt })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.isActive, true)))
      .limit(1);

    if (!user) {
      throw new ApiError(401, "auth_required", "Authentication is required.");
    }

    response.locals.authUser = toPublicUser(user);
    next();
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(401, "invalid_access_token", "The access token is invalid or expired.");
  }
});
