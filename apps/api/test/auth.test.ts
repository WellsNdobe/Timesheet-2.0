import { SignJWT } from "jose";
import { and, eq } from "drizzle-orm";
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

const createRoleFixture = async () => {
  const adminRegistration = await register("admin@example.com");
  const managerRegistration = await register("manager@example.com");
  const memberRegistration = await register("member@example.com");
  const [adminUser] = await db.select().from(schema.users).where(eq(schema.users.email, "admin@example.com"));
  const [managerUser] = await db.select().from(schema.users).where(eq(schema.users.email, "manager@example.com"));
  const [memberUser] = await db.select().from(schema.users).where(eq(schema.users.email, "member@example.com"));
  const [adminMembership] = await db.select().from(schema.workspaceMemberships).where(eq(schema.workspaceMemberships.userId, adminUser.id));
  const [managerPersonalMembership] = await db.select().from(schema.workspaceMemberships).where(eq(schema.workspaceMemberships.userId, managerUser.id));
  const [memberPersonalMembership] = await db.select().from(schema.workspaceMemberships).where(eq(schema.workspaceMemberships.userId, memberUser.id));
  const [managerMembership] = await db.insert(schema.workspaceMemberships).values({ workspaceId: adminMembership.workspaceId, userId: managerUser.id, role: "manager" }).returning();
  const [memberMembership] = await db.insert(schema.workspaceMemberships).values({ workspaceId: adminMembership.workspaceId, userId: memberUser.id, role: "member" }).returning();
  const [assignedProject] = await db.insert(schema.projects).values({ workspaceId: adminMembership.workspaceId, name: "Assigned project", approverMembershipId: managerMembership.id }).returning();
  const [adminProject] = await db.insert(schema.projects).values({ workspaceId: adminMembership.workspaceId, name: "Admin project", approverMembershipId: adminMembership.id }).returning();
  return {
    admin: { token: adminRegistration.body.accessToken as string, membership: adminMembership },
    manager: { token: managerRegistration.body.accessToken as string, membership: managerMembership },
    member: { token: memberRegistration.body.accessToken as string, membership: memberMembership },
    managerPersonalWorkspaceId: managerPersonalMembership.workspaceId,
    memberPersonalWorkspaceId: memberPersonalMembership.workspaceId,
    workspaceId: adminMembership.workspaceId,
    assignedProject,
    adminProject,
  };
};

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

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
  await db.delete(schema.timesheetReviewEntrySnapshots);
  await db.delete(schema.timesheetReviewEvents);
  await db.delete(schema.timesheetProjectReviews);
  await db.delete(schema.timeEntries);
  await db.delete(schema.weeklyTimesheets);
  await db.delete(schema.tasks);
  await db.delete(schema.projects);
  await db.delete(schema.workspaceInvitations);
  await db.delete(schema.workspaceMemberships);
  await db.delete(schema.workspaces);
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

describe.sequential("role authorization", () => {
  it("keeps member management and project creation Admin-only", async () => {
    const fixture = await createRoleFixture();

    const managerMembers = await request(app).get(`/api/workspaces/${fixture.workspaceId}/members`).set(auth(fixture.manager.token));
    const memberMembers = await request(app).get(`/api/workspaces/${fixture.workspaceId}/members`).set(auth(fixture.member.token));
    const managerInvite = await request(app).post(`/api/workspaces/${fixture.workspaceId}/invitations`).set(auth(fixture.manager.token)).send({ email: "new@example.com" });
    const memberProject = await request(app).post(`/api/workspaces/${fixture.workspaceId}/projects`).set(auth(fixture.member.token)).send({ name: "Member project" });
    const managerProject = await request(app).post(`/api/workspaces/${fixture.workspaceId}/projects`).set(auth(fixture.manager.token)).send({ name: "Manager project" });
    const adminProject = await request(app).post(`/api/workspaces/${fixture.workspaceId}/projects`).set(auth(fixture.admin.token)).send({ name: "Created by Admin" });

    expect(managerMembers.status).toBe(200);
    expect(memberMembers.status).toBe(403);
    expect(memberMembers.body.error.code).toBe("insufficient_permissions");
    expect(managerInvite.status).toBe(403);
    expect(managerInvite.body.error.code).toBe("insufficient_permissions");
    expect(memberProject.status).toBe(403);
    expect(memberProject.body.error.code).toBe("insufficient_permissions");
    expect(managerProject.status).toBe(403);
    expect(managerProject.body.error.code).toBe("insufficient_permissions");
    expect(adminProject.status).toBe(201);
  });

  it("limits Manager project and task changes to assigned projects", async () => {
    const fixture = await createRoleFixture();

    const renameAssigned = await request(app).patch(`/api/workspaces/${fixture.workspaceId}/projects/${fixture.assignedProject.id}`).set(auth(fixture.manager.token)).send({ name: "Renamed assigned project" });
    const changeApprover = await request(app).patch(`/api/workspaces/${fixture.workspaceId}/projects/${fixture.assignedProject.id}`).set(auth(fixture.manager.token)).send({ approverMembershipId: fixture.admin.membership.id });
    const archiveProject = await request(app).patch(`/api/workspaces/${fixture.workspaceId}/projects/${fixture.assignedProject.id}`).set(auth(fixture.manager.token)).send({ isArchived: true });
    const renameUnassigned = await request(app).patch(`/api/workspaces/${fixture.workspaceId}/projects/${fixture.adminProject.id}`).set(auth(fixture.manager.token)).send({ name: "Should stay unchanged" });
    const createAssignedTask = await request(app).post(`/api/workspaces/${fixture.workspaceId}/projects/${fixture.assignedProject.id}/tasks`).set(auth(fixture.manager.token)).send({ name: "Assigned task" });
    const createUnassignedTask = await request(app).post(`/api/workspaces/${fixture.workspaceId}/projects/${fixture.adminProject.id}/tasks`).set(auth(fixture.manager.token)).send({ name: "Unauthorized task" });

    expect(renameAssigned.status).toBe(200);
    expect(changeApprover.status).toBe(403);
    expect(changeApprover.body.error.code).toBe("insufficient_permissions");
    expect(archiveProject.status).toBe(403);
    expect(archiveProject.body.error.code).toBe("insufficient_permissions");
    expect(renameUnassigned.status).toBe(404);
    expect(createAssignedTask.status).toBe(201);
    expect(createUnassignedTask.status).toBe(404);
  });

  it("scopes approvals to assigned Managers while allowing Admin read access", async () => {
    const fixture = await createRoleFixture();
    const [sheet] = await db.insert(schema.weeklyTimesheets).values({ workspaceId: fixture.workspaceId, membershipId: fixture.member.membership.id, weekStart: "2026-08-03", status: "submitted", submittedAt: new Date() }).returning();
    const [assignedReview] = await db.insert(schema.timesheetProjectReviews).values({ weeklyTimesheetId: sheet.id, projectId: fixture.assignedProject.id, approverMembershipId: fixture.manager.membership.id, projectName: fixture.assignedProject.name, submittedMinutes: 120, status: "pending" }).returning();
    const [unassignedReview] = await db.insert(schema.timesheetProjectReviews).values({ weeklyTimesheetId: sheet.id, projectId: fixture.adminProject.id, approverMembershipId: fixture.admin.membership.id, projectName: fixture.adminProject.name, submittedMinutes: 60, status: "pending" }).returning();

    const managerApprovals = await request(app).get(`/api/workspaces/${fixture.workspaceId}/approvals`).set(auth(fixture.manager.token));
    const adminApprovals = await request(app).get(`/api/workspaces/${fixture.workspaceId}/approvals`).set(auth(fixture.admin.token));
    const memberApprovals = await request(app).get(`/api/workspaces/${fixture.workspaceId}/approvals`).set(auth(fixture.member.token));
    const managerAssignedDetail = await request(app).get(`/api/workspaces/${fixture.workspaceId}/approval-items/${assignedReview.id}`).set(auth(fixture.manager.token));
    const managerUnassignedDetail = await request(app).get(`/api/workspaces/${fixture.workspaceId}/approval-items/${unassignedReview.id}`).set(auth(fixture.manager.token));
    const adminUnassignedDecision = await request(app).post(`/api/workspaces/${fixture.workspaceId}/approval-items/${assignedReview.id}/approve`).set(auth(fixture.admin.token)).send({});

    expect(managerApprovals.status).toBe(200);
    expect(managerApprovals.body.approvals).toHaveLength(1);
    expect(managerApprovals.body.approvals[0].id).toBe(String(assignedReview.id));
    expect(adminApprovals.status).toBe(200);
    expect(adminApprovals.body.approvals).toHaveLength(2);
    expect(memberApprovals.status).toBe(403);
    expect(memberApprovals.body.error.code).toBe("insufficient_permissions");
    expect(managerAssignedDetail.status).toBe(200);
    expect(managerUnassignedDetail.status).toBe(404);
    expect(adminUnassignedDecision.status).toBe(403);
    expect(adminUnassignedDecision.body.error.code).toBe("insufficient_permissions");
  });

  it("protects inactive and cross-workspace memberships and preserves the last Admin", async () => {
    const fixture = await createRoleFixture();

    const crossWorkspace = await request(app).get(`/api/workspaces/${fixture.memberPersonalWorkspaceId}/projects`).set(auth(fixture.admin.token));
    const demoteLastAdmin = await request(app).patch(`/api/workspaces/${fixture.workspaceId}/members/${fixture.admin.membership.id}`).set(auth(fixture.admin.token)).send({ role: "member" });
    const deactivateLastAdmin = await request(app).delete(`/api/workspaces/${fixture.workspaceId}/members/${fixture.admin.membership.id}`).set(auth(fixture.admin.token));
    await db.update(schema.workspaceMemberships).set({ isActive: false }).where(and(eq(schema.workspaceMemberships.id, fixture.member.membership.id), eq(schema.workspaceMemberships.workspaceId, fixture.workspaceId)));
    const inactiveProjects = await request(app).get(`/api/workspaces/${fixture.workspaceId}/projects`).set(auth(fixture.member.token));

    expect(crossWorkspace.status).toBe(404);
    expect(demoteLastAdmin.status).toBe(409);
    expect(demoteLastAdmin.body.error.code).toBe("last_admin");
    expect(deactivateLastAdmin.status).toBe(409);
    expect(deactivateLastAdmin.body.error.code).toBe("last_admin");
    expect(inactiveProjects.status).toBe(404);
  });
});
