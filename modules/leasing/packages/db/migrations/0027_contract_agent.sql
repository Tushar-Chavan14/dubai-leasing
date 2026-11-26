ALTER TABLE "company_clauses" ADD COLUMN "in_template_id" uuid;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "config_hash" text;