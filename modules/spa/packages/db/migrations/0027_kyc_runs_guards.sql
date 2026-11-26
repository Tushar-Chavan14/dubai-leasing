-- C17 (S49): a helper's recorded answer and a KYC run never change and are never deleted. A new check is a new row.
CREATE OR REPLACE FUNCTION helper_runs_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'helper_runs is append-only (% refused)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER helper_runs_no_update_delete
  BEFORE UPDATE OR DELETE ON helper_runs
  FOR EACH ROW EXECUTE FUNCTION helper_runs_append_only();
--> statement-breakpoint
CREATE TRIGGER helper_runs_no_truncate
  BEFORE TRUNCATE ON helper_runs
  FOR EACH STATEMENT EXECUTE FUNCTION helper_runs_append_only();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION kyc_runs_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'kyc_runs rows are immutable (% refused)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER kyc_runs_no_update_delete
  BEFORE UPDATE OR DELETE ON kyc_runs
  FOR EACH ROW EXECUTE FUNCTION kyc_runs_immutable();
--> statement-breakpoint
CREATE TRIGGER kyc_runs_no_truncate
  BEFORE TRUNCATE ON kyc_runs
  FOR EACH STATEMENT EXECUTE FUNCTION kyc_runs_immutable();
