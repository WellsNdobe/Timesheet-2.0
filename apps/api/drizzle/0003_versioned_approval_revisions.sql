ALTER TABLE "weekly_timesheets" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "weekly_timesheets" ALTER COLUMN "status" TYPE text USING "status"::text;--> statement-breakpoint
DROP TYPE "timesheet_status";--> statement-breakpoint
CREATE TYPE "timesheet_status" AS ENUM('draft', 'in_review', 'changes_requested', 'partially_approved', 'approved');--> statement-breakpoint
ALTER TABLE "weekly_timesheets" ALTER COLUMN "status" TYPE "timesheet_status" USING (CASE "status" WHEN 'submitted' THEN 'in_review' ELSE "status" END)::"timesheet_status";--> statement-breakpoint
ALTER TABLE "weekly_timesheets" ALTER COLUMN "status" SET DEFAULT 'draft';--> statement-breakpoint
ALTER TYPE "review_event_type" ADD VALUE IF NOT EXISTS 'resubmitted';--> statement-breakpoint
ALTER TYPE "review_event_type" ADD VALUE IF NOT EXISTS 'withdrawn';--> statement-breakpoint
ALTER TABLE "timesheet_project_reviews" RENAME TO "timesheet_approval_items";--> statement-breakpoint
ALTER INDEX "timesheet_project_reviews_timesheet_project_unique" RENAME TO "timesheet_approval_items_timesheet_project_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "timesheet_project_reviews_approver_status_index";--> statement-breakpoint
CREATE TYPE "approval_revision_status" AS ENUM('pending', 'approved', 'changes_requested', 'withdrawn');--> statement-breakpoint
CREATE TABLE "timesheet_approval_revisions" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "approval_item_id" bigint NOT NULL,
  "revision_number" integer NOT NULL,
  "approver_membership_id" bigint NOT NULL,
  "project_name" text NOT NULL,
  "status" "approval_revision_status" NOT NULL DEFAULT 'pending',
  "submitted_minutes" integer NOT NULL,
  "submitted_at" timestamp with time zone NOT NULL DEFAULT now(),
  "resolved_at" timestamp with time zone,
  "resolved_by_membership_id" bigint,
  "return_comment" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "timesheet_approval_revisions_number_positive" CHECK ("revision_number" > 0),
  CONSTRAINT "timesheet_approval_revisions_minutes_valid" CHECK (("status" = 'withdrawn' AND "submitted_minutes" = 0) OR ("status" <> 'withdrawn' AND "submitted_minutes" > 0))
);--> statement-breakpoint
ALTER TABLE "timesheet_approval_revisions" ADD CONSTRAINT "timesheet_approval_revisions_item_fk" FOREIGN KEY ("approval_item_id") REFERENCES "timesheet_approval_items"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "timesheet_approval_revisions" ADD CONSTRAINT "timesheet_approval_revisions_approver_fk" FOREIGN KEY ("approver_membership_id") REFERENCES "workspace_memberships"("id");--> statement-breakpoint
ALTER TABLE "timesheet_approval_revisions" ADD CONSTRAINT "timesheet_approval_revisions_resolved_by_fk" FOREIGN KEY ("resolved_by_membership_id") REFERENCES "workspace_memberships"("id");--> statement-breakpoint
INSERT INTO "timesheet_approval_revisions" ("approval_item_id", "revision_number", "approver_membership_id", "project_name", "status", "submitted_minutes", "submitted_at", "resolved_at", "resolved_by_membership_id", "return_comment", "created_at", "updated_at")
SELECT "id", 1, "approver_membership_id", "project_name", "status"::text::"approval_revision_status", "submitted_minutes", "submitted_at", "resolved_at", "resolved_by_membership_id", "return_comment", "created_at", "updated_at"
FROM "timesheet_approval_items";--> statement-breakpoint
ALTER TABLE "timesheet_review_entry_snapshots" ADD COLUMN "revision_id" bigint;--> statement-breakpoint
ALTER TABLE "timesheet_review_events" ADD COLUMN "revision_id" bigint;--> statement-breakpoint
UPDATE "timesheet_review_entry_snapshots" AS snapshot SET "revision_id" = revision."id" FROM "timesheet_approval_revisions" AS revision WHERE revision."approval_item_id" = snapshot."review_id";--> statement-breakpoint
UPDATE "timesheet_review_events" AS event SET "revision_id" = revision."id" FROM "timesheet_approval_revisions" AS revision WHERE revision."approval_item_id" = event."review_id";--> statement-breakpoint
ALTER TABLE "timesheet_review_entry_snapshots" ALTER COLUMN "revision_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "timesheet_review_events" ALTER COLUMN "revision_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "timesheet_review_entry_snapshots" DROP CONSTRAINT "timesheet_review_entry_snapshots_review_id_timesheet_project_reviews_id_fk";--> statement-breakpoint
ALTER TABLE "timesheet_review_events" DROP CONSTRAINT "timesheet_review_events_review_id_timesheet_project_reviews_id_fk";--> statement-breakpoint
ALTER TABLE "timesheet_review_entry_snapshots" DROP COLUMN "review_id";--> statement-breakpoint
ALTER TABLE "timesheet_review_events" DROP COLUMN "review_id";--> statement-breakpoint
ALTER TABLE "timesheet_review_entry_snapshots" ADD CONSTRAINT "timesheet_review_entry_snapshots_revision_fk" FOREIGN KEY ("revision_id") REFERENCES "timesheet_approval_revisions"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "timesheet_review_events" ADD CONSTRAINT "timesheet_review_events_revision_fk" FOREIGN KEY ("revision_id") REFERENCES "timesheet_approval_revisions"("id") ON DELETE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "timesheet_approval_revisions_item_number_unique" ON "timesheet_approval_revisions" USING btree ("approval_item_id", "revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "timesheet_approval_revisions_one_pending_item_unique" ON "timesheet_approval_revisions" USING btree ("approval_item_id") WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX "timesheet_approval_revisions_approver_status_index" ON "timesheet_approval_revisions" USING btree ("approver_membership_id", "status", "submitted_at");--> statement-breakpoint
CREATE INDEX "timesheet_review_entry_snapshots_revision_index" ON "timesheet_review_entry_snapshots" USING btree ("revision_id", "work_date");--> statement-breakpoint
CREATE INDEX "timesheet_review_events_revision_index" ON "timesheet_review_events" USING btree ("revision_id", "created_at");--> statement-breakpoint
DROP INDEX IF EXISTS "timesheet_review_entry_snapshots_review_index";--> statement-breakpoint
DROP INDEX IF EXISTS "timesheet_review_events_review_index";--> statement-breakpoint
ALTER TABLE "timesheet_approval_items" DROP COLUMN "approver_membership_id";--> statement-breakpoint
ALTER TABLE "timesheet_approval_items" DROP COLUMN "project_name";--> statement-breakpoint
ALTER TABLE "timesheet_approval_items" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "timesheet_approval_items" DROP COLUMN "submitted_minutes";--> statement-breakpoint
ALTER TABLE "timesheet_approval_items" DROP COLUMN "submitted_at";--> statement-breakpoint
ALTER TABLE "timesheet_approval_items" DROP COLUMN "resolved_at";--> statement-breakpoint
ALTER TABLE "timesheet_approval_items" DROP COLUMN "resolved_by_membership_id";--> statement-breakpoint
ALTER TABLE "timesheet_approval_items" DROP COLUMN "return_comment";--> statement-breakpoint
DROP TYPE "project_review_status";
