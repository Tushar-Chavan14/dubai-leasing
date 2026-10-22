-- Overrides entered before this migration have no term and are no longer used (the SRI table
-- applies instead; conservative). The engine always sets lease_end_on on new rows.
ALTER TABLE "sri_overrides" ADD COLUMN "lease_end_on" date;