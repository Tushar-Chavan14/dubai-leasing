-- C16 (S48): a settlement statement's content never changes; only its status moves, and the approval is linked once.
-- A proposed or approved statement's price lines add up exactly to its price, which is the deal's price.
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
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER settlements_guard
  BEFORE UPDATE OR DELETE ON settlements
  FOR EACH ROW EXECUTE FUNCTION settlements_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION settlements_no_truncate() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (TRUNCATE refused)', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER settlements_no_truncate
  BEFORE TRUNCATE ON settlements
  FOR EACH STATEMENT EXECUTE FUNCTION settlements_no_truncate();
--> statement-breakpoint
CREATE TRIGGER settlement_lines_no_truncate
  BEFORE TRUNCATE ON settlement_lines
  FOR EACH STATEMENT EXECUTE FUNCTION settlements_no_truncate();
--> statement-breakpoint
-- Lines are insert-only, and only while their statement is still proposed.
CREATE OR REPLACE FUNCTION settlement_lines_guard() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'settlement_lines: a line is never changed or deleted (% refused)', TG_OP;
  END IF;
  SELECT status INTO st FROM settlements WHERE id = NEW.settlement_id;
  IF st IS DISTINCT FROM 'proposed' THEN
    RAISE EXCEPTION 'settlement_lines: lines are added only to a proposed statement';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER settlement_lines_guard
  BEFORE INSERT OR UPDATE OR DELETE ON settlement_lines
  FOR EACH ROW EXECUTE FUNCTION settlement_lines_guard();
--> statement-breakpoint
-- Deferred, so a statement and its lines can be inserted in any order inside one transaction.
CREATE OR REPLACE FUNCTION settlements_balanced() RETURNS trigger AS $$
DECLARE
  sid uuid;
  s settlements%ROWTYPE;
  deal_price bigint;
  price_sum bigint;
BEGIN
  IF TG_TABLE_NAME = 'settlements' THEN
    sid := NEW.id;
  ELSE
    sid := NEW.settlement_id;
  END IF;
  SELECT * INTO s FROM settlements WHERE id = sid;
  IF NOT FOUND OR s.status NOT IN ('proposed', 'approved') THEN
    RETURN NULL;
  END IF;
  SELECT price_fils INTO deal_price FROM deals WHERE id = s.deal_id;
  IF s.price_fils IS DISTINCT FROM deal_price THEN
    RAISE EXCEPTION 'settlements: the statement price differs from the deal price';
  END IF;
  SELECT COALESCE(sum(amount_fils), 0) INTO price_sum FROM settlement_lines
    WHERE settlement_id = sid AND code LIKE 'price:%';
  IF price_sum <> s.price_fils THEN
    RAISE EXCEPTION 'settlements: the price lines add up to %, not %', price_sum, s.price_fils;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER settlements_balanced_on_statement
  AFTER INSERT ON settlements
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION settlements_balanced();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER settlements_balanced_on_line
  AFTER INSERT ON settlement_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION settlements_balanced();
