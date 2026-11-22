-- C35 (S67): a portal link's guards. Only used_at and superseded_at change, each once (null to a value); a link is never
-- deleted and the table can't be emptied.
CREATE OR REPLACE FUNCTION portal_links_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'portal_links: a link is never deleted';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.deal_id IS DISTINCT FROM OLD.deal_id
     OR NEW.party_id IS DISTINCT FROM OLD.party_id OR NEW.purpose IS DISTINCT FROM OLD.purpose
     OR NEW.token_hash IS DISTINCT FROM OLD.token_hash OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'portal_links: only used_at and superseded_at change';
  END IF;
  IF OLD.used_at IS NOT NULL AND NEW.used_at IS DISTINCT FROM OLD.used_at THEN
    RAISE EXCEPTION 'portal_links: used_at is set once';
  END IF;
  IF OLD.superseded_at IS NOT NULL AND NEW.superseded_at IS DISTINCT FROM OLD.superseded_at THEN
    RAISE EXCEPTION 'portal_links: superseded_at is set once';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER portal_links_guard
  BEFORE UPDATE OR DELETE ON portal_links
  FOR EACH ROW EXECUTE FUNCTION portal_links_guard();
--> statement-breakpoint
CREATE TRIGGER portal_links_no_truncate
  BEFORE TRUNCATE ON portal_links
  FOR EACH STATEMENT EXECUTE FUNCTION spa_truncate_refused();
