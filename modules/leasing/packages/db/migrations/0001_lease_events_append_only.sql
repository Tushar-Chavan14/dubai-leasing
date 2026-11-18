-- Audit log is append-only: refuse UPDATE and DELETE on lease_events (AGENTS.md rule 4).
CREATE OR REPLACE FUNCTION lease_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'lease_events is append-only (% refused)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER lease_events_no_update_delete
  BEFORE UPDATE OR DELETE ON lease_events
  FOR EACH ROW EXECUTE FUNCTION lease_events_append_only();
--> statement-breakpoint
-- Singleton row for the demo clock.
INSERT INTO demo_settings (id, clock_offset_ms) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;
