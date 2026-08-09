import argon2 from "argon2";

export const hashPassword = (password: string) => argon2.hash(password, {
  type: argon2.argon2id,
});

export const verifyPassword = (hash: string, password: string) => argon2.verify(hash, password);

export const dummyPasswordHash = hashPassword("not-a-real-user-password");
