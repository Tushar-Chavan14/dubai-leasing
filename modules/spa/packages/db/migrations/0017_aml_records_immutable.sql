-- AML policy versions and risk assessments are records: never changed or deleted (S42).
CREATE OR REPLACE FUNCTION spa_aml_records_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is immutable (% refused)', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER spa_aml_policy_immutable BEFORE UPDATE OR DELETE ON spa_aml_policy
  FOR EACH ROW EXECUTE FUNCTION spa_aml_records_immutable();
--> statement-breakpoint
CREATE TRIGGER risk_assessments_immutable BEFORE UPDATE OR DELETE ON risk_assessments
  FOR EACH ROW EXECUTE FUNCTION spa_aml_records_immutable();
