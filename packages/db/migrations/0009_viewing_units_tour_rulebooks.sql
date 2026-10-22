CREATE TABLE "rulebooks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"emirate" text NOT NULL,
	"status" text NOT NULL,
	"based_on" text,
	"effective_from" date NOT NULL,
	"values" jsonb NOT NULL,
	"reference_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" text,
	"published_at" timestamp with time zone,
	CONSTRAINT "rulebooks_version_unique" UNIQUE("version")
);
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "viewing_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "viewing_outcome" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "viewing_outcome_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "virtual_tour_url" text;--> statement-breakpoint
ALTER TABLE "rulebooks" ADD CONSTRAINT "rulebooks_status_check" CHECK ("status" IN ('draft', 'published'));--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_viewing_outcome_check" CHECK ("viewing_outcome" IS NULL OR "viewing_outcome" IN ('attended', 'no_show'));--> statement-breakpoint
-- Published rulebook versions are immutable: leases and decisions pin their rulesVersion (D23).
-- Drafts may be edited, published (draft -> published) or deleted.
CREATE OR REPLACE FUNCTION rulebooks_published_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'published' THEN
    RAISE EXCEPTION 'rulebook % is published and immutable (% refused)', OLD.version, TG_OP;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER rulebooks_published_no_update_delete
  BEFORE UPDATE OR DELETE ON rulebooks
  FOR EACH ROW EXECUTE FUNCTION rulebooks_published_immutable();
