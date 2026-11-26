-- C27 (S53): a registration attempt runs only under an approved gate of the right kind for the same deal (an issued row
-- too: no code path and no hand-written insert gets around it), and attempts are evidence: never changed, deleted or truncated.
CREATE OR REPLACE FUNCTION registrations_guard() RETURNS trigger AS $$
DECLARE
  a spa_approvals%ROWTYPE;
  want text;
BEGIN
  want := CASE WHEN NEW.kind = 'oqood_register' THEN 'oqood_submission' ELSE 'transfer_submission' END;
  SELECT * INTO a FROM spa_approvals WHERE id = NEW.approval_id;
  IF NOT FOUND OR a.gate <> want OR a.entity_kind <> 'deal' OR a.entity_id <> NEW.deal_id OR a.status <> 'approved' THEN
    RAISE EXCEPTION 'registrations: needs an approved % approval for the same deal', want;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER registrations_guard
  BEFORE INSERT ON registrations
  FOR EACH ROW EXECUTE FUNCTION registrations_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION registrations_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'registrations rows are immutable (% refused)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER registrations_no_update_delete
  BEFORE UPDATE OR DELETE ON registrations
  FOR EACH ROW EXECUTE FUNCTION registrations_immutable();
--> statement-breakpoint
CREATE TRIGGER registrations_no_truncate
  BEFORE TRUNCATE ON registrations
  FOR EACH STATEMENT EXECUTE FUNCTION registrations_immutable();
