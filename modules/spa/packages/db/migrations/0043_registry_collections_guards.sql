-- C21 (S56): what the registry helper made of a rejection and every instalment reminder are evidence. Both tables are
-- append-only; a reminder row also needs a sent mail of the same deal.
CREATE OR REPLACE FUNCTION registry_rejections_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'registry_rejections are append-only (% refused)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER registry_rejections_append_only
  BEFORE UPDATE OR DELETE ON registry_rejections
  FOR EACH ROW EXECUTE FUNCTION registry_rejections_append_only();
--> statement-breakpoint
CREATE TRIGGER registry_rejections_no_truncate
  BEFORE TRUNCATE ON registry_rejections
  FOR EACH STATEMENT EXECUTE FUNCTION registry_rejections_append_only();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION collection_reminders_guard() RETURNS trigger AS $$
DECLARE
  m outbound_messages%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO m FROM outbound_messages WHERE id = NEW.outbound_message_id;
    IF NOT FOUND OR m.status <> 'sent' OR m.entity_id <> NEW.deal_id THEN
      RAISE EXCEPTION 'collection_reminders: needs a sent mail of the same deal';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'collection_reminders are insert-only (% refused)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER collection_reminders_guard
  BEFORE INSERT OR UPDATE OR DELETE ON collection_reminders
  FOR EACH ROW EXECUTE FUNCTION collection_reminders_guard();
--> statement-breakpoint
CREATE TRIGGER collection_reminders_no_truncate
  BEFORE TRUNCATE ON collection_reminders
  FOR EACH STATEMENT EXECUTE FUNCTION collection_reminders_guard();
