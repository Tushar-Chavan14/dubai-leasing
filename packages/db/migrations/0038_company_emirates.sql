ALTER TABLE "companies" ADD COLUMN "emirates" text[] DEFAULT '{dubai}' NOT NULL;--> statement-breakpoint
UPDATE "companies" c SET "emirates" = u.e
FROM (SELECT "company_id", array_agg(DISTINCT "emirate" ORDER BY "emirate") AS e FROM "units" GROUP BY "company_id") u
WHERE u."company_id" = c."id";
