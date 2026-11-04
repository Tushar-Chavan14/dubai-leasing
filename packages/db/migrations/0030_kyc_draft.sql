ALTER TABLE "company_kyc_configs" ADD COLUMN "status" text DEFAULT 'published' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_kyc_configs" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "company_kyc_configs" ADD COLUMN "published_by" text;--> statement-breakpoint
CREATE UNIQUE INDEX "company_kyc_configs_one_draft_uq" ON "company_kyc_configs" USING btree ("company_id") WHERE status = 'draft';