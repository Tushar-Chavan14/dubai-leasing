-- Compliance-review fixes for C21-C30. (1) A review hold is released only by its own approved helper_review on the same
-- deal and rejected only by a rejected one (S59): raw SQL can no longer decide a hold that no person decided.
-- (2) The assistants' threads and the rate-limit counters are never emptied (S61): a TRUNCATE would reset every limit.
CREATE OR REPLACE FUNCTION helper_review_holds_guard() RETURNS trigger AS $$
DECLARE
  col text;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'helper_review_holds are never emptied (TRUNCATE refused)';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'helper_review_holds are never deleted';
  END IF;
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'helper_review_holds: a decided hold is final';
  END IF;
  FOREACH col IN ARRAY ARRAY['run_id', 'deal_id', 'approval_id', 'created_at']
  LOOP
    IF (to_jsonb(NEW) -> col) IS DISTINCT FROM (to_jsonb(OLD) -> col) THEN
      RAISE EXCEPTION 'helper_review_holds: % can''t be changed', col;
    END IF;
  END LOOP;
  IF NEW.status NOT IN ('released', 'rejected') THEN
    RAISE EXCEPTION 'helper_review_holds: a pending hold is released or rejected';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM spa_approvals a
    WHERE a.id = NEW.approval_id AND a.gate = 'helper_review' AND a.entity_kind = 'deal' AND a.entity_id = NEW.deal_id
      AND a.status = CASE NEW.status WHEN 'released' THEN 'approved' ELSE 'rejected' END
  ) THEN
    IF NEW.status = 'released' THEN
      RAISE EXCEPTION 'helper_review_holds: a hold is released only by its own approved helper_review on the same deal';
    END IF;
    RAISE EXCEPTION 'helper_review_holds: a hold is rejected only by its own rejected helper_review on the same deal';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER assistant_threads_no_truncate
  BEFORE TRUNCATE ON assistant_threads
  FOR EACH STATEMENT EXECUTE FUNCTION spa_truncate_refused();
--> statement-breakpoint
CREATE TRIGGER assistant_rate_limits_no_truncate
  BEFORE TRUNCATE ON assistant_rate_limits
  FOR EACH STATEMENT EXECUTE FUNCTION spa_truncate_refused();
