DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tempoledger_app') THEN
		CREATE ROLE tempoledger_app NOLOGIN NOBYPASSRLS;
	END IF;
END $$;--> statement-breakpoint
GRANT CONNECT ON DATABASE postgres TO tempoledger_app;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO tempoledger_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "users", "workspaces", "workspace_memberships", "workspace_invitations", "auth_sessions", "projects", "tasks", "weekly_timesheets", "time_entries", "timesheet_approval_items", "timesheet_approval_revisions", "timesheet_review_events", "timesheet_review_entry_snapshots", "workspace_audit_events", "workflow_notifications" TO tempoledger_app;--> statement-breakpoint
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO tempoledger_app;--> statement-breakpoint
DROP POLICY IF EXISTS "tempoledger_api_access" ON "users"; CREATE POLICY "tempoledger_api_access" ON "users" FOR ALL TO tempoledger_app USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "tempoledger_api_access" ON "workspaces"; CREATE POLICY "tempoledger_api_access" ON "workspaces" FOR ALL TO tempoledger_app USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "tempoledger_api_access" ON "workspace_memberships"; CREATE POLICY "tempoledger_api_access" ON "workspace_memberships" FOR ALL TO tempoledger_app USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "tempoledger_api_access" ON "workspace_invitations"; CREATE POLICY "tempoledger_api_access" ON "workspace_invitations" FOR ALL TO tempoledger_app USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "tempoledger_api_access" ON "auth_sessions"; CREATE POLICY "tempoledger_api_access" ON "auth_sessions" FOR ALL TO tempoledger_app USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "tempoledger_api_access" ON "projects"; CREATE POLICY "tempoledger_api_access" ON "projects" FOR ALL TO tempoledger_app USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "tempoledger_api_access" ON "tasks"; CREATE POLICY "tempoledger_api_access" ON "tasks" FOR ALL TO tempoledger_app USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "tempoledger_api_access" ON "weekly_timesheets"; CREATE POLICY "tempoledger_api_access" ON "weekly_timesheets" FOR ALL TO tempoledger_app USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "tempoledger_api_access" ON "time_entries"; CREATE POLICY "tempoledger_api_access" ON "time_entries" FOR ALL TO tempoledger_app USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "tempoledger_api_access" ON "timesheet_approval_items"; CREATE POLICY "tempoledger_api_access" ON "timesheet_approval_items" FOR ALL TO tempoledger_app USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "tempoledger_api_access" ON "timesheet_approval_revisions"; CREATE POLICY "tempoledger_api_access" ON "timesheet_approval_revisions" FOR ALL TO tempoledger_app USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "tempoledger_api_access" ON "timesheet_review_events"; CREATE POLICY "tempoledger_api_access" ON "timesheet_review_events" FOR ALL TO tempoledger_app USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "tempoledger_api_access" ON "timesheet_review_entry_snapshots"; CREATE POLICY "tempoledger_api_access" ON "timesheet_review_entry_snapshots" FOR ALL TO tempoledger_app USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "tempoledger_api_access" ON "workspace_audit_events"; CREATE POLICY "tempoledger_api_access" ON "workspace_audit_events" FOR ALL TO tempoledger_app USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "tempoledger_api_access" ON "workflow_notifications"; CREATE POLICY "tempoledger_api_access" ON "workflow_notifications" FOR ALL TO tempoledger_app USING (true) WITH CHECK (true);
