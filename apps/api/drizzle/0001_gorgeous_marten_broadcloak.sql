CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."project_review_status" AS ENUM('pending', 'approved', 'changes_requested');--> statement-breakpoint
CREATE TYPE "public"."review_event_type" AS ENUM('submitted', 'approved', 'changes_requested');--> statement-breakpoint
CREATE TYPE "public"."timesheet_status" AS ENUM('draft', 'submitted', 'changes_requested', 'approved');--> statement-breakpoint
CREATE TYPE "public"."workspace_role" AS ENUM('admin', 'manager', 'member');--> statement-breakpoint
CREATE TABLE "projects" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "projects_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"workspace_id" bigint NOT NULL,
	"name" text NOT NULL,
	"approver_membership_id" bigint,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tasks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"project_id" bigint NOT NULL,
	"name" text NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "time_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"workspace_id" bigint NOT NULL,
	"membership_id" bigint NOT NULL,
	"project_id" bigint NOT NULL,
	"task_id" bigint,
	"work_date" date NOT NULL,
	"duration_minutes" integer NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"description" text,
	"is_billable" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_entries_duration_positive" CHECK ("time_entries"."duration_minutes" > 0),
	CONSTRAINT "time_entries_timestamps_paired" CHECK (("time_entries"."started_at" is null and "time_entries"."ended_at" is null) or ("time_entries"."started_at" is not null and "time_entries"."ended_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "timesheet_project_reviews" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "timesheet_project_reviews_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"weekly_timesheet_id" bigint NOT NULL,
	"project_id" bigint NOT NULL,
	"approver_membership_id" bigint NOT NULL,
	"project_name" text NOT NULL,
	"status" "project_review_status" DEFAULT 'pending' NOT NULL,
	"submitted_minutes" integer NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_membership_id" bigint,
	"return_comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timesheet_review_entry_snapshots" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "timesheet_review_entry_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"review_id" bigint NOT NULL,
	"source_entry_id" bigint NOT NULL,
	"work_date" date NOT NULL,
	"duration_minutes" integer NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"description" text,
	"is_billable" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timesheet_review_entry_snapshots_duration_positive" CHECK ("timesheet_review_entry_snapshots"."duration_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "timesheet_review_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "timesheet_review_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"review_id" bigint NOT NULL,
	"actor_membership_id" bigint,
	"type" "review_event_type" NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_timesheets" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "weekly_timesheets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"workspace_id" bigint NOT NULL,
	"membership_id" bigint NOT NULL,
	"week_start" date NOT NULL,
	"status" timesheet_status DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp with time zone,
	"last_resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_invitations" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workspace_invitations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"workspace_id" bigint NOT NULL,
	"email" text NOT NULL,
	"role" "workspace_role" DEFAULT 'member' NOT NULL,
	"token_hash" text NOT NULL,
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"invited_by_membership_id" bigint NOT NULL,
	"accepted_by_user_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_invitations_email_lowercase" CHECK ("workspace_invitations"."email" = lower("workspace_invitations"."email"))
);
--> statement-breakpoint
CREATE TABLE "workspace_memberships" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workspace_memberships_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"workspace_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"role" "workspace_role" DEFAULT 'member' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workspaces_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"timezone" text DEFAULT 'Africa/Johannesburg' NOT NULL,
	"created_by_user_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_name_not_empty" CHECK (length(trim("workspaces"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_approver_membership_id_workspace_memberships_id_fk" FOREIGN KEY ("approver_membership_id") REFERENCES "public"."workspace_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_membership_id_workspace_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."workspace_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_project_reviews" ADD CONSTRAINT "timesheet_project_reviews_weekly_timesheet_id_weekly_timesheets_id_fk" FOREIGN KEY ("weekly_timesheet_id") REFERENCES "public"."weekly_timesheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_project_reviews" ADD CONSTRAINT "timesheet_project_reviews_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_project_reviews" ADD CONSTRAINT "timesheet_project_reviews_approver_membership_id_workspace_memberships_id_fk" FOREIGN KEY ("approver_membership_id") REFERENCES "public"."workspace_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_project_reviews" ADD CONSTRAINT "timesheet_project_reviews_resolved_by_membership_id_workspace_memberships_id_fk" FOREIGN KEY ("resolved_by_membership_id") REFERENCES "public"."workspace_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_review_entry_snapshots" ADD CONSTRAINT "timesheet_review_entry_snapshots_review_id_timesheet_project_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."timesheet_project_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_review_events" ADD CONSTRAINT "timesheet_review_events_review_id_timesheet_project_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."timesheet_project_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_review_events" ADD CONSTRAINT "timesheet_review_events_actor_membership_id_workspace_memberships_id_fk" FOREIGN KEY ("actor_membership_id") REFERENCES "public"."workspace_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_timesheets" ADD CONSTRAINT "weekly_timesheets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_timesheets" ADD CONSTRAINT "weekly_timesheets_membership_id_workspace_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."workspace_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_invited_by_membership_id_workspace_memberships_id_fk" FOREIGN KEY ("invited_by_membership_id") REFERENCES "public"."workspace_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_accepted_by_user_id_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "projects_workspace_archived_index" ON "projects" USING btree ("workspace_id","is_archived");--> statement-breakpoint
CREATE INDEX "tasks_project_archived_index" ON "tasks" USING btree ("project_id","is_archived");--> statement-breakpoint
CREATE INDEX "time_entries_workspace_membership_date_index" ON "time_entries" USING btree ("workspace_id","membership_id","work_date");--> statement-breakpoint
CREATE INDEX "time_entries_project_date_index" ON "time_entries" USING btree ("project_id","work_date");--> statement-breakpoint
CREATE UNIQUE INDEX "timesheet_project_reviews_timesheet_project_unique" ON "timesheet_project_reviews" USING btree ("weekly_timesheet_id","project_id");--> statement-breakpoint
CREATE INDEX "timesheet_project_reviews_approver_status_index" ON "timesheet_project_reviews" USING btree ("approver_membership_id","status","submitted_at");--> statement-breakpoint
CREATE INDEX "timesheet_review_entry_snapshots_review_index" ON "timesheet_review_entry_snapshots" USING btree ("review_id","work_date");--> statement-breakpoint
CREATE INDEX "timesheet_review_events_review_index" ON "timesheet_review_events" USING btree ("review_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_timesheets_workspace_membership_week_unique" ON "weekly_timesheets" USING btree ("workspace_id","membership_id","week_start");--> statement-breakpoint
CREATE INDEX "weekly_timesheets_workspace_membership_week_index" ON "weekly_timesheets" USING btree ("workspace_id","membership_id","week_start");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_invitations_token_hash_unique" ON "workspace_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "workspace_invitations_workspace_status_index" ON "workspace_invitations" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_memberships_workspace_user_unique" ON "workspace_memberships" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "workspace_memberships_user_index" ON "workspace_memberships" USING btree ("user_id");