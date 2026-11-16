-- D68: one active rule per scope. Before D68 several active rules could cover the same units with the same scope
-- (company, category, emirate, community, types); only the newest was ever used ("newest wins"). The older ones are
-- deactivated so the new overlap check (422 rule_overlap) never trips over them. Matching does not change.
UPDATE "rent_rules" a SET "active" = false
WHERE a."active" AND EXISTS (
  SELECT 1 FROM "rent_rules" b
  WHERE b."active" AND b."id" <> a."id"
    AND b."company_id" = a."company_id" AND b."category" = a."category" AND b."emirate" = a."emirate"
    AND b."community" IS NOT DISTINCT FROM a."community" AND b."subtypes" = a."subtypes"
    AND (b."created_at", b."id") > (a."created_at", a."id")
);
--> statement-breakpoint
UPDATE "contract_rules" a SET "active" = false
WHERE a."active" AND EXISTS (
  SELECT 1 FROM "contract_rules" b
  WHERE b."active" AND b."id" <> a."id"
    AND b."company_id" = a."company_id" AND b."category" = a."category"
    AND b."emirate" IS NOT DISTINCT FROM a."emirate" AND b."subtypes" = a."subtypes"
    AND (b."created_at", b."id") > (a."created_at", a."id")
);
