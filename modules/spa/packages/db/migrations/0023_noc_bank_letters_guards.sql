-- C15 (S47): uploaded documents never change; a NOC record and a bank letter change only by being superseded, so a
-- confirmed amount can never be edited. A correction is a new row. Deletes are refused.
CREATE OR REPLACE FUNCTION documents_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'documents is append-only (% refused)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER documents_no_update_delete
  BEFORE UPDATE OR DELETE ON documents
  FOR EACH ROW EXECUTE FUNCTION documents_append_only();
--> statement-breakpoint
CREATE TRIGGER documents_no_truncate
  BEFORE TRUNCATE ON documents
  FOR EACH STATEMENT EXECUTE FUNCTION documents_append_only();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION noc_records_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'noc_records: a record is never deleted';
  END IF;
  -- Everything but the status stays as entered; the only status change is to superseded.
  IF to_jsonb(NEW) - 'status' IS DISTINCT FROM to_jsonb(OLD) - 'status' THEN
    RAISE EXCEPTION 'noc_records: an entered record is fixed; enter a new one';
  END IF;
  IF NEW.status <> OLD.status AND NOT (OLD.status <> 'superseded' AND NEW.status = 'superseded') THEN
    RAISE EXCEPTION 'noc_records: status can only become superseded';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER noc_records_guard
  BEFORE UPDATE OR DELETE ON noc_records
  FOR EACH ROW EXECUTE FUNCTION noc_records_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION bank_letters_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'bank_letters: a letter is never deleted';
  END IF;
  IF to_jsonb(NEW) - 'status' IS DISTINCT FROM to_jsonb(OLD) - 'status' THEN
    RAISE EXCEPTION 'bank_letters: an entered letter is fixed; confirm again to write a new row';
  END IF;
  IF NEW.status <> OLD.status AND NOT (OLD.status = 'current' AND NEW.status = 'superseded') THEN
    RAISE EXCEPTION 'bank_letters: status can only become superseded';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER bank_letters_guard
  BEFORE UPDATE OR DELETE ON bank_letters
  FOR EACH ROW EXECUTE FUNCTION bank_letters_guard();
