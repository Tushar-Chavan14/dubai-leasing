-- A deal's pinned versions and terms never change after creation (S37, review #5).
CREATE OR REPLACE FUNCTION deals_terms_fixed() RETURNS trigger AS $$
BEGIN
  IF NEW.rules_version IS DISTINCT FROM OLD.rules_version
     OR NEW.policy_version IS DISTINCT FROM OLD.policy_version
     OR NEW.deal_type IS DISTINCT FROM OLD.deal_type
     OR NEW.price_fils IS DISTINCT FROM OLD.price_fils
     OR NEW.unit_id IS DISTINCT FROM OLD.unit_id
     OR NEW.listing_id IS DISTINCT FROM OLD.listing_id THEN
    RAISE EXCEPTION 'deals: versions, type, price and property are fixed once the deal is created';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER deals_terms_fixed
  BEFORE UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION deals_terms_fixed();
