-- C19 (S51): an agreement's content never changes; only its status moves forward and the approval is linked once.
CREATE OR REPLACE FUNCTION agreements_guard() RETURNS trigger AS $$
DECLARE
  old_rank int;
  new_rank int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'agreements: an agreement is never deleted';
  END IF;
  IF to_jsonb(NEW) - 'status' - 'approval_id' IS DISTINCT FROM to_jsonb(OLD) - 'status' - 'approval_id' THEN
    RAISE EXCEPTION 'agreements: an agreement is fixed; prepare a new version';
  END IF;
  IF NEW.approval_id IS DISTINCT FROM OLD.approval_id AND OLD.approval_id IS NOT NULL THEN
    RAISE EXCEPTION 'agreements: the approval is linked once';
  END IF;
  IF NEW.status <> OLD.status THEN
    old_rank := CASE OLD.status WHEN 'prepared' THEN 0 WHEN 'in_review' THEN 1 WHEN 'approved' THEN 2 ELSE 3 END;
    new_rank := CASE NEW.status WHEN 'prepared' THEN 0 WHEN 'in_review' THEN 1 WHEN 'approved' THEN 2 ELSE 3 END;
    IF new_rank <= old_rank THEN
      RAISE EXCEPTION 'agreements: % cannot become %', OLD.status, NEW.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER agreements_guard
  BEFORE UPDATE OR DELETE ON agreements
  FOR EACH ROW EXECUTE FUNCTION agreements_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION agreements_no_truncate() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (TRUNCATE refused)', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER agreements_no_truncate
  BEFORE TRUNCATE ON agreements
  FOR EACH STATEMENT EXECUTE FUNCTION agreements_no_truncate();
--> statement-breakpoint
-- The plan rows are fixed while a live agreement prints them (a rejected one is superseded and frees them).
CREATE OR REPLACE FUNCTION payment_plan_rows_guard() RETURNS trigger AS $$
DECLARE
  d uuid;
BEGIN
  d := CASE WHEN TG_OP = 'DELETE' THEN OLD.deal_id ELSE NEW.deal_id END;
  IF EXISTS (SELECT 1 FROM agreements WHERE deal_id = d AND status <> 'superseded') THEN
    RAISE EXCEPTION 'payment_plan_rows: the plan is fixed while an agreement is live';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER payment_plan_rows_guard
  BEFORE INSERT OR UPDATE OR DELETE ON payment_plan_rows
  FOR EACH ROW EXECUTE FUNCTION payment_plan_rows_guard();
