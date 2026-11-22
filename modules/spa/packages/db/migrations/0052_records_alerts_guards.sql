-- C23 (S62): exports and alert settings are append-only; a compliance report never changes; a retention list moves
-- forward once and nothing in it is ever deleted; an alert only gets its read time and its mail link, once each.
CREATE OR REPLACE FUNCTION records_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% are append-only (% refused)', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER exports_append_only
  BEFORE UPDATE OR DELETE ON exports
  FOR EACH ROW EXECUTE FUNCTION records_append_only();
--> statement-breakpoint
CREATE TRIGGER exports_no_truncate
  BEFORE TRUNCATE ON exports
  FOR EACH STATEMENT EXECUTE FUNCTION records_append_only();
--> statement-breakpoint
CREATE TRIGGER alert_settings_append_only
  BEFORE UPDATE OR DELETE ON alert_settings
  FOR EACH ROW EXECUTE FUNCTION records_append_only();
--> statement-breakpoint
CREATE TRIGGER alert_settings_no_truncate
  BEFORE TRUNCATE ON alert_settings
  FOR EACH STATEMENT EXECUTE FUNCTION records_append_only();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION compliance_reports_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'compliance_reports are immutable (% refused)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER compliance_reports_immutable
  BEFORE UPDATE OR DELETE ON compliance_reports
  FOR EACH ROW EXECUTE FUNCTION compliance_reports_immutable();
--> statement-breakpoint
CREATE TRIGGER compliance_reports_no_truncate
  BEFORE TRUNCATE ON compliance_reports
  FOR EACH STATEMENT EXECUTE FUNCTION compliance_reports_immutable();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION retention_reviews_guard() RETURNS trigger AS $$
DECLARE
  col text;
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION '% are never deleted (% refused)', TG_TABLE_NAME, TG_OP;
  END IF;
  IF TG_TABLE_NAME = 'retention_reviews' THEN
    FOREACH col IN ARRAY ARRAY['id', 'period', 'retention_years', 'cutoff_on', 'created_at']
    LOOP
      IF (to_jsonb(NEW) -> col) IS DISTINCT FROM (to_jsonb(OLD) -> col) THEN
        RAISE EXCEPTION 'retention_reviews: only its approval can change (% changed)', col;
      END IF;
    END LOOP;
    IF OLD.status = 'approved' THEN
      RAISE EXCEPTION 'retention_reviews: an approved list is final (status moves forward once)';
    END IF;
    IF NEW.status <> 'approved' THEN
      RAISE EXCEPTION 'retention_reviews: status moves forward once, listed to approved';
    END IF;
    RETURN NEW;
  END IF;
  FOREACH col IN ARRAY ARRAY['review_id', 'deal_id', 'ended_on']
  LOOP
    IF (to_jsonb(NEW) -> col) IS DISTINCT FROM (to_jsonb(OLD) -> col) THEN
      RAISE EXCEPTION 'retention_review_items: only its status can change (% changed)', col;
    END IF;
  END LOOP;
  IF OLD.status <> 'listed' OR NEW.status <> 'approved' THEN
    RAISE EXCEPTION 'retention_review_items: status moves forward once, listed to approved';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER retention_reviews_guard
  BEFORE UPDATE OR DELETE ON retention_reviews
  FOR EACH ROW EXECUTE FUNCTION retention_reviews_guard();
--> statement-breakpoint
CREATE TRIGGER retention_reviews_no_truncate
  BEFORE TRUNCATE ON retention_reviews
  FOR EACH STATEMENT EXECUTE FUNCTION retention_reviews_guard();
--> statement-breakpoint
CREATE TRIGGER retention_review_items_guard
  BEFORE UPDATE OR DELETE ON retention_review_items
  FOR EACH ROW EXECUTE FUNCTION retention_reviews_guard();
--> statement-breakpoint
CREATE TRIGGER retention_review_items_no_truncate
  BEFORE TRUNCATE ON retention_review_items
  FOR EACH STATEMENT EXECUTE FUNCTION retention_reviews_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION alerts_guard() RETURNS trigger AS $$
DECLARE
  col text;
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'alerts are never deleted (% refused)', TG_OP;
  END IF;
  FOREACH col IN ARRAY ARRAY['id', 'approval_id', 'level', 'user_id', 'waited_hours', 'created_at']
  LOOP
    IF (to_jsonb(NEW) -> col) IS DISTINCT FROM (to_jsonb(OLD) -> col) THEN
      RAISE EXCEPTION 'alerts: only read_at and outbound_message_id can change (% changed)', col;
    END IF;
  END LOOP;
  IF OLD.read_at IS NOT NULL AND NEW.read_at IS DISTINCT FROM OLD.read_at THEN
    RAISE EXCEPTION 'alerts: read_at is set once';
  END IF;
  IF OLD.outbound_message_id IS NOT NULL AND NEW.outbound_message_id IS DISTINCT FROM OLD.outbound_message_id THEN
    RAISE EXCEPTION 'alerts: outbound_message_id is set once';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER alerts_guard
  BEFORE UPDATE OR DELETE ON alerts
  FOR EACH ROW EXECUTE FUNCTION alerts_guard();
--> statement-breakpoint
CREATE TRIGGER alerts_no_truncate
  BEFORE TRUNCATE ON alerts
  FOR EACH STATEMENT EXECUTE FUNCTION alerts_guard();
