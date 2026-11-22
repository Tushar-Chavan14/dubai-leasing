-- C18 (S50): screenings and aml_hits are records (append-only); a case changes only its status, approval and closing
-- time, and once closed (cleared, stopped, reported) it stays closed. Cases are never deleted.
CREATE OR REPLACE FUNCTION aml_records_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% refused)', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER screenings_no_update_delete BEFORE UPDATE OR DELETE ON screenings
  FOR EACH ROW EXECUTE FUNCTION aml_records_append_only();
--> statement-breakpoint
CREATE TRIGGER screenings_no_truncate BEFORE TRUNCATE ON screenings
  FOR EACH STATEMENT EXECUTE FUNCTION aml_records_append_only();
--> statement-breakpoint
CREATE TRIGGER aml_hits_no_update_delete BEFORE UPDATE OR DELETE ON aml_hits
  FOR EACH ROW EXECUTE FUNCTION aml_records_append_only();
--> statement-breakpoint
CREATE TRIGGER aml_hits_no_truncate BEFORE TRUNCATE ON aml_hits
  FOR EACH STATEMENT EXECUTE FUNCTION aml_records_append_only();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aml_cases_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'aml_cases are never deleted (% refused)', TG_OP;
  END IF;
  IF (NEW.id, NEW.deal_id, NEW.summary, NEW.summary_model, NEW.instruction_like, NEW.opened_at)
     IS DISTINCT FROM (OLD.id, OLD.deal_id, OLD.summary, OLD.summary_model, OLD.instruction_like, OLD.opened_at) THEN
    RAISE EXCEPTION 'an aml_case changes only its status, approval and closing time';
  END IF;
  IF OLD.status IN ('cleared', 'stopped', 'reported') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'a closed aml_case stays closed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER aml_cases_guard BEFORE UPDATE OR DELETE ON aml_cases
  FOR EACH ROW EXECUTE FUNCTION aml_cases_guard();
--> statement-breakpoint
CREATE TRIGGER aml_cases_no_truncate BEFORE TRUNCATE ON aml_cases
  FOR EACH STATEMENT EXECUTE FUNCTION aml_cases_guard();
