-- A published KYC config never changes; a draft may be edited, published once, or deleted (S41).
CREATE OR REPLACE FUNCTION spa_kyc_configs_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'published' THEN
    RAISE EXCEPTION 'spa_kyc_configs: a published version is immutable (% refused)', TG_OP;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER spa_kyc_configs_immutable
  BEFORE UPDATE OR DELETE ON spa_kyc_configs
  FOR EACH ROW EXECUTE FUNCTION spa_kyc_configs_immutable();
