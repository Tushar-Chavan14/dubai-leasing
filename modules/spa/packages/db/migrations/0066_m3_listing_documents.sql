CREATE TABLE "listing_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"listing_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"file_name" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "listing_documents_kind" CHECK ("kind" in ('title_deed', 'oqood', 'listing_agreement', 'permit')),
	CONSTRAINT "listing_documents_size" CHECK ("listing_documents"."size_bytes" > 0),
	CONSTRAINT "listing_documents_sha256" CHECK ("listing_documents"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "listing_documents" ADD CONSTRAINT "listing_documents_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "listing_documents_file_uq" ON "listing_documents" USING btree ("listing_id","kind","sha256");--> statement-breakpoint
CREATE INDEX "listing_documents_listing_idx" ON "listing_documents" USING btree ("listing_id","kind");--> statement-breakpoint
-- M3 (S77): a listing's files never change or go. A correction is a new file.
CREATE OR REPLACE FUNCTION listing_documents_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'listing_documents is append-only (% refused)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER listing_documents_no_update_delete
  BEFORE UPDATE OR DELETE ON listing_documents
  FOR EACH ROW EXECUTE FUNCTION listing_documents_append_only();
--> statement-breakpoint
CREATE TRIGGER listing_documents_no_truncate
  BEFORE TRUNCATE ON listing_documents
  FOR EACH STATEMENT EXECUTE FUNCTION listing_documents_append_only();
