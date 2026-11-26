-- C22 (S55): escrow accounts, payments and tasks are evidence. A payment is inserted unconfirmed and can only become
-- `counted` (the CHECKs then need a finance confirmation and an escrow account); nothing is deleted or truncated.

CREATE OR REPLACE FUNCTION project_escrow_accounts_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.superseded_at IS NULL AND NEW.superseded_at IS NOT NULL
     AND NEW.id = OLD.id AND NEW.project_code = OLD.project_code AND NEW.account_holder = OLD.account_holder
     AND NEW.iban = OLD.iban AND NEW.bank_name = OLD.bank_name AND NEW.entered_by = OLD.entered_by
     AND NEW.valid_from = OLD.valid_from THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'project_escrow_accounts are append-only: only superseded_at is set, once (% refused)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER project_escrow_accounts_append_only
  BEFORE UPDATE OR DELETE ON project_escrow_accounts
  FOR EACH ROW EXECUTE FUNCTION project_escrow_accounts_append_only();
--> statement-breakpoint
CREATE TRIGGER project_escrow_accounts_no_truncate
  BEFORE TRUNCATE ON project_escrow_accounts
  FOR EACH STATEMENT EXECUTE FUNCTION project_escrow_accounts_append_only();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION payments_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'counted' THEN
      RAISE EXCEPTION 'payments: a payment is inserted unconfirmed and becomes counted only by a finance confirmation';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.deal_id IS DISTINCT FROM OLD.deal_id OR NEW.seq IS DISTINCT FROM OLD.seq
       OR NEW.document_id IS DISTINCT FROM OLD.document_id OR NEW.read_id IS DISTINCT FROM OLD.read_id
       OR NEW.method IS DISTINCT FROM OLD.method OR NEW.amount_read_fils IS DISTINCT FROM OLD.amount_read_fils
       OR NEW.paid_on IS DISTINCT FROM OLD.paid_on OR NEW.payer_name_read IS DISTINCT FROM OLD.payer_name_read
       OR NEW.payer_party_id IS DISTINCT FROM OLD.payer_party_id
       OR NEW.account_read_masked IS DISTINCT FROM OLD.account_read_masked
       OR NEW.into_escrow IS DISTINCT FROM OLD.into_escrow OR NEW.payer_is_buyer IS DISTINCT FROM OLD.payer_is_buyer
       OR NEW.reason_code IS DISTINCT FROM OLD.reason_code OR NEW.registered_by IS DISTINCT FROM OLD.registered_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'payments: only the status, the amount and the confirmation change';
    END IF;
    IF OLD.status NOT IN ('read', 'needs_review') OR NEW.status <> 'counted' THEN
      RAISE EXCEPTION 'payments: a payment changes only from read or needs_review to counted';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'payments rows are evidence: never deleted or truncated (% refused)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER payments_guard
  BEFORE INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_guard();
--> statement-breakpoint
CREATE TRIGGER payments_no_truncate
  BEFORE TRUNCATE ON payments
  FOR EACH STATEMENT EXECUTE FUNCTION payments_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION spa_tasks_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.deal_id IS DISTINCT FROM OLD.deal_id OR NEW.kind IS DISTINCT FROM OLD.kind
       OR NEW.role IS DISTINCT FROM OLD.role OR NEW.title IS DISTINCT FROM OLD.title
       OR NEW.detail IS DISTINCT FROM OLD.detail OR NEW.dedupe_key IS DISTINCT FROM OLD.dedupe_key
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'spa_tasks: only the status and who finished it change';
    END IF;
    IF OLD.status <> 'open' OR NEW.status NOT IN ('done', 'cancelled') THEN
      RAISE EXCEPTION 'spa_tasks: a task goes from open to done or cancelled, once';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'spa_tasks are never deleted or truncated (% refused)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER spa_tasks_guard
  BEFORE UPDATE OR DELETE ON spa_tasks
  FOR EACH ROW EXECUTE FUNCTION spa_tasks_guard();
--> statement-breakpoint
CREATE TRIGGER spa_tasks_no_truncate
  BEFORE TRUNCATE ON spa_tasks
  FOR EACH STATEMENT EXECUTE FUNCTION spa_tasks_guard();
