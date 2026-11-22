-- C28 (S54): mail evidence and signing are evidence. Only a send result changes on a mail row (once sent, never again);
-- an envelope exists only for the deal's own approved agreement and completes only when everyone signed; a signature is
-- signed in order, once, and then never changes. Nothing here is deleted or truncated.
CREATE OR REPLACE FUNCTION outbound_messages_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'sent' THEN
    RAISE EXCEPTION 'outbound_messages: a sent message is final';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.entity_kind IS DISTINCT FROM OLD.entity_kind
     OR NEW.entity_id IS DISTINCT FROM OLD.entity_id OR NEW.purpose IS DISTINCT FROM OLD.purpose
     OR NEW.milestone IS DISTINCT FROM OLD.milestone OR NEW.intended_to IS DISTINCT FROM OLD.intended_to
     OR NEW.template IS DISTINCT FROM OLD.template OR NEW.template_version IS DISTINCT FROM OLD.template_version
     OR NEW.subject IS DISTINCT FROM OLD.subject OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'outbound_messages: only the send result changes; the rest is fixed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER outbound_messages_guard
  BEFORE UPDATE ON outbound_messages
  FOR EACH ROW EXECUTE FUNCTION outbound_messages_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION signing_never_deleted() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are never deleted or truncated', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER outbound_messages_no_delete
  BEFORE DELETE ON outbound_messages
  FOR EACH ROW EXECUTE FUNCTION signing_never_deleted();
--> statement-breakpoint
CREATE TRIGGER outbound_messages_no_truncate
  BEFORE TRUNCATE ON outbound_messages
  FOR EACH STATEMENT EXECUTE FUNCTION signing_never_deleted();
--> statement-breakpoint
CREATE TRIGGER signing_envelopes_no_delete
  BEFORE DELETE ON signing_envelopes
  FOR EACH ROW EXECUTE FUNCTION signing_never_deleted();
--> statement-breakpoint
CREATE TRIGGER signing_envelopes_no_truncate
  BEFORE TRUNCATE ON signing_envelopes
  FOR EACH STATEMENT EXECUTE FUNCTION signing_never_deleted();
--> statement-breakpoint
CREATE TRIGGER signatures_no_delete
  BEFORE DELETE ON signatures
  FOR EACH ROW EXECUTE FUNCTION signing_never_deleted();
--> statement-breakpoint
CREATE TRIGGER signatures_no_truncate
  BEFORE TRUNCATE ON signatures
  FOR EACH STATEMENT EXECUTE FUNCTION signing_never_deleted();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION signing_envelopes_guard() RETURNS trigger AS $$
DECLARE
  a agreements%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO a FROM agreements WHERE id = NEW.agreement_id;
    IF NOT FOUND OR a.status <> 'approved' OR a.deal_id <> NEW.deal_id OR a.doc_hash <> NEW.doc_hash THEN
      RAISE EXCEPTION 'signing_envelopes: needs the deal''s own approved agreement with the same hash';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.deal_id IS DISTINCT FROM OLD.deal_id
     OR NEW.agreement_id IS DISTINCT FROM OLD.agreement_id OR NEW.doc_hash IS DISTINCT FROM OLD.doc_hash
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'signing_envelopes: the envelope''s content is fixed';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF OLD.status <> 'open' THEN
      RAISE EXCEPTION 'signing_envelopes: % cannot become %', OLD.status, NEW.status;
    END IF;
    IF NEW.status = 'complete' AND (
         NOT EXISTS (SELECT 1 FROM signatures WHERE envelope_id = NEW.id)
         OR EXISTS (SELECT 1 FROM signatures WHERE envelope_id = NEW.id AND signed_at IS NULL)) THEN
      RAISE EXCEPTION 'signing_envelopes: complete needs every signature signed';
    END IF;
  ELSIF OLD.status <> 'open' THEN
    RAISE EXCEPTION 'signing_envelopes: a % envelope is fixed', OLD.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER signing_envelopes_guard
  BEFORE INSERT OR UPDATE ON signing_envelopes
  FOR EACH ROW EXECUTE FUNCTION signing_envelopes_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION signatures_guard() RETURNS trigger AS $$
DECLARE
  env_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT status INTO env_status FROM signing_envelopes WHERE id = NEW.envelope_id;
    IF env_status IS DISTINCT FROM 'open' THEN
      RAISE EXCEPTION 'signatures: the envelope is not open';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.signed_at IS NOT NULL THEN
    RAISE EXCEPTION 'signatures: a signed row is immutable';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.envelope_id IS DISTINCT FROM OLD.envelope_id
     OR NEW.seq IS DISTINCT FROM OLD.seq OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.party_id IS DISTINCT FROM OLD.party_id OR NEW.name_on_agreement IS DISTINCT FROM OLD.name_on_agreement
     OR NEW.email IS DISTINCT FROM OLD.email OR NEW.anchor IS DISTINCT FROM OLD.anchor THEN
    RAISE EXCEPTION 'signatures: the signer and the line are fixed';
  END IF;
  IF OLD.link_used_at IS NOT NULL AND NEW.link_used_at IS DISTINCT FROM OLD.link_used_at THEN
    RAISE EXCEPTION 'signatures: link_used_at is set once';
  END IF;
  IF NEW.signed_at IS NOT NULL THEN
    SELECT status INTO env_status FROM signing_envelopes WHERE id = NEW.envelope_id;
    IF env_status IS DISTINCT FROM 'open' THEN
      RAISE EXCEPTION 'signatures: the envelope is not open';
    END IF;
    IF EXISTS (SELECT 1 FROM signatures WHERE envelope_id = NEW.envelope_id AND seq < NEW.seq AND signed_at IS NULL) THEN
      RAISE EXCEPTION 'signatures: signing order: an earlier signer has not signed';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER signatures_guard
  BEFORE INSERT OR UPDATE ON signatures
  FOR EACH ROW EXECUTE FUNCTION signatures_guard();
