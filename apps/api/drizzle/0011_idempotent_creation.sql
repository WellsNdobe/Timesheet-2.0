CREATE TABLE "idempotency_operations" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"workspace_id" bigint NOT NULL,
	"actor_membership_id" bigint NOT NULL,
	"operation" text NOT NULL,
	"key" uuid NOT NULL,
	"request_fingerprint" text NOT NULL,
	"state" text DEFAULT 'processing' NOT NULL,
	"resource_id" bigint,
	"response_status" integer,
	"response_payload" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_operations_state_valid" CHECK ("state" in ('processing', 'completed')),
	CONSTRAINT "idempotency_operations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade,
	CONSTRAINT "idempotency_operations_actor_membership_id_workspace_memberships_id_fk" FOREIGN KEY ("actor_membership_id") REFERENCES "workspace_memberships"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_operations_scope_key_unique" ON "idempotency_operations" USING btree ("workspace_id", "actor_membership_id", "operation", "key");
--> statement-breakpoint
CREATE INDEX "idempotency_operations_expiry_index" ON "idempotency_operations" USING btree ("expires_at");
--> statement-breakpoint
ALTER TABLE "idempotency_operations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "idempotency_operations" TO "tempoledger_app";
--> statement-breakpoint
GRANT USAGE, SELECT, UPDATE ON SEQUENCE "idempotency_operations_id_seq" TO "tempoledger_app";
--> statement-breakpoint
CREATE POLICY "tempoledger_api_access" ON "idempotency_operations" FOR ALL TO "tempoledger_app" USING (true) WITH CHECK (true);
