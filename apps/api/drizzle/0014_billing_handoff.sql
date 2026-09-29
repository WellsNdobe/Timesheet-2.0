CREATE TABLE project_rates (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  project_id bigint NOT NULL REFERENCES projects(id),
  effective_from date NOT NULL,
  hourly_rate_cents integer NOT NULL,
  currency text NOT NULL,
  is_legacy boolean NOT NULL DEFAULT false,
  reason text NOT NULL,
  created_by_membership_id bigint REFERENCES workspace_memberships(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_rates_amount_valid CHECK (hourly_rate_cents >= 0 AND hourly_rate_cents <= 100000000),
  CONSTRAINT project_rates_currency_valid CHECK (currency ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX project_rates_project_date_unique ON project_rates(project_id, effective_from);
--> statement-breakpoint
-- This is a labelled legacy estimate, not a claim about historical contracted rates.
-- Billing requires an Admin to add a confirmed, dated rate before these entries are eligible.
INSERT INTO project_rates(project_id, effective_from, hourly_rate_cents, currency, is_legacy, reason)
SELECT id, '0001-01-01', hourly_rate_cents, rate_currency, true, 'Imported current rate; historical applicability unconfirmed'
FROM projects WHERE hourly_rate_cents IS NOT NULL AND rate_currency IS NOT NULL;
--> statement-breakpoint
CREATE TABLE billing_batches (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  workspace_id bigint NOT NULL REFERENCES workspaces(id),
  client_id bigint NOT NULL REFERENCES clients(id),
  client_name text NOT NULL,
  currency text NOT NULL,
  total_minutes integer NOT NULL,
  total_cents bigint NOT NULL,
  entry_count integer NOT NULL,
  date_from date NOT NULL,
  date_to date NOT NULL,
  idempotency_key uuid NOT NULL,
  request_fingerprint text NOT NULL,
  created_by_membership_id bigint NOT NULL REFERENCES workspace_memberships(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  invoice_reference text,
  handed_off_at timestamptz,
  CONSTRAINT billing_batches_totals_valid CHECK (total_minutes > 0 AND total_cents >= 0 AND entry_count > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX billing_batches_request_unique ON billing_batches(workspace_id, idempotency_key);
--> statement-breakpoint
CREATE INDEX billing_batches_workspace_id_index ON billing_batches(workspace_id, id);
--> statement-breakpoint
CREATE TABLE billing_batch_entries (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  batch_id bigint NOT NULL REFERENCES billing_batches(id),
  workspace_id bigint NOT NULL REFERENCES workspaces(id),
  snapshot_id bigint NOT NULL REFERENCES timesheet_review_entry_snapshots(id),
  source_entry_id bigint NOT NULL,
  revision_id bigint NOT NULL REFERENCES timesheet_approval_revisions(id),
  project_id bigint NOT NULL REFERENCES projects(id),
  project_name text NOT NULL,
  member_email text NOT NULL,
  task_name text,
  description text,
  work_date date NOT NULL,
  duration_minutes integer NOT NULL,
  rate_id bigint NOT NULL REFERENCES project_rates(id),
  hourly_rate_cents integer NOT NULL,
  amount_cents bigint NOT NULL,
  CONSTRAINT billing_batch_entries_amount_valid CHECK (duration_minutes > 0 AND hourly_rate_cents >= 0 AND amount_cents >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX billing_batch_entries_source_unique ON billing_batch_entries(workspace_id, source_entry_id);
--> statement-breakpoint
CREATE UNIQUE INDEX billing_batch_entries_snapshot_unique ON billing_batch_entries(snapshot_id);
--> statement-breakpoint
CREATE INDEX billing_batch_entries_batch_index ON billing_batch_entries(batch_id);
--> statement-breakpoint
CREATE INDEX billing_batch_entries_project_date_index ON billing_batch_entries(project_id, work_date);
--> statement-breakpoint
ALTER TABLE project_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_batch_entries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tempoledger_api_access ON project_rates FOR ALL TO tempoledger_app USING (true) WITH CHECK (true);
CREATE POLICY tempoledger_api_access ON billing_batches FOR ALL TO tempoledger_app USING (true) WITH CHECK (true);
CREATE POLICY tempoledger_api_access ON billing_batch_entries FOR ALL TO tempoledger_app USING (true) WITH CHECK (true);
--> statement-breakpoint
-- Override the application's default grants: rates and financial snapshots are append-only.
REVOKE ALL ON project_rates, billing_batches, billing_batch_entries FROM tempoledger_app;
GRANT SELECT, INSERT ON project_rates, billing_batches, billing_batch_entries TO tempoledger_app;
GRANT UPDATE (invoice_reference, handed_off_at) ON billing_batches TO tempoledger_app;
GRANT USAGE, SELECT ON SEQUENCE project_rates_id_seq, billing_batches_id_seq, billing_batch_entries_id_seq TO tempoledger_app;
