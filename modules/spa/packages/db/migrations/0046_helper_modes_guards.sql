-- C24 (S59): helper settings are versions, never edited; a review hold leaves "pending" once and is never deleted.
CREATE OR REPLACE FUNCTION spa_helper_settings_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'spa_helper_settings is append-only (% refused)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER spa_helper_settings_append_only
  BEFORE UPDATE OR DELETE ON spa_helper_settings
  FOR EACH ROW EXECUTE FUNCTION spa_helper_settings_append_only();
--> statement-breakpoint
CREATE TRIGGER spa_helper_settings_no_truncate
  BEFORE TRUNCATE ON spa_helper_settings
  FOR EACH STATEMENT EXECUTE FUNCTION spa_helper_settings_append_only();
--> statement-breakpoint
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
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER helper_review_holds_guard
  BEFORE UPDATE OR DELETE ON helper_review_holds
  FOR EACH ROW EXECUTE FUNCTION helper_review_holds_guard();
--> statement-breakpoint
CREATE TRIGGER helper_review_holds_no_truncate
  BEFORE TRUNCATE ON helper_review_holds
  FOR EACH STATEMENT EXECUTE FUNCTION helper_review_holds_guard();
