ALTER TABLE "sri_averages" DROP CONSTRAINT "sri_averages_uq";--> statement-breakpoint
ALTER TABLE "sri_averages" ADD COLUMN "emirate" text DEFAULT 'dubai' NOT NULL;--> statement-breakpoint
ALTER TABLE "sri_averages" ADD CONSTRAINT "sri_averages_uq" UNIQUE NULLS NOT DISTINCT("emirate","community","category","bedrooms","effective_from");