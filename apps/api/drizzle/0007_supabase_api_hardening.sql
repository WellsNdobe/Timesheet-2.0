ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspaces" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspace_memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auth_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "weekly_timesheets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "time_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "timesheet_approval_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "timesheet_approval_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "timesheet_review_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "timesheet_review_entry_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspace_audit_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workflow_notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
		EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon';
		EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon';
		EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon';
		EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon';
	END IF;
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
		EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated';
		EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated';
		EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated';
		EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM authenticated';
	END IF;
END $$;
