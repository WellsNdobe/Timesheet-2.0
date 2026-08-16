ALTER TABLE "users" ADD COLUMN "auth_version" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "password_reset_tokens_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_unique" ON "password_reset_tokens" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX "password_reset_tokens_user_created_index" ON "password_reset_tokens" USING btree ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX "password_reset_tokens_expiry_index" ON "password_reset_tokens" USING btree ("expires_at");
--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "password_reset_tokens" TO "tempoledger_app";
--> statement-breakpoint
GRANT USAGE, SELECT, UPDATE ON SEQUENCE "password_reset_tokens_id_seq" TO "tempoledger_app";
--> statement-breakpoint
CREATE POLICY "tempoledger_api_access" ON "password_reset_tokens" FOR ALL TO "tempoledger_app" USING (true) WITH CHECK (true);
