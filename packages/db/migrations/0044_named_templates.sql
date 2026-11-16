-- D69: named contract templates. Each version belongs to a family (the first version's id) with a name; approving a
-- new version retires only its own family's approved version. Existing versions keep their numbers (the number is part
-- of the contract hash). Backfill: one family per (company, emirates), the oldest row's id; the company's first family
-- is "Contract template", others name their emirates.
DROP INDEX "company_contract_templates_version_uq";--> statement-breakpoint
ALTER TABLE "company_contract_templates" ADD COLUMN "family_id" uuid;--> statement-breakpoint
ALTER TABLE "company_contract_templates" ADD COLUMN "name" text;--> statement-breakpoint
WITH groups AS (
  SELECT DISTINCT ON ("company_id", "emirates") "company_id", "emirates", "id" AS "family_id", "created_at"
  FROM "company_contract_templates"
  ORDER BY "company_id", "emirates", "created_at", "id"
), named AS (
  SELECT g.*, row_number() OVER (PARTITION BY g."company_id" ORDER BY g."created_at", g."family_id") AS "n"
  FROM groups g
)
UPDATE "company_contract_templates" t
SET "family_id" = n."family_id",
  "name" = CASE
    WHEN n."n" = 1 THEN 'Contract template'
    WHEN cardinality(n."emirates") = 0 THEN 'Contract template (any emirate, ' || n."n" || ')'
    ELSE 'Contract template (' || initcap(replace(array_to_string(n."emirates", ', '), '_', ' ')) || ')'
  END
FROM named n
WHERE t."company_id" = n."company_id" AND t."emirates" = n."emirates";--> statement-breakpoint
ALTER TABLE "company_contract_templates" ALTER COLUMN "family_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "company_contract_templates" ALTER COLUMN "name" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "company_contract_templates_version_uq" ON "company_contract_templates" USING btree ("company_id","family_id","version");
