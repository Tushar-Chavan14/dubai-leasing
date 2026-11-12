-- Before D56 every unit was Dubai, so a template with no emirate was a Dubai template.
UPDATE "company_contract_templates" SET "emirate" = 'dubai' WHERE "emirate" IS NULL;
