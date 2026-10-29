ALTER TABLE "company_contract_templates" ADD COLUMN "review" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "contract_rules" ADD COLUMN "template_id" uuid;