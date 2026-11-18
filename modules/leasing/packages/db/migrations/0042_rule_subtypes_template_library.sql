-- D68: rules cover a list of unit types; templates are a company library valid in a list of emirates.
ALTER TABLE "contract_rules" ADD COLUMN "subtypes" text[] DEFAULT '{}'::text[] NOT NULL;
--> statement-breakpoint
UPDATE "contract_rules" SET "subtypes" = ARRAY["subtype"] WHERE "subtype" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "contract_rules" DROP COLUMN "subtype";
--> statement-breakpoint
ALTER TABLE "contract_rules" DROP COLUMN "sample_document_id";
--> statement-breakpoint
ALTER TABLE "rent_rules" ADD COLUMN "subtypes" text[] DEFAULT '{}'::text[] NOT NULL;
--> statement-breakpoint
UPDATE "rent_rules" SET "subtypes" = ARRAY["subtype"] WHERE "subtype" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "rent_rules" DROP COLUMN "subtype";
--> statement-breakpoint
ALTER TABLE "company_clauses" DROP COLUMN "contract_rule_id";
--> statement-breakpoint
ALTER TABLE "company_contract_templates" ADD COLUMN "emirates" text[] DEFAULT '{}'::text[] NOT NULL;
--> statement-breakpoint
UPDATE "company_contract_templates" SET "emirates" = ARRAY["emirate"] WHERE "emirate" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "company_contract_templates" DROP COLUMN "emirate";
--> statement-breakpoint
-- Sample documents carry the emirates chosen at upload (was one emirate or none).
UPDATE "documents"
SET "extracted" = ("extracted" - 'emirate') || jsonb_build_object(
  'emirates',
  CASE WHEN "extracted"->>'emirate' IS NULL THEN '[]'::jsonb ELSE jsonb_build_array("extracted"->>'emirate') END
)
WHERE "kind" = 'contract_sample' AND "extracted" IS NOT NULL;
