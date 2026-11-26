-- C14-C20 review: TRUNCATE guards on the records that had none, a broker row's commission and approval link are fixed
-- once linked, and a statement or agreement becomes approved only through its own approved gate for the same deal.
CREATE OR REPLACE FUNCTION review_no_truncate() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (TRUNCATE refused)', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER noc_records_no_truncate BEFORE TRUNCATE ON noc_records
  FOR EACH STATEMENT EXECUTE FUNCTION review_no_truncate();
--> statement-breakpoint
CREATE TRIGGER bank_letters_no_truncate BEFORE TRUNCATE ON bank_letters
  FOR EACH STATEMENT EXECUTE FUNCTION review_no_truncate();
--> statement-breakpoint
CREATE TRIGGER payment_plan_rows_no_truncate BEFORE TRUNCATE ON payment_plan_rows
  FOR EACH STATEMENT EXECUTE FUNCTION review_no_truncate();
--> statement-breakpoint
CREATE TRIGGER deal_brokers_no_truncate BEFORE TRUNCATE ON deal_brokers
  FOR EACH STATEMENT EXECUTE FUNCTION review_no_truncate();
--> statement-breakpoint
-- A broker is set once (never deleted). Until an approval is linked the row may be corrected; the link is write-once, and
-- once linked the commission, side and deal never change, so an approved override stays the one that was approved.
CREATE OR REPLACE FUNCTION deal_brokers_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'deal_brokers: a broker is never deleted';
  END IF;
  IF OLD.commission_approval_id IS NOT NULL AND NEW.commission_approval_id IS DISTINCT FROM OLD.commission_approval_id THEN
    RAISE EXCEPTION 'deal_brokers: the approval is linked once';
  END IF;
  IF OLD.commission_approval_id IS NOT NULL
     AND (NEW.commission_bps <> OLD.commission_bps OR NEW.side <> OLD.side OR NEW.deal_id <> OLD.deal_id) THEN
    RAISE EXCEPTION 'deal_brokers: the commission and side are fixed once an approval is linked';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER deal_brokers_guard
  BEFORE UPDATE OR DELETE ON deal_brokers
  FOR EACH ROW EXECUTE FUNCTION deal_brokers_guard();
--> statement-breakpoint
-- Same as 0025, and a statement becomes approved only through its own approved settlement_approval for the same deal.
CREATE OR REPLACE FUNCTION settlements_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'settlements: a statement is never deleted';
  END IF;
  IF to_jsonb(NEW) - 'status' - 'decided_at' - 'approval_id' IS DISTINCT FROM to_jsonb(OLD) - 'status' - 'decided_at' - 'approval_id' THEN
    RAISE EXCEPTION 'settlements: a statement is fixed; build a new version';
  END IF;
  IF NEW.approval_id IS DISTINCT FROM OLD.approval_id AND OLD.approval_id IS NOT NULL THEN
    RAISE EXCEPTION 'settlements: the approval is linked once';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'proposed' AND NEW.status IN ('approved', 'stale', 'superseded'))
    OR (OLD.status = 'approved' AND NEW.status IN ('stale', 'superseded'))
  ) THEN
    RAISE EXCEPTION 'settlements: % cannot become %', OLD.status, NEW.status;
  END IF;
  IF NEW.status = 'approved' AND OLD.status <> 'approved' AND NOT EXISTS (
    SELECT 1 FROM spa_approvals a
    WHERE a.id = NEW.approval_id AND a.gate = 'settlement_approval' AND a.status = 'approved'
      AND a.entity_kind = 'deal' AND a.entity_id = NEW.deal_id
  ) THEN
    RAISE EXCEPTION 'settlements: an approved statement needs its own approved settlement_approval for this deal';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
-- Same as 0031, and an agreement becomes approved only through its own approved agreement_approval for the same deal.
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
  IF NEW.status = 'approved' AND OLD.status <> 'approved' AND NOT EXISTS (
    SELECT 1 FROM spa_approvals a
    WHERE a.id = NEW.approval_id AND a.gate = 'agreement_approval' AND a.status = 'approved'
      AND a.entity_kind = 'deal' AND a.entity_id = NEW.deal_id
  ) THEN
    RAISE EXCEPTION 'agreements: an approved agreement needs its own approved agreement_approval for this deal';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
