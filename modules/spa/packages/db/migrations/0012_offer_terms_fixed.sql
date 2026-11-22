-- An offer's terms never change: a revision is a new offer (S18, S39).
CREATE OR REPLACE FUNCTION offers_terms_fixed() RETURNS trigger AS $$
BEGIN
  IF NEW.price_fils IS DISTINCT FROM OLD.price_fils
     OR NEW.listing_id IS DISTINCT FROM OLD.listing_id
     OR NEW.buyer_mortgage IS DISTINCT FROM OLD.buyer_mortgage
     OR NEW.target_transfer_on IS DISTINCT FROM OLD.target_transfer_on
     OR NEW.conditions IS DISTINCT FROM OLD.conditions
     OR NEW.valid_until IS DISTINCT FROM OLD.valid_until THEN
    RAISE EXCEPTION 'offers: the terms are fixed once sent; make a new offer';
  END IF;
  IF OLD.status <> 'SENT' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'offers: an answered offer is final';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER offers_terms_fixed
  BEFORE UPDATE ON offers
  FOR EACH ROW EXECUTE FUNCTION offers_terms_fixed();
