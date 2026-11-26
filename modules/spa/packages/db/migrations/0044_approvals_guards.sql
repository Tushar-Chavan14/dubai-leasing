-- C29 (S57): a pending approval is what its proposer wrote. Raw SQL can no longer edit the proposal a person is about to
-- decide, and neither spa_approvals nor spa_policy can be emptied. Decided approvals stay final (0005); policy
-- versions stay immutable (0005). `reasons` is left editable while pending: a template re-check refreshes it (S45).
CREATE OR REPLACE FUNCTION spa_approvals_decided_final() RETURNS trigger AS $$
DECLARE
  col text;
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
  -- Pending: only the decision columns, the reasons and the consumption may change.
  FOREACH col IN ARRAY ARRAY['id', 'gate', 'entity_kind', 'entity_id', 'dedupe_key', 'title', 'proposal', 'rules_version', 'approver_role', 'proposed_by', 'created_at']
  LOOP
    IF (to_jsonb(NEW) -> col) IS DISTINCT FROM (to_jsonb(OLD) -> col) THEN
      RAISE EXCEPTION 'spa_approvals: a pending approval''s % can''t be changed', col;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION spa_truncate_refused() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is never emptied (TRUNCATE refused)', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER spa_approvals_no_truncate
  BEFORE TRUNCATE ON spa_approvals
  FOR EACH STATEMENT EXECUTE FUNCTION spa_truncate_refused();
--> statement-breakpoint
CREATE TRIGGER spa_policy_no_truncate
  BEFORE TRUNCATE ON spa_policy
  FOR EACH STATEMENT EXECUTE FUNCTION spa_truncate_refused();
