-- C36 (S68): a copilot proposal moves once from `proposed` to confirmed, cancelled or expired, and its payload is what the
-- model proposed; a draft is never edited or deleted. Neither table can be emptied.
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
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'copilot_proposals: a proposal is confirmed, cancelled or expired, nothing else';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER copilot_proposals_guard
  BEFORE UPDATE OR DELETE ON copilot_proposals
  FOR EACH ROW EXECUTE FUNCTION copilot_proposals_guard();
--> statement-breakpoint
CREATE TRIGGER copilot_proposals_no_truncate
  BEFORE TRUNCATE ON copilot_proposals
  FOR EACH STATEMENT EXECUTE FUNCTION copilot_proposals_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION copilot_drafts_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'copilot_drafts are immutable (% refused)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER copilot_drafts_immutable
  BEFORE UPDATE OR DELETE ON copilot_drafts
  FOR EACH ROW EXECUTE FUNCTION copilot_drafts_immutable();
--> statement-breakpoint
CREATE TRIGGER copilot_drafts_no_truncate
  BEFORE TRUNCATE ON copilot_drafts
  FOR EACH STATEMENT EXECUTE FUNCTION copilot_drafts_immutable();
