-- deal_events is append-only (architecture §1.5, same as leasing lease_events): refuse UPDATE, DELETE and TRUNCATE.
-- Demo reset drops the schema instead.
CREATE OR REPLACE FUNCTION deal_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'deal_events is append-only (% refused)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER deal_events_no_update_delete
  BEFORE UPDATE OR DELETE ON deal_events
  FOR EACH ROW EXECUTE FUNCTION deal_events_append_only();
--> statement-breakpoint
CREATE TRIGGER deal_events_no_truncate
  BEFORE TRUNCATE ON deal_events
  FOR EACH STATEMENT EXECUTE FUNCTION deal_events_append_only();
