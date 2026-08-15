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

const register = (email = "maia@example.com", password = "correct-horse-battery", workspace = { organizationName: "Tempo Studio", timezone: "Africa/Johannesburg" }) => request(app)
  .post("/api/auth/register")
  .send({ email, password, ...workspace });

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
  await db.delete(schema.workflowNotifications);
  await db.delete(schema.workspaceAuditEvents);
  await db.delete(schema.timesheetReviewEntrySnapshots);
  await db.delete(schema.timesheetReviewEvents);
  await db.delete(schema.timesheetApprovalRevisions);
  await db.delete(schema.timesheetApprovalItems);
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

    const [storedWorkspace] = await db.select().from(schema.workspaces);
    expect(storedWorkspace).toMatchObject({ name: "Tempo Studio", timezone: "Africa/Johannesburg" });
  });

  it("requires a named workspace and valid IANA timezone for direct registration", async () => {
    const missingWorkspace = await request(app).post("/api/auth/register").send({ email: "missing@example.com", password: "correct-horse-battery" });
    const invalidTimezone = await request(app).post("/api/auth/register").send({ email: "invalid@example.com", password: "correct-horse-battery", organizationName: "Invalid Co", timezone: "South Africa" });
    const valid = await register("london@example.com", "correct-horse-battery", { organizationName: "  London Studio  ", timezone: "Europe/London" });

    expect(missingWorkspace.status).toBe(400);
    expect(invalidTimezone.status).toBe(400);
    expect(valid.status).toBe(201);
    expect(await db.select().from(schema.users)).toHaveLength(1);
    expect(await db.select().from(schema.workspaces)).toEqual([expect.objectContaining({ name: "London Studio", timezone: "Europe/London" })]);
  });

  it("joins an invited workspace without creating a personal workspace", async () => {
    const adminRegistration = await register("owner@example.com");
    const [ownerMembership] = await db.select().from(schema.workspaceMemberships);
    const invitation = await request(app)
      .post(`/api/workspaces/${ownerMembership.workspaceId}/invitations`)
      .set(auth(adminRegistration.body.accessToken as string))
      .send({ email: "invitee@example.com", role: "member" });

    const joined = await request(app).post("/api/auth/register").send({
      email: "invitee@example.com",
      password: "correct-horse-battery",
      inviteToken: invitation.body.invitation.token,
    });

    expect(joined.status).toBe(201);
    expect(await db.select().from(schema.workspaces)).toHaveLength(1);
    const memberships = await db.select().from(schema.workspaceMemberships);
    expect(memberships).toHaveLength(2);
    expect(memberships.every((membership) => membership.workspaceId === ownerMembership.workspaceId)).toBe(true);
  });

  it("rolls back user creation when an invitation cannot be accepted", async () => {
    const failed = await request(app).post("/api/auth/register").send({ email: "invitee@example.com", password: "correct-horse-battery", inviteToken: "invalid-invitation-token-value" });
    expect(failed.status).toBeGreaterThanOrEqual(400);
    expect(await db.select().from(schema.users)).toHaveLength(0);
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
    const [sheet] = await db.insert(schema.weeklyTimesheets).values({ workspaceId: fixture.workspaceId, membershipId: fixture.member.membership.id, weekStart: "2026-08-03", status: "in_review", submittedAt: new Date() }).returning();
    const [assignedItem] = await db.insert(schema.timesheetApprovalItems).values({ weeklyTimesheetId: sheet.id, projectId: fixture.assignedProject.id }).returning();
    const [unassignedItem] = await db.insert(schema.timesheetApprovalItems).values({ weeklyTimesheetId: sheet.id, projectId: fixture.adminProject.id }).returning();
    const [assignedReview] = await db.insert(schema.timesheetApprovalRevisions).values({ approvalItemId: assignedItem.id, revisionNumber: 1, approverMembershipId: fixture.manager.membership.id, assignedApproverMembershipId: fixture.manager.membership.id, projectName: fixture.assignedProject.name, submittedMinutes: 120, status: "pending" }).returning();
    await db.insert(schema.timesheetApprovalRevisions).values({ approvalItemId: unassignedItem.id, revisionNumber: 1, approverMembershipId: fixture.admin.membership.id, assignedApproverMembershipId: fixture.admin.membership.id, projectName: fixture.adminProject.name, submittedMinutes: 60, status: "pending" });

    const managerApprovals = await request(app).get(`/api/workspaces/${fixture.workspaceId}/approvals`).set(auth(fixture.manager.token));
    const managerPendingCount = await request(app).get(`/api/workspaces/${fixture.workspaceId}/approvals/pending-count`).set(auth(fixture.manager.token));
    const adminApprovals = await request(app).get(`/api/workspaces/${fixture.workspaceId}/approvals`).set(auth(fixture.admin.token));
    const memberApprovals = await request(app).get(`/api/workspaces/${fixture.workspaceId}/approvals`).set(auth(fixture.member.token));
    const managerAssignedDetail = await request(app).get(`/api/workspaces/${fixture.workspaceId}/approval-items/${assignedItem.id}`).set(auth(fixture.manager.token));
    const managerUnassignedDetail = await request(app).get(`/api/workspaces/${fixture.workspaceId}/approval-items/${unassignedItem.id}`).set(auth(fixture.manager.token));
    const adminUnassignedDecision = await request(app).post(`/api/workspaces/${fixture.workspaceId}/approval-items/${assignedItem.id}/revisions/${assignedReview.id}/approve`).set(auth(fixture.admin.token)).send({});

    expect(managerApprovals.status).toBe(200);
    expect(managerApprovals.body.approvals).toHaveLength(1);
    expect(managerApprovals.body.approvals[0].id).toBe(String(assignedItem.id));
    expect(managerPendingCount.body.count).toBe(1);
    expect(adminApprovals.status).toBe(200);
    expect(adminApprovals.body.approvals).toHaveLength(2);
    expect(memberApprovals.status).toBe(403);
    expect(memberApprovals.body.error.code).toBe("insufficient_permissions");
    expect(managerAssignedDetail.status).toBe(200);
    expect(managerUnassignedDetail.status).toBe(404);
    expect(adminUnassignedDecision.status).toBe(403);
    expect(adminUnassignedDecision.body.error.code).toBe("insufficient_permissions");
  });

  it("creates immutable revisions and reports project-specific submission readiness", async () => {
    const fixture = await createRoleFixture();
    await db.update(schema.projects).set({ approverMembershipId: fixture.manager.membership.id }).where(eq(schema.projects.id, fixture.adminProject.id));
    const [assignedEntry] = await db.insert(schema.timeEntries).values({ workspaceId: fixture.workspaceId, membershipId: fixture.member.membership.id, projectId: fixture.assignedProject.id, workDate: "2026-08-03", durationMinutes: 60 }).returning();
    await db.insert(schema.timeEntries).values({ workspaceId: fixture.workspaceId, membershipId: fixture.member.membership.id, projectId: fixture.adminProject.id, workDate: "2026-08-04", durationMinutes: 30 });

    const initial = await request(app).post(`/api/workspaces/${fixture.workspaceId}/timesheets/2026-08-03/submit`).set(auth(fixture.member.token)).send({});
    expect(initial.status).toBe(200);
    expect(initial.body.status).toBe("in_review");
    expect(initial.body.revisions).toHaveLength(2);
    const revision = initial.body.revisions.find((item: { projectId: string }) => item.projectId === String(fixture.assignedProject.id));

    const returned = await request(app).post(`/api/workspaces/${fixture.workspaceId}/approval-items/${revision.approvalItemId}/revisions/${revision.revisionId}/request-changes`).set(auth(fixture.manager.token)).send({ comment: "Please add detail" });
    expect(returned.status).toBe(200);
    expect(returned.body.timesheetStatus).toBe("changes_requested");
    const changed = await request(app).patch(`/api/workspaces/${fixture.workspaceId}/time-entries/${assignedEntry.id}`).set(auth(fixture.member.token)).send({ durationMinutes: 90 });
    expect(changed.status).toBe(200);

    const resubmitted = await request(app).post(`/api/workspaces/${fixture.workspaceId}/timesheets/2026-08-03/submit`).set(auth(fixture.member.token)).send({});
    expect(resubmitted.status).toBe(200);
    expect(resubmitted.body.revisions).toHaveLength(1);
    expect(resubmitted.body.revisions[0].revisionNumber).toBe(2);
    const detail = await request(app).get(`/api/workspaces/${fixture.workspaceId}/approval-items/${revision.approvalItemId}`).set(auth(fixture.manager.token));
    expect(detail.status).toBe(200);
    expect(detail.body.approval.revisions).toHaveLength(2);
    expect(detail.body.approval.revisions[1].status).toBe("changes_requested");
    expect(detail.body.approval.revisions[1].entries[0].durationMinutes).toBe(60);

    const [unassignedProject] = await db.insert(schema.projects).values({ workspaceId: fixture.workspaceId, name: "Needs approver" }).returning();
    await db.insert(schema.timeEntries).values({ workspaceId: fixture.workspaceId, membershipId: fixture.member.membership.id, projectId: unassignedProject.id, workDate: "2026-08-10", durationMinutes: 30 });
    const notReady = await request(app).post(`/api/workspaces/${fixture.workspaceId}/timesheets/2026-08-10/submit`).set(auth(fixture.member.token)).send({});
    expect(notReady.status).toBe(409);
    expect(notReady.body.error.code).toBe("submission_not_ready");
    expect(notReady.body.error.details.projects).toEqual(expect.arrayContaining([expect.objectContaining({ projectId: String(unassignedProject.id), reason: "missing_approver" })]));
  });

  it("audits Admin transfers and override approvals without changing the submitted approver snapshot", async () => {
    const fixture = await createRoleFixture();
    await db.insert(schema.timeEntries).values({ workspaceId: fixture.workspaceId, membershipId: fixture.member.membership.id, projectId: fixture.assignedProject.id, workDate: "2026-08-03", durationMinutes: 60 });
    const submitted = await request(app).post(`/api/workspaces/${fixture.workspaceId}/timesheets/2026-08-03/submit`).set(auth(fixture.member.token)).send({});
    const approval = submitted.body.revisions[0];

    const missingReason = await request(app).post(`/api/workspaces/${fixture.workspaceId}/approval-items/${approval.approvalItemId}/revisions/${approval.revisionId}/transfer`).set(auth(fixture.admin.token)).send({ approverMembershipId: fixture.admin.membership.id });
    expect(missingReason.status).toBe(400);
    const transferred = await request(app).post(`/api/workspaces/${fixture.workspaceId}/approval-items/${approval.approvalItemId}/revisions/${approval.revisionId}/transfer`).set(auth(fixture.admin.token)).send({ approverMembershipId: fixture.admin.membership.id, reason: "Manager is unavailable" });
    expect(transferred.status).toBe(200);
    const [storedAfterTransfer] = await db.select().from(schema.timesheetApprovalRevisions).where(eq(schema.timesheetApprovalRevisions.id, Number(approval.revisionId)));
    expect(storedAfterTransfer.approverMembershipId).toBe(fixture.manager.membership.id);
    expect(storedAfterTransfer.assignedApproverMembershipId).toBe(fixture.admin.membership.id);

    await request(app).post(`/api/workspaces/${fixture.workspaceId}/approval-items/${approval.approvalItemId}/revisions/${approval.revisionId}/transfer`).set(auth(fixture.admin.token)).send({ approverMembershipId: fixture.manager.membership.id, reason: "Manager returned" });
    const overridden = await request(app).post(`/api/workspaces/${fixture.workspaceId}/approval-items/${approval.approvalItemId}/revisions/${approval.revisionId}/approve-as-admin`).set(auth(fixture.admin.token)).send({ reason: "Payroll cutoff" });
    expect(overridden.status).toBe(200);
    const events = await db.select().from(schema.timesheetReviewEvents).where(eq(schema.timesheetReviewEvents.revisionId, Number(approval.revisionId)));
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ type: "transferred", internalReason: "Manager is unavailable", previousApproverMembershipId: fixture.manager.membership.id, nextApproverMembershipId: fixture.admin.membership.id }), expect.objectContaining({ type: "admin_override", internalReason: "Payroll cutoff" })]));
    const managerDetail = await request(app).get(`/api/workspaces/${fixture.workspaceId}/approval-items/${approval.approvalItemId}`).set(auth(fixture.manager.token));
    const adminDetail = await request(app).get(`/api/workspaces/${fixture.workspaceId}/approval-items/${approval.approvalItemId}`).set(auth(fixture.admin.token));
    expect(managerDetail.body.approval.revisions[0].events.find((event: { type: string }) => event.type === "admin_override")).not.toHaveProperty("internalReason");
    expect(adminDetail.body.approval.revisions[0].events.find((event: { type: string }) => event.type === "admin_override").internalReason).toBe("Payroll cutoff");
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

describe.sequential("remaining approval workflow", () => {
  it("applies workspace approval filters after enforcing Manager assignment scope", async () => {
    const fixture = await createRoleFixture();
    const [sheet] = await db.insert(schema.weeklyTimesheets).values({
      workspaceId: fixture.workspaceId,
      membershipId: fixture.member.membership.id,
      weekStart: "2026-08-03",
      status: "partially_approved",
      submittedAt: new Date("2026-08-05T08:00:00.000Z"),
    }).returning();
    const [assignedItem] = await db.insert(schema.timesheetApprovalItems).values({ weeklyTimesheetId: sheet.id, projectId: fixture.assignedProject.id }).returning();
    const [adminItem] = await db.insert(schema.timesheetApprovalItems).values({ weeklyTimesheetId: sheet.id, projectId: fixture.adminProject.id }).returning();
    await db.insert(schema.timesheetApprovalRevisions).values([
      { approvalItemId: assignedItem.id, revisionNumber: 1, approverMembershipId: fixture.manager.membership.id, assignedApproverMembershipId: fixture.manager.membership.id, projectName: fixture.assignedProject.name, submittedMinutes: 120, status: "pending", submittedAt: new Date("2026-08-05T08:00:00.000Z") },
      { approvalItemId: adminItem.id, revisionNumber: 1, approverMembershipId: fixture.admin.membership.id, assignedApproverMembershipId: fixture.admin.membership.id, projectName: fixture.adminProject.name, submittedMinutes: 60, status: "approved", submittedAt: new Date("2026-08-04T08:00:00.000Z"), resolvedAt: new Date("2026-08-04T10:00:00.000Z"), resolvedByMembershipId: fixture.admin.membership.id },
    ]);

    const managerHistory = await request(app).get(`/api/workspaces/${fixture.workspaceId}/approvals?status=approved`).set(auth(fixture.manager.token));
    const adminHistory = await request(app).get(`/api/workspaces/${fixture.workspaceId}/approvals?status=approved&projectId=${fixture.adminProject.id}&submitterMembershipId=${fixture.member.membership.id}&approverMembershipId=${fixture.admin.membership.id}&submittedFrom=2026-08-04&submittedTo=2026-08-04`).set(auth(fixture.admin.token));
    const wrongProject = await request(app).get(`/api/workspaces/${fixture.workspaceId}/approvals?projectId=${fixture.assignedProject.id}&status=approved`).set(auth(fixture.admin.token));
    const pendingCount = await request(app).get(`/api/workspaces/${fixture.workspaceId}/approvals/pending-count`).set(auth(fixture.admin.token));

    expect(managerHistory.status).toBe(200);
    expect(managerHistory.body.approvals).toEqual([]);
    expect(adminHistory.status).toBe(200);
    expect(adminHistory.body.approvals).toEqual([expect.objectContaining({ id: String(adminItem.id), status: "approved" })]);
    expect(wrongProject.body.approvals).toEqual([]);
    expect(pendingCount.body.count).toBe(1);
  });

  it("returns immutable revision diffs and never exposes internal Admin reasons to Managers", async () => {
    const fixture = await createRoleFixture();
    const [sheet] = await db.insert(schema.weeklyTimesheets).values({ workspaceId: fixture.workspaceId, membershipId: fixture.member.membership.id, weekStart: "2026-08-03", status: "in_review", submittedAt: new Date() }).returning();
    const [item] = await db.insert(schema.timesheetApprovalItems).values({ weeklyTimesheetId: sheet.id, projectId: fixture.assignedProject.id }).returning();
    const [first, second] = await db.insert(schema.timesheetApprovalRevisions).values([
      { approvalItemId: item.id, revisionNumber: 1, approverMembershipId: fixture.manager.membership.id, assignedApproverMembershipId: fixture.manager.membership.id, projectName: fixture.assignedProject.name, submittedMinutes: 90, status: "changes_requested", resolvedAt: new Date(), resolvedByMembershipId: fixture.manager.membership.id, returnComment: "Correct the split" },
      { approvalItemId: item.id, revisionNumber: 2, approverMembershipId: fixture.manager.membership.id, assignedApproverMembershipId: fixture.manager.membership.id, projectName: fixture.assignedProject.name, submittedMinutes: 105, status: "pending" },
    ]).returning();
    await db.insert(schema.timesheetReviewEntrySnapshots).values([
      { revisionId: first.id, sourceEntryId: 1001, workDate: "2026-08-03", durationMinutes: 60, description: "Changed", isBillable: true },
      { revisionId: first.id, sourceEntryId: 1002, workDate: "2026-08-04", durationMinutes: 30, description: "Removed", isBillable: false },
      { revisionId: second.id, sourceEntryId: 1001, workDate: "2026-08-03", durationMinutes: 75, description: "Changed", isBillable: true },
      { revisionId: second.id, sourceEntryId: 1003, workDate: "2026-08-05", durationMinutes: 30, description: "Added", isBillable: true },
    ]);
    await db.insert(schema.timesheetReviewEvents).values({ revisionId: second.id, actorMembershipId: fixture.admin.membership.id, type: "transferred", internalReason: "Coverage change", previousApproverMembershipId: fixture.admin.membership.id, nextApproverMembershipId: fixture.manager.membership.id });

    const managerDetail = await request(app).get(`/api/workspaces/${fixture.workspaceId}/approval-items/${item.id}`).set(auth(fixture.manager.token));
    const adminDetail = await request(app).get(`/api/workspaces/${fixture.workspaceId}/approval-items/${item.id}`).set(auth(fixture.admin.token));
    const memberDetail = await request(app).get(`/api/workspaces/${fixture.workspaceId}/approval-items/${item.id}`).set(auth(fixture.member.token));
    const currentForManager = managerDetail.body.approval.revisions[0];
    const currentForAdmin = adminDetail.body.approval.revisions[0];
    const currentForMember = memberDetail.body.approval.revisions[0];

    expect(currentForManager.diff.added).toEqual([expect.objectContaining({ sourceEntryId: "1003" })]);
    expect(currentForManager.diff.removed).toEqual([expect.objectContaining({ sourceEntryId: "1002" })]);
    expect(currentForManager.diff.changed).toEqual([expect.objectContaining({ before: expect.objectContaining({ durationMinutes: 60 }), after: expect.objectContaining({ durationMinutes: 75 }) })]);
    expect(currentForManager.events[0]).not.toHaveProperty("internalReason");
    expect(currentForAdmin.events[0].internalReason).toBe("Coverage change");
    expect(memberDetail.status).toBe(200);
    expect(currentForMember.events[0]).not.toHaveProperty("internalReason");
  });

  it("validates reviewer actions and rejects stale, repeated, and unauthorized decisions", async () => {
    const fixture = await createRoleFixture();
    await db.insert(schema.timeEntries).values({ workspaceId: fixture.workspaceId, membershipId: fixture.member.membership.id, projectId: fixture.assignedProject.id, workDate: "2026-08-03", durationMinutes: 60 });
    const submitted = await request(app).post(`/api/workspaces/${fixture.workspaceId}/timesheets/2026-08-03/submit`).set(auth(fixture.member.token)).send({});
    const approval = submitted.body.revisions[0];

    const blankComment = await request(app).post(`/api/workspaces/${fixture.workspaceId}/approval-items/${approval.approvalItemId}/revisions/${approval.revisionId}/request-changes`).set(auth(fixture.manager.token)).send({ comment: "   " });
    const memberDecision = await request(app).post(`/api/workspaces/${fixture.workspaceId}/approval-items/${approval.approvalItemId}/revisions/${approval.revisionId}/approve`).set(auth(fixture.member.token)).send({});
    const blankOverride = await request(app).post(`/api/workspaces/${fixture.workspaceId}/approval-items/${approval.approvalItemId}/revisions/${approval.revisionId}/approve-as-admin`).set(auth(fixture.admin.token)).send({ reason: "" });
    const approved = await request(app).post(`/api/workspaces/${fixture.workspaceId}/approval-items/${approval.approvalItemId}/revisions/${approval.revisionId}/approve`).set(auth(fixture.manager.token)).send({});
    const repeated = await request(app).post(`/api/workspaces/${fixture.workspaceId}/approval-items/${approval.approvalItemId}/revisions/${approval.revisionId}/approve`).set(auth(fixture.manager.token)).send({});
    const transferResolved = await request(app).post(`/api/workspaces/${fixture.workspaceId}/approval-items/${approval.approvalItemId}/revisions/${approval.revisionId}/transfer`).set(auth(fixture.admin.token)).send({ approverMembershipId: fixture.admin.membership.id, reason: "Too late" });

    expect(blankComment.status).toBe(400);
    expect(memberDecision.status).toBe(403);
    expect(blankOverride.status).toBe(400);
    expect(approved.status).toBe(200);
    expect(repeated.status).toBe(409);
    expect(transferResolved.status).toBe(409);
  });

  it("delivers idempotent, recipient-scoped notifications and isolates read state", async () => {
    const fixture = await createRoleFixture();
    const [entry] = await db.insert(schema.timeEntries).values({ workspaceId: fixture.workspaceId, membershipId: fixture.member.membership.id, projectId: fixture.assignedProject.id, workDate: "2026-08-03", durationMinutes: 60 }).returning();
    const submitted = await request(app).post(`/api/workspaces/${fixture.workspaceId}/timesheets/2026-08-03/submit`).set(auth(fixture.member.token)).send({});
    const approval = submitted.body.revisions[0];

    const managerInbox = await request(app).get(`/api/workspaces/${fixture.workspaceId}/notifications`).set(auth(fixture.manager.token));
    const memberBeforeDecision = await request(app).get(`/api/workspaces/${fixture.workspaceId}/notifications`).set(auth(fixture.member.token));
    expect(managerInbox.body.notifications).toEqual([expect.objectContaining({ type: "submission", href: `/approvals/${approval.approvalItemId}`, readAt: null })]);
    expect(managerInbox.body.unreadCount).toBe(1);
    expect(memberBeforeDecision.body.notifications).toEqual([]);

    await db.insert(schema.workflowNotifications).values({ workspaceId: fixture.workspaceId, recipientMembershipId: fixture.manager.membership.id, type: "submission", title: "Duplicate", body: "Duplicate", href: "/approvals", sourceKey: `revision:${approval.revisionId}:submitted` }).onConflictDoNothing();
    expect((await db.select().from(schema.workflowNotifications).where(eq(schema.workflowNotifications.recipientMembershipId, fixture.manager.membership.id))).length).toBe(1);

    const foreignRead = await request(app).patch(`/api/workspaces/${fixture.workspaceId}/notifications/${managerInbox.body.notifications[0].id}/read`).set(auth(fixture.member.token));
    expect(foreignRead.status).toBe(204);
    expect((await request(app).get(`/api/workspaces/${fixture.workspaceId}/notifications`).set(auth(fixture.manager.token))).body.unreadCount).toBe(1);
    await request(app).patch(`/api/workspaces/${fixture.workspaceId}/notifications/read-all`).set(auth(fixture.manager.token));
    expect((await request(app).get(`/api/workspaces/${fixture.workspaceId}/notifications`).set(auth(fixture.manager.token))).body.unreadCount).toBe(0);

    await request(app).post(`/api/workspaces/${fixture.workspaceId}/approval-items/${approval.approvalItemId}/revisions/${approval.revisionId}/request-changes`).set(auth(fixture.manager.token)).send({ comment: "Please clarify" });
    const memberAfterDecision = await request(app).get(`/api/workspaces/${fixture.workspaceId}/notifications`).set(auth(fixture.member.token));
    expect(memberAfterDecision.body.notifications).toEqual([expect.objectContaining({ type: "changes_requested", href: "/time-entries?week=2026-08-03" })]);
    expect(memberAfterDecision.body.notifications[0]).not.toHaveProperty("internalReason");

    await request(app).patch(`/api/workspaces/${fixture.workspaceId}/time-entries/${entry.id}`).set(auth(fixture.member.token)).send({ durationMinutes: 75 });
    const resubmitted = await request(app).post(`/api/workspaces/${fixture.workspaceId}/timesheets/2026-08-03/submit`).set(auth(fixture.member.token)).send({});
    const nextRevision = resubmitted.body.revisions[0];
    const managerAfterResubmit = await request(app).get(`/api/workspaces/${fixture.workspaceId}/notifications`).set(auth(fixture.manager.token));
    expect(managerAfterResubmit.body.notifications).toEqual(expect.arrayContaining([expect.objectContaining({ type: "resubmission", href: `/approvals/${approval.approvalItemId}` })]));

    await request(app).post(`/api/workspaces/${fixture.workspaceId}/approval-items/${approval.approvalItemId}/revisions/${nextRevision.revisionId}/transfer`).set(auth(fixture.admin.token)).send({ approverMembershipId: fixture.admin.membership.id, reason: "Covering leave" });
    const adminAfterTransfer = await request(app).get(`/api/workspaces/${fixture.workspaceId}/notifications`).set(auth(fixture.admin.token));
    const formerApproverLink = await request(app).get(`/api/workspaces/${fixture.workspaceId}/approval-items/${approval.approvalItemId}`).set(auth(fixture.manager.token));
    expect(adminAfterTransfer.body.notifications).toEqual([expect.objectContaining({ type: "transfer", href: `/approvals/${approval.approvalItemId}` })]);
    expect(formerApproverLink.status).toBe(404);

    await request(app).post(`/api/workspaces/${fixture.workspaceId}/approval-items/${approval.approvalItemId}/revisions/${nextRevision.revisionId}/transfer`).set(auth(fixture.admin.token)).send({ approverMembershipId: fixture.manager.membership.id, reason: "Original reviewer returned" });
    await request(app).post(`/api/workspaces/${fixture.workspaceId}/approval-items/${approval.approvalItemId}/revisions/${nextRevision.revisionId}/approve-as-admin`).set(auth(fixture.admin.token)).send({ reason: "Payroll cutoff" });
    const memberAfterOverride = await request(app).get(`/api/workspaces/${fixture.workspaceId}/notifications`).set(auth(fixture.member.token));
    expect(memberAfterOverride.body.notifications).toEqual(expect.arrayContaining([expect.objectContaining({ type: "approved", href: "/time-entries?week=2026-08-03" })]));
  });

  it("does not create work or notifications for an inactive configured approver", async () => {
    const fixture = await createRoleFixture();
    await db.update(schema.workspaceMemberships).set({ isActive: false }).where(eq(schema.workspaceMemberships.id, fixture.manager.membership.id));
    await db.insert(schema.timeEntries).values({ workspaceId: fixture.workspaceId, membershipId: fixture.member.membership.id, projectId: fixture.assignedProject.id, workDate: "2026-08-03", durationMinutes: 60 });

    const submitted = await request(app).post(`/api/workspaces/${fixture.workspaceId}/timesheets/2026-08-03/submit`).set(auth(fixture.member.token)).send({});
    const notifications = await db.select().from(schema.workflowNotifications).where(eq(schema.workflowNotifications.recipientMembershipId, fixture.manager.membership.id));

    expect(submitted.status).toBe(409);
    expect(submitted.body.error.code).toBe("submission_not_ready");
    expect(notifications).toEqual([]);
  });

  it("audits Admin membership governance and keeps member mutations Admin-only", async () => {
    const fixture = await createRoleFixture();
    const managerMutation = await request(app).patch(`/api/workspaces/${fixture.workspaceId}/members/${fixture.member.membership.id}`).set(auth(fixture.manager.token)).send({ role: "manager" });
    const promoted = await request(app).patch(`/api/workspaces/${fixture.workspaceId}/members/${fixture.member.membership.id}`).set(auth(fixture.admin.token)).send({ role: "manager" });
    const deactivated = await request(app).patch(`/api/workspaces/${fixture.workspaceId}/members/${fixture.member.membership.id}`).set(auth(fixture.admin.token)).send({ isActive: false });
    const reactivated = await request(app).patch(`/api/workspaces/${fixture.workspaceId}/members/${fixture.member.membership.id}`).set(auth(fixture.admin.token)).send({ isActive: true });
    const auditResponse = await request(app).get(`/api/workspaces/${fixture.workspaceId}/audit-events`).set(auth(fixture.admin.token));
    const managerAudit = await request(app).get(`/api/workspaces/${fixture.workspaceId}/audit-events`).set(auth(fixture.manager.token));

    expect(managerMutation.status).toBe(403);
    expect(promoted.body.membership).toMatchObject({ role: "manager", isActive: true });
    expect(deactivated.body.membership.isActive).toBe(false);
    expect(reactivated.body.membership.isActive).toBe(true);
    expect(auditResponse.body.events.map((event: { type: string }) => event.type)).toEqual(expect.arrayContaining(["member_role_changed", "member_deactivated", "member_reactivated"]));
    expect(managerAudit.status).toBe(403);
  });

  it("creates bounded-role invitations, revokes duplicate pending invites, and audits the action", async () => {
    const fixture = await createRoleFixture();
    const invalidRole = await request(app).post(`/api/workspaces/${fixture.workspaceId}/invitations`).set(auth(fixture.admin.token)).send({ email: "invitee@example.com", role: "admin" });
    const activeMember = await request(app).post(`/api/workspaces/${fixture.workspaceId}/invitations`).set(auth(fixture.admin.token)).send({ email: "MEMBER@example.com", role: "member" });
    const first = await request(app).post(`/api/workspaces/${fixture.workspaceId}/invitations`).set(auth(fixture.admin.token)).send({ email: " Invitee@Example.com ", role: "member" });
    const replacement = await request(app).post(`/api/workspaces/${fixture.workspaceId}/invitations`).set(auth(fixture.admin.token)).send({ email: "invitee@example.com", role: "manager" });
    const listed = await request(app).get(`/api/workspaces/${fixture.workspaceId}/invitations`).set(auth(fixture.admin.token));
    const events = await request(app).get(`/api/workspaces/${fixture.workspaceId}/audit-events`).set(auth(fixture.admin.token));

    expect(invalidRole.status).toBe(400);
    expect(activeMember.status).toBe(409);
    expect(first.status).toBe(201);
    expect(first.body.invitation).toMatchObject({ email: "invitee@example.com", role: "member", status: "pending" });
    expect(replacement.status).toBe(201);
    expect(replacement.body.invitation).toMatchObject({ email: "invitee@example.com", role: "manager", status: "pending" });
    expect(listed.body.invitations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: first.body.invitation.id, status: "revoked" }),
      expect.objectContaining({ id: replacement.body.invitation.id, status: "pending" }),
    ]));
    expect(events.body.events.filter((event: { type: string }) => event.type === "member_invited")).toHaveLength(2);
  });
});
