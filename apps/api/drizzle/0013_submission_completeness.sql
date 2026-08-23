CREATE TABLE "workspace_time_policies" (
	"workspace_id" bigint PRIMARY KEY REFERENCES "workspaces"("id") ON DELETE cascade,
	"expected_weekly_minutes" integer DEFAULT 2400 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_time_policies_expected_weekly_minutes_valid" CHECK ("expected_weekly_minutes" > 0 and "expected_weekly_minutes" <= 10080 and mod("expected_weekly_minutes", 5) = 0)
);
--> statement-breakpoint
ALTER TABLE "workspace_time_policies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "workspace_time_policies" TO "tempoledger_app";
--> statement-breakpoint
CREATE POLICY "tempoledger_api_access" ON "workspace_time_policies" FOR ALL TO "tempoledger_app" USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE TABLE "time_expectancy_exceptions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"workspace_id" bigint NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
	"membership_id" bigint REFERENCES "workspace_memberships"("id") ON DELETE cascade,
	"work_date" date NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"created_by_membership_id" bigint NOT NULL REFERENCES "workspace_memberships"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_expectancy_exceptions_type_valid" CHECK ("type" in ('public_holiday', 'leave')),
	CONSTRAINT "time_expectancy_exceptions_scope_valid" CHECK (("type" = 'public_holiday' and "membership_id" is null) or ("type" = 'leave' and "membership_id" is not null)),
	CONSTRAINT "time_expectancy_exceptions_name_not_empty" CHECK (length(trim("name")) > 0),
	CONSTRAINT "time_expectancy_exceptions_duration_valid" CHECK ("duration_minutes" > 0 and "duration_minutes" <= 1440)
);
--> statement-breakpoint
CREATE INDEX "time_expectancy_exceptions_workspace_date_index" ON "time_expectancy_exceptions" USING btree ("workspace_id", "work_date");
--> statement-breakpoint
CREATE UNIQUE INDEX "time_expectancy_exceptions_public_holiday_unique" ON "time_expectancy_exceptions" USING btree ("workspace_id", "work_date") WHERE "type" = 'public_holiday';
--> statement-breakpoint
CREATE UNIQUE INDEX "time_expectancy_exceptions_membership_date_unique" ON "time_expectancy_exceptions" USING btree ("workspace_id", "membership_id", "work_date") WHERE "type" = 'leave';
--> statement-breakpoint
ALTER TABLE "time_expectancy_exceptions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "time_expectancy_exceptions" TO "tempoledger_app";
--> statement-breakpoint
GRANT USAGE, SELECT, UPDATE ON SEQUENCE "time_expectancy_exceptions_id_seq" TO "tempoledger_app";
--> statement-breakpoint
CREATE POLICY "tempoledger_api_access" ON "time_expectancy_exceptions" FOR ALL TO "tempoledger_app" USING (true) WITH CHECK (true);
