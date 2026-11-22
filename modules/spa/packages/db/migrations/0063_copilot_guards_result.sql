-- C36 (S68), compliance review: a cancelled or expired proposal has no result; a confirmed one is confirmed (and its event
-- written) before the effect runs, so the result is filled once afterwards and then never changes. Replaces the function of 0062.
CREATE OR REPLACE FUNCTION copilot_proposals_guard() RETURNS trigger AS $$
DECLARE
  col text;
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'copilot_proposals are never deleted (% refused)', TG_OP;
  END IF;
  FOREACH col IN ARRAY ARRAY['id', 'thread_id', 'user_id', 'kind', 'deal_id', 'payload', 'expires_at', 'created_at']
  LOOP
    IF (to_jsonb(NEW) -> col) IS DISTINCT FROM (to_jsonb(OLD) -> col) THEN
      RAISE EXCEPTION 'copilot_proposals: only the status, confirmed_at and result change (% changed)', col;
    END IF;
  END LOOP;
  IF OLD.status = 'confirmed' AND OLD.result IS NULL AND NEW.status = 'confirmed'
     AND NEW.result IS NOT NULL AND NEW.confirmed_at IS NOT DISTINCT FROM OLD.confirmed_at THEN
    RETURN NEW;
  END IF;
  IF OLD.status <> 'proposed' THEN
    RAISE EXCEPTION 'copilot_proposals: a % proposal never changes again', OLD.status;
  END IF;
  IF NEW.status = 'confirmed' THEN
    IF NEW.confirmed_at IS NULL THEN
      RAISE EXCEPTION 'copilot_proposals: confirming records confirmed_at';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IN ('cancelled', 'expired') THEN
    IF NEW.confirmed_at IS NOT NULL THEN
      RAISE EXCEPTION 'copilot_proposals: a % proposal was not confirmed', NEW.status;
    END IF;
    IF NEW.result IS NOT NULL THEN
      RAISE EXCEPTION 'copilot_proposals: a % proposal has no result', NEW.status;
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'copilot_proposals: a proposal is confirmed, cancelled or expired, nothing else';
END;
$$ LANGUAGE plpgsql;
