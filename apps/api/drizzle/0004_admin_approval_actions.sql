ALTER TYPE "review_event_type" ADD VALUE IF NOT EXISTS 'transferred';--> statement-breakpoint
ALTER TYPE "review_event_type" ADD VALUE IF NOT EXISTS 'admin_override';--> statement-breakpoint
ALTER TABLE "timesheet_approval_revisions" ADD COLUMN "assigned_approver_membership_id" bigint;--> statement-breakpoint
UPDATE "timesheet_approval_revisions" SET "assigned_approver_membership_id" = "approver_membership_id";--> statement-breakpoint
ALTER TABLE "timesheet_approval_revisions" ALTER COLUMN "assigned_approver_membership_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "timesheet_approval_revisions" ADD CONSTRAINT "timesheet_approval_revisions_assigned_approver_fk" FOREIGN KEY ("assigned_approver_membership_id") REFERENCES "workspace_memberships"("id");--> statement-breakpoint
DROP INDEX "timesheet_approval_revisions_approver_status_index";--> statement-breakpoint
CREATE INDEX "timesheet_approval_revisions_approver_status_index" ON "timesheet_approval_revisions" USING btree ("assigned_approver_membership_id", "status", "submitted_at");--> statement-breakpoint
ALTER TABLE "timesheet_approval_revisions" ADD CONSTRAINT "timesheet_approval_revisions_resolution_valid" CHECK (("status" = 'pending' AND "resolved_at" IS NULL AND "resolved_by_membership_id" IS NULL) OR ("status" <> 'pending' AND "resolved_at" IS NOT NULL AND "resolved_by_membership_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "timesheet_approval_revisions" ADD CONSTRAINT "timesheet_approval_revisions_return_comment_valid" CHECK (("status" = 'changes_requested' AND "return_comment" IS NOT NULL AND length(trim("return_comment")) > 0) OR ("status" <> 'changes_requested' AND "return_comment" IS NULL));--> statement-breakpoint
ALTER TABLE "timesheet_review_events" ADD COLUMN "internal_reason" text;--> statement-breakpoint
ALTER TABLE "timesheet_review_events" ADD COLUMN "previous_approver_membership_id" bigint;--> statement-breakpoint
ALTER TABLE "timesheet_review_events" ADD COLUMN "next_approver_membership_id" bigint;--> statement-breakpoint
ALTER TABLE "timesheet_review_events" ADD CONSTRAINT "timesheet_review_events_previous_approver_fk" FOREIGN KEY ("previous_approver_membership_id") REFERENCES "workspace_memberships"("id");--> statement-breakpoint
ALTER TABLE "timesheet_review_events" ADD CONSTRAINT "timesheet_review_events_next_approver_fk" FOREIGN KEY ("next_approver_membership_id") REFERENCES "workspace_memberships"("id");
