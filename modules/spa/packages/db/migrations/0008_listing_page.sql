ALTER TABLE "listings" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "community" text;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "bedrooms" integer;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "size_sqft" integer;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "permit_issued_on" date;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "agent_user_id" uuid;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_agent_user_id_spa_users_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."spa_users"("id") ON DELETE no action ON UPDATE no action;