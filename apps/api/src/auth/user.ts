import type { User } from "../db/schema.js";

export type PublicUser = {
  id: string;
  email: string;
  createdAt: string;
};

export const toPublicUser = (user: Pick<User, "id" | "email" | "createdAt">): PublicUser => ({
  id: String(user.id),
  email: user.email,
  createdAt: user.createdAt.toISOString(),
});
