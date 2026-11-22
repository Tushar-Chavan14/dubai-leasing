-- C13 (S45): a template version changes only while in review (blank remaps, checks, the decision). Once decided, the
-- only change is approved -> retired. Versions are never deleted.
CREATE OR REPLACE FUNCTION spa_template_versions_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'spa_template_versions: a version is never deleted';
  END IF;
  IF NEW.id <> OLD.id OR NEW.template_id <> OLD.template_id OR NEW.version <> OLD.version
     OR NEW.doc_id <> OLD.doc_id OR NEW.doc_hash <> OLD.doc_hash OR NEW.sections <> OLD.sections
     OR NEW.look <> OLD.look OR NEW.party_blocks <> OLD.party_blocks
     OR NEW.signature_roles <> OLD.signature_roles OR NEW.rules_version <> OLD.rules_version
     OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'spa_template_versions: the read template is immutable';
  END IF;
  IF OLD.status = 'in_review' THEN
    IF NEW.status NOT IN ('in_review', 'approved', 'rejected') THEN
      RAISE EXCEPTION 'spa_template_versions: in_review -> % refused', NEW.status;
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'approved' AND NEW.status = 'retired'
     AND NEW.blanks = OLD.blanks AND NEW.checks = OLD.checks
     AND NEW.approval_id IS NOT DISTINCT FROM OLD.approval_id
     AND NEW.decided_at IS NOT DISTINCT FROM OLD.decided_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'spa_template_versions: a % version is immutable', OLD.status;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER spa_template_versions_guard
  BEFORE UPDATE OR DELETE ON spa_template_versions
  FOR EACH ROW EXECUTE FUNCTION spa_template_versions_guard();
