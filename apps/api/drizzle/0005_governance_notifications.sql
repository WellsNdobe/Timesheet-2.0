CREATE TABLE "workspace_audit_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"workspace_id" bigint NOT NULL,
	"actor_membership_id" bigint,
	"type" text NOT NULL,
	"target_membership_id" bigint,
	"target_project_id" bigint,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "workflow_notifications" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"workspace_id" bigint NOT NULL,
	"recipient_membership_id" bigint NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"href" text NOT NULL,
	"source_key" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "workspace_audit_events" ADD CONSTRAINT "workspace_audit_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "workspace_audit_events" ADD CONSTRAINT "workspace_audit_events_actor_membership_id_workspace_memberships_id_fk" FOREIGN KEY ("actor_membership_id") REFERENCES "workspace_memberships"("id");--> statement-breakpoint
ALTER TABLE "workspace_audit_events" ADD CONSTRAINT "workspace_audit_events_target_membership_id_workspace_memberships_id_fk" FOREIGN KEY ("target_membership_id") REFERENCES "workspace_memberships"("id");--> statement-breakpoint
ALTER TABLE "workspace_audit_events" ADD CONSTRAINT "workspace_audit_events_target_project_id_projects_id_fk" FOREIGN KEY ("target_project_id") REFERENCES "projects"("id");--> statement-breakpoint
ALTER TABLE "workflow_notifications" ADD CONSTRAINT "workflow_notifications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "workflow_notifications" ADD CONSTRAINT "workflow_notifications_recipient_membership_id_workspace_memberships_id_fk" FOREIGN KEY ("recipient_membership_id") REFERENCES "workspace_memberships"("id") ON DELETE cascade;--> statement-breakpoint
CREATE INDEX "workspace_audit_events_workspace_created_index" ON "workspace_audit_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_notifications_recipient_source_unique" ON "workflow_notifications" USING btree ("recipient_membership_id","source_key");--> statement-breakpoint
CREATE INDEX "workflow_notifications_recipient_created_index" ON "workflow_notifications" USING btree ("recipient_membership_id","created_at");
