-- C26 (S61): a stored conversation is never edited or deleted; a template assistant's proposal changes only its status
-- and apply columns, once; an enquiry is kept as written (only the mail's id may be filled in, once).
CREATE OR REPLACE FUNCTION assistant_messages_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'assistant_messages are append-only (% refused)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER assistant_messages_append_only
  BEFORE UPDATE OR DELETE ON assistant_messages
  FOR EACH ROW EXECUTE FUNCTION assistant_messages_append_only();
--> statement-breakpoint
CREATE TRIGGER assistant_messages_no_truncate
  BEFORE TRUNCATE ON assistant_messages
  FOR EACH STATEMENT EXECUTE FUNCTION assistant_messages_append_only();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION assistant_proposals_guard() RETURNS trigger AS $$
DECLARE
  col text;
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'assistant_proposals are never deleted (% refused)', TG_OP;
  END IF;
  FOREACH col IN ARRAY ARRAY['id', 'thread_id', 'kind', 'template_version_id', 'payload', 'created_at']
  LOOP
    IF (to_jsonb(NEW) -> col) IS DISTINCT FROM (to_jsonb(OLD) -> col) THEN
      RAISE EXCEPTION 'assistant_proposals: only the status and the apply columns change (% changed)', col;
    END IF;
  END LOOP;
  IF OLD.status <> 'proposed' THEN
    RAISE EXCEPTION 'assistant_proposals: a % proposal never changes again', OLD.status;
  END IF;
  IF NEW.status = 'applied' THEN
    IF NEW.applied_by IS NULL OR NEW.applied_at IS NULL THEN
      RAISE EXCEPTION 'assistant_proposals: applying records who and when';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'dismissed' THEN
    IF NEW.applied_by IS NOT NULL OR NEW.applied_at IS NOT NULL THEN
      RAISE EXCEPTION 'assistant_proposals: a dismissed proposal was not applied';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'assistant_proposals: a proposal is applied or dismissed, nothing else';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER assistant_proposals_guard
  BEFORE UPDATE OR DELETE ON assistant_proposals
  FOR EACH ROW EXECUTE FUNCTION assistant_proposals_guard();
--> statement-breakpoint
CREATE TRIGGER assistant_proposals_no_truncate
  BEFORE TRUNCATE ON assistant_proposals
  FOR EACH STATEMENT EXECUTE FUNCTION assistant_proposals_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION listing_enquiries_guard() RETURNS trigger AS $$
DECLARE
  col text;
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'listing_enquiries are never deleted (% refused)', TG_OP;
  END IF;
  FOREACH col IN ARRAY ARRAY['id', 'listing_id', 'name', 'email', 'message', 'consent_at', 'created_at']
  LOOP
    IF (to_jsonb(NEW) -> col) IS DISTINCT FROM (to_jsonb(OLD) -> col) THEN
      RAISE EXCEPTION 'listing_enquiries are kept as written (% changed)', col;
    END IF;
  END LOOP;
  IF OLD.outbound_message_id IS NOT NULL AND NEW.outbound_message_id IS DISTINCT FROM OLD.outbound_message_id THEN
    RAISE EXCEPTION 'listing_enquiries: the mail id is set once';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER listing_enquiries_guard
  BEFORE UPDATE OR DELETE ON listing_enquiries
  FOR EACH ROW EXECUTE FUNCTION listing_enquiries_guard();
--> statement-breakpoint
CREATE TRIGGER listing_enquiries_no_truncate
  BEFORE TRUNCATE ON listing_enquiries
  FOR EACH STATEMENT EXECUTE FUNCTION listing_enquiries_guard();
