CREATE SEQUENCE "public"."spa_listing_ref_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "listing_owners" (
	"listing_id" uuid NOT NULL,
	"order" integer NOT NULL,
	"name_as_on_document" text NOT NULL,
	CONSTRAINT "listing_owners_listing_id_order_pk" PRIMARY KEY("listing_id","order")
);
--> statement-breakpoint
CREATE TABLE "listing_parties" (
	"listing_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"order" integer NOT NULL,
	"share_bps" integer,
	CONSTRAINT "listing_parties_listing_id_order_pk" PRIMARY KEY("listing_id","order")
);
--> statement-breakpoint
CREATE TABLE "listing_signatures" (
	"listing_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"signed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "listing_signatures_listing_id_party_id_pk" PRIMARY KEY("listing_id","party_id")
);
--> statement-breakpoint
ALTER TABLE "listings" ALTER COLUMN "ref" SET DEFAULT 'L-' || lpad(nextval('spa_listing_ref_seq')::text, 4, '0');--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "ownership_kind" text;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "ownership_ref" text;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "ownership_matched" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "listing_owners" ADD CONSTRAINT "listing_owners_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_parties" ADD CONSTRAINT "listing_parties_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_parties" ADD CONSTRAINT "listing_parties_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_signatures" ADD CONSTRAINT "listing_signatures_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_signatures" ADD CONSTRAINT "listing_signatures_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_ownership_kind" CHECK ("listings"."ownership_kind" is null or "listings"."ownership_kind" in ('title_deed', 'oqood'));