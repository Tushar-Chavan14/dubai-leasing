CREATE TABLE "portal_handoffs" (
	"jti" text PRIMARY KEY NOT NULL,
	"used_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
-- C38 (S70): append-only. A used jti is never changed or removed, and the table is never truncated.
CREATE FUNCTION portal_handoffs_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'portal_handoffs is append-only (% refused)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER portal_handoffs_no_change
  BEFORE UPDATE OR DELETE ON portal_handoffs
  FOR EACH ROW EXECUTE FUNCTION portal_handoffs_append_only();
--> statement-breakpoint
CREATE TRIGGER portal_handoffs_no_truncate
  BEFORE TRUNCATE ON portal_handoffs
  FOR EACH STATEMENT EXECUTE FUNCTION portal_handoffs_append_only();
