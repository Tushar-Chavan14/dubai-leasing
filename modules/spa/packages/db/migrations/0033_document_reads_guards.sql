-- C20 (S52): what a reader saw and a company check never change and are never deleted. A new read or check is a new row.
-- A read holds no confirmation: an amount counts only as bank_letters.amount_fils with confirmed_by (S47).
CREATE OR REPLACE FUNCTION document_reads_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'document_reads rows are immutable (% refused)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER document_reads_no_update_delete
  BEFORE UPDATE OR DELETE ON document_reads
  FOR EACH ROW EXECUTE FUNCTION document_reads_immutable();
--> statement-breakpoint
CREATE TRIGGER document_reads_no_truncate
  BEFORE TRUNCATE ON document_reads
  FOR EACH STATEMENT EXECUTE FUNCTION document_reads_immutable();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION company_checks_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'company_checks rows are immutable (% refused)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER company_checks_no_update_delete
  BEFORE UPDATE OR DELETE ON company_checks
  FOR EACH ROW EXECUTE FUNCTION company_checks_immutable();
--> statement-breakpoint
CREATE TRIGGER company_checks_no_truncate
  BEFORE TRUNCATE ON company_checks
  FOR EACH STATEMENT EXECUTE FUNCTION company_checks_immutable();
