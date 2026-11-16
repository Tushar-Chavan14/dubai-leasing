UPDATE "companies" c SET "emirates" = c."emirates" || m.e
FROM (
  SELECT r."company_id", array_agg(DISTINCT r."emirate" ORDER BY r."emirate") AS e
  FROM (
    SELECT "company_id", "emirate" FROM "rent_rules" WHERE "emirate" IS NOT NULL
    UNION
    SELECT "company_id", "emirate" FROM "contract_rules" WHERE "emirate" IS NOT NULL
  ) r
  JOIN "companies" c2 ON c2."id" = r."company_id" AND NOT (r."emirate" = ANY (c2."emirates"))
  GROUP BY r."company_id"
) m
WHERE m."company_id" = c."id";
