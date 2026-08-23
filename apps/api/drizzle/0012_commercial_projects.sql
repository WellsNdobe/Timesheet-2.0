CREATE TABLE "clients" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"workspace_id" bigint NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
	"name" text NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clients_name_not_empty" CHECK (length(trim("name")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "clients_workspace_name_unique" ON "clients" USING btree ("workspace_id", "name");
--> statement-breakpoint
CREATE INDEX "clients_workspace_archived_index" ON "clients" USING btree ("workspace_id", "is_archived");
--> statement-breakpoint
ALTER TABLE "clients" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "clients" TO "tempoledger_app";
--> statement-breakpoint
GRANT USAGE, SELECT, UPDATE ON SEQUENCE "clients_id_seq" TO "tempoledger_app";
--> statement-breakpoint
CREATE POLICY "tempoledger_api_access" ON "clients" FOR ALL TO "tempoledger_app" USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "client_id" bigint REFERENCES "clients"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "hourly_rate_cents" integer;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "rate_currency" text;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "budget_minutes" integer;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "budget_cents" integer;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "budget_currency" text;
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_rate_valid" CHECK (("hourly_rate_cents" is null and "rate_currency" is null) or ("hourly_rate_cents" >= 0 and "rate_currency" ~ '^[A-Z]{3}$'));
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_budget_minutes_valid" CHECK ("budget_minutes" is null or "budget_minutes" > 0);
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_budget_cents_valid" CHECK (("budget_cents" is null and "budget_currency" is null) or ("budget_cents" >= 0 and "budget_currency" ~ '^[A-Z]{3}$'));
--> statement-breakpoint
CREATE INDEX "projects_client_index" ON "projects" USING btree ("client_id");
