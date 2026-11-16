ALTER TABLE "companies" ADD COLUMN "categories" text[] DEFAULT '{residential,commercial,retail}' NOT NULL;
--> statement-breakpoint
UPDATE "companies" c SET "categories" = m.cats
FROM (
  SELECT u."company_id", array_agg(u."category" ORDER BY CASE u."category" WHEN 'residential' THEN 1 WHEN 'commercial' THEN 2 ELSE 3 END) AS cats
  FROM (
    SELECT "company_id", "category" FROM "units"
    UNION
    SELECT "company_id", "category" FROM "rent_rules"
    UNION
    SELECT "company_id", "category" FROM "contract_rules"
  ) u
  GROUP BY u."company_id"
) m
WHERE m."company_id" = c."id";
