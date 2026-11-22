-- spa_policy versions never change (C3).
CREATE OR REPLACE FUNCTION spa_policy_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'spa_policy versions are immutable (% refused)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER spa_policy_no_update_delete
  BEFORE UPDATE OR DELETE ON spa_policy
  FOR EACH ROW EXECUTE FUNCTION spa_policy_immutable();
--> statement-breakpoint
-- A decided approval is final: only its consumption may be recorded, once. Approvals are never deleted.
CREATE OR REPLACE FUNCTION spa_approvals_decided_final() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'spa_approvals: a decided approval is final (DELETE refused)';
  END IF;
  IF OLD.status <> 'pending' THEN
    IF OLD.consumed_by_event_id IS NULL AND NEW.consumed_by_event_id IS NOT NULL
       AND (to_jsonb(NEW) - 'consumed_by_event_id') = (to_jsonb(OLD) - 'consumed_by_event_id') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'spa_approvals: a decided approval is final';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER spa_approvals_final
  BEFORE UPDATE OR DELETE ON spa_approvals
  FOR EACH ROW EXECUTE FUNCTION spa_approvals_decided_final();
