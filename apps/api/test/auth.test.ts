import { SignJWT } from "jose";
import { Client } from "pg";
import request, { type Response as SupertestResponse } from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Express } from "express";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import * as schema from "../src/db/schema.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL
  ?? "postgresql://postgres:postgres@localhost:5432/timesheet_test";
const jwtSecret = "integration-test-secret-with-at-least-32-characters";
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");

let app: Express;
let db: NodePgDatabase<typeof schema>;
let pool: Pool;

const cookieFrom = (response: SupertestResponse) => {
  const header = response.headers["set-cookie"];
  const value = Array.isArray(header) ? header[0] : header;

  if (!value) {
    throw new Error("Expected a refresh cookie");
  }

  return value.split(";", 1)[0];
};

const register = (email = "maia@example.com", password = "correct-horse-battery") => request(app)
  .post("/api/auth/register")
  .send({ email, password });

beforeAll(async () => {
  const target = new URL(testDatabaseUrl);
  const databaseName = target.pathname.slice(1);

  if (!/^[a-z0-9_]+$/.test(databaseName)) {
    throw new Error("TEST_DATABASE_URL must use a simple lowercase database name");
  }

  const adminUrl = new URL(target);
  adminUrl.pathname = "/postgres";
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();

  try {
    const existing = await admin.query("select 1 from pg_database where datname = $1", [databaseName]);
    if (existing.rowCount === 0) {
      await admin.query(`create database "${databaseName}"`);
    }
  } finally {
    await admin.end();
  }

  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.JWT_ACCESS_SECRET = jwtSecret;
  process.env.WEB_ORIGIN = "http://localhost:5173";

  const clientModule = await import("../src/db/client.js");
  const appModule = await import("../src/app.js");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");

  db = clientModule.db;
  pool = clientModule.pool;
  app = appModule.app;
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  await db.delete(schema.authSessions);
  await db.delete(schema.users);
});

afterAll(async () => {
  await pool?.end();
});

describe.sequential("email authentication", () => {
  it("registers, normalizes the email, hashes the password, and signs the user in", async () => {
    const response = await register("  Maia@Example.COM  ");

    expect(response.status).toBe(201);
    expect(response.body.user).toMatchObject({ email: "maia@example.com" });
    expect(response.body.user.id).toEqual(expect.any(String));
    expect(response.body.user.createdAt).toEqual(expect.any(String));
    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body).not.toHaveProperty("passwordHash");
    expect(cookieFrom(response)).toMatch(/^refresh_token=/);

    const [storedUser] = await db.select().from(schema.users);
    expect(storedUser.passwordHash).toMatch(/^\$argon2id\$/);
    expect(storedUser.passwordHash).not.toContain("correct-horse-battery");
  });

  it("rejects malformed registrations and case-insensitive duplicate emails", async () => {
    expect((await register("not-an-email", "short")).status).toBe(400);
    expect((await register("maia@example.com")).status).toBe(201);

    const duplicate = await register("MAIA@EXAMPLE.COM");
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("email_already_registered");
  });

  it("logs in with valid credentials and uses one generic error for invalid credentials", async () => {
    await register();

    const valid = await request(app)
      .post("/api/auth/login")
      .send({ email: "MAIA@EXAMPLE.COM", password: "correct-horse-battery" });
    const wrongPassword = await request(app)
      .post("/api/auth/login")
      .send({ email: "maia@example.com", password: "incorrect-password" });
    const unknownUser = await request(app)
      .post("/api/auth/login")
      .send({ email: "unknown@example.com", password: "incorrect-password" });

    expect(valid.status).toBe(200);
    expect(valid.body.accessToken).toEqual(expect.any(String));
    expect(cookieFrom(valid)).toMatch(/^refresh_token=/);
    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownUser.body);
  });

  it("protects the current-user endpoint from missing, invalid, and expired access tokens", async () => {
    const registration = await register();
    const accessToken = registration.body.accessToken as string;

    const currentUser = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${accessToken}`);
    const missing = await request(app).get("/api/auth/me");
    const invalid = await request(app)
      .get("/api/auth/me")
      .set("Authorization", "Bearer invalid-token");

    const expiredToken = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(registration.body.user.id)
      .setIssuer("tempoledger-api")
      .setAudience("tempoledger-web")
      .setIssuedAt(Math.floor(Date.now() / 1_000) - 120)
      .setExpirationTime(Math.floor(Date.now() / 1_000) - 60)
      .sign(new TextEncoder().encode(jwtSecret));
    const expired = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${expiredToken}`);

    expect(currentUser.status).toBe(200);
    expect(currentUser.body.user.email).toBe("maia@example.com");
    expect(missing.status).toBe(401);
    expect(invalid.status).toBe(401);
    expect(expired.status).toBe(401);
  });

  it("rotates refresh tokens and rejects reuse of the revoked token", async () => {
    const registration = await register();
    const firstCookie = cookieFrom(registration);

    const refreshed = await request(app).post("/api/auth/refresh").set("Cookie", firstCookie);
    const secondCookie = cookieFrom(refreshed);
    const reuse = await request(app).post("/api/auth/refresh").set("Cookie", firstCookie);
    const refreshedAgain = await request(app).post("/api/auth/refresh").set("Cookie", secondCookie);

    expect(refreshed.status).toBe(200);
    expect(refreshed.body.accessToken).toEqual(expect.any(String));
    expect(secondCookie).not.toBe(firstCookie);
    expect(reuse.status).toBe(401);
    expect(refreshedAgain.status).toBe(200);
  });

  it("revokes the refresh session on logout", async () => {
    const registration = await register();
    const cookie = cookieFrom(registration);

    const logout = await request(app).post("/api/auth/logout").set("Cookie", cookie);
    const refresh = await request(app).post("/api/auth/refresh").set("Cookie", cookie);

    expect(logout.status).toBe(204);
    expect(refresh.status).toBe(401);
  });
});
