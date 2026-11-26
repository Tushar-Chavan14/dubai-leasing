CREATE TABLE "spa_media" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_kind" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"path" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"caption" text,
	"sort" smallint NOT NULL,
	"uploaded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spa_media_owner_kind" CHECK ("owner_kind" in ('project', 'unit', 'listing')),
	CONSTRAINT "spa_media_caption_len" CHECK ("spa_media"."caption" is null or char_length("spa_media"."caption") <= 200)
);
--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "unit_type" text;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "bathrooms" smallint;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "floor" smallint;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "view" text;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "parking_spaces" smallint;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "furnished" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "community" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "type" text;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "bedrooms" smallint;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "bathrooms" smallint;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "internal_sqft" integer;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "balcony_sqft" integer;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "floor" smallint;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "view" text;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "parking_spaces" smallint;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "description" text;--> statement-breakpoint
CREATE UNIQUE INDEX "spa_media_owner_sha_uq" ON "spa_media" USING btree ("owner_kind","owner_id","sha256");--> statement-breakpoint
CREATE INDEX "spa_media_owner_sort_idx" ON "spa_media" USING btree ("owner_kind","owner_id","sort");--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_unit_type" CHECK ("listings"."unit_type" is null or "listings"."unit_type" in ('apartment', 'villa', 'townhouse', 'penthouse', 'office', 'retail'));--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_furnished" CHECK ("listings"."furnished" is null or "listings"."furnished" in ('unfurnished', 'semi', 'furnished'));--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_bathrooms" CHECK ("bathrooms" is null or ("bathrooms" >= 0 and "bathrooms" <= 10));--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_floor" CHECK ("floor" is null or ("floor" >= -5 and "floor" <= 200));--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_parking_spaces" CHECK ("parking_spaces" is null or ("parking_spaces" >= 0 and "parking_spaces" <= 10));--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_community_len" CHECK ("projects"."community" is null or char_length("projects"."community") <= 80);--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_location_len" CHECK ("projects"."location" is null or char_length("projects"."location") <= 120);--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_description_len" CHECK ("projects"."description" is null or char_length("projects"."description") <= 2000);--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_type" CHECK ("units"."type" is null or "units"."type" in ('apartment', 'villa', 'townhouse', 'penthouse', 'office', 'retail'));--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_bedrooms" CHECK ("bedrooms" is null or ("bedrooms" >= 0 and "bedrooms" <= 10));--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_bathrooms" CHECK ("bathrooms" is null or ("bathrooms" >= 0 and "bathrooms" <= 10));--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_internal_sqft" CHECK ("units"."internal_sqft" is null or "units"."internal_sqft" > 0);--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_balcony_sqft" CHECK ("units"."balcony_sqft" is null or "units"."balcony_sqft" >= 0);--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_floor" CHECK ("floor" is null or ("floor" >= -5 and "floor" <= 200));--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_parking_spaces" CHECK ("parking_spaces" is null or ("parking_spaces" >= 0 and "parking_spaces" <= 10));--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_view_len" CHECK ("units"."view" is null or char_length("units"."view") <= 60);--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_description_len" CHECK ("units"."description" is null or char_length("units"."description") <= 2000);