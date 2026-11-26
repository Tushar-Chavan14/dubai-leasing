CREATE TABLE "unit_photos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"unit_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"path" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"caption" text,
	"sort" smallint DEFAULT 0 NOT NULL,
	"uploaded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "floor" smallint;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "bathrooms" smallint;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "parking_spaces" smallint;--> statement-breakpoint
ALTER TABLE "unit_photos" ADD CONSTRAINT "unit_photos_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "unit_photos_unit_idx" ON "unit_photos" USING btree ("unit_id","sort");--> statement-breakpoint
CREATE UNIQUE INDEX "unit_photos_unit_sha_uq" ON "unit_photos" USING btree ("unit_id","sha256");