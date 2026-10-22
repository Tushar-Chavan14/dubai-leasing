-- Append-only also means no TRUNCATE (AGENTS.md rule 4). Demo reset drops the schema instead.
CREATE TRIGGER lease_events_no_truncate
  BEFORE TRUNCATE ON lease_events
  FOR EACH STATEMENT EXECUTE FUNCTION lease_events_append_only();
