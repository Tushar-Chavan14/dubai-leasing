-- C25 (S60): a review of an agreement never changes; a chase template is approved once and then fixed; a chase is
-- insert-only; a pause is resumed once. Nothing is ever deleted or emptied.
CREATE OR REPLACE FUNCTION agreement_reviews_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'agreement_reviews are immutable (% refused)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER agreement_reviews_immutable
  BEFORE UPDATE OR DELETE ON agreement_reviews
  FOR EACH ROW EXECUTE FUNCTION agreement_reviews_immutable();
--> statement-breakpoint
CREATE TRIGGER agreement_reviews_no_truncate
  BEFORE TRUNCATE ON agreement_reviews
  FOR EACH STATEMENT EXECUTE FUNCTION agreement_reviews_immutable();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION chase_templates_guard() RETURNS trigger AS $$
DECLARE
  col text;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'chase_templates are never deleted (TRUNCATE refused)';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'chase_templates are never deleted';
  END IF;
  -- The text, the version and who wrote it never change, in any status.
  FOREACH col IN ARRAY ARRAY['id', 'kind', 'version', 'subject', 'body', 'created_by', 'created_at']
  LOOP
    IF (to_jsonb(NEW) -> col) IS DISTINCT FROM (to_jsonb(OLD) -> col) THEN
      IF OLD.status = 'draft' THEN
        RAISE EXCEPTION 'chase_templates: a draft can only be approved, its text is never edited (% changed)', col;
      END IF;
      RAISE EXCEPTION 'chase_templates: an approved version is immutable (% changed)', col;
    END IF;
  END LOOP;
  IF OLD.status = 'draft' THEN
    IF NEW.status <> 'approved' THEN
      RAISE EXCEPTION 'chase_templates: a draft can only be approved first';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'approved' AND NEW.status = 'retired'
     AND NEW.approved_by IS NOT DISTINCT FROM OLD.approved_by
     AND NEW.approved_at IS NOT DISTINCT FROM OLD.approved_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'chase_templates: an approved version is immutable (it can only be retired)';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER chase_templates_guard
  BEFORE UPDATE OR DELETE ON chase_templates
  FOR EACH ROW EXECUTE FUNCTION chase_templates_guard();
--> statement-breakpoint
CREATE TRIGGER chase_templates_no_truncate
  BEFORE TRUNCATE ON chase_templates
  FOR EACH STATEMENT EXECUTE FUNCTION chase_templates_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION chases_insert_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'chases are insert-only (% refused)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER chases_insert_only
  BEFORE UPDATE OR DELETE ON chases
  FOR EACH ROW EXECUTE FUNCTION chases_insert_only();
--> statement-breakpoint
CREATE TRIGGER chases_no_truncate
  BEFORE TRUNCATE ON chases
  FOR EACH STATEMENT EXECUTE FUNCTION chases_insert_only();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION chase_pauses_guard() RETURNS trigger AS $$
DECLARE
  col text;
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'chase_pauses are never deleted (% refused)', TG_OP;
  END IF;
  IF OLD.resumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'chase_pauses: a pause can only be resumed, once';
  END IF;
  FOREACH col IN ARRAY ARRAY['id', 'deal_id', 'paused_by', 'paused_at']
  LOOP
    IF (to_jsonb(NEW) -> col) IS DISTINCT FROM (to_jsonb(OLD) -> col) THEN
      RAISE EXCEPTION 'chase_pauses: a pause can only be resumed, % can''t be changed', col;
    END IF;
  END LOOP;
  IF NEW.resumed_at IS NULL THEN
    RAISE EXCEPTION 'chase_pauses: a pause can only be resumed, not reopened';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER chase_pauses_guard
  BEFORE UPDATE OR DELETE ON chase_pauses
  FOR EACH ROW EXECUTE FUNCTION chase_pauses_guard();
--> statement-breakpoint
CREATE TRIGGER chase_pauses_no_truncate
  BEFORE TRUNCATE ON chase_pauses
  FOR EACH STATEMENT EXECUTE FUNCTION chase_pauses_guard();
