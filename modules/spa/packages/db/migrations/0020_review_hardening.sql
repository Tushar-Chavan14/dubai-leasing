-- C7–C13 compliance review: the database holds what the Manager promises (S39, S40, S41, S45).

-- Offers: terms, identity and author fixed; a deal is attached once, when SENT -> ACCEPTED; never deleted.
CREATE OR REPLACE FUNCTION offers_terms_fixed() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'offers: an offer is never deleted';
  END IF;
  IF NEW.id <> OLD.id
     OR NEW.price_fils IS DISTINCT FROM OLD.price_fils
     OR NEW.listing_id IS DISTINCT FROM OLD.listing_id
     OR NEW.buyer_mortgage IS DISTINCT FROM OLD.buyer_mortgage
     OR NEW.target_transfer_on IS DISTINCT FROM OLD.target_transfer_on
     OR NEW.conditions IS DISTINCT FROM OLD.conditions
     OR NEW.valid_until IS DISTINCT FROM OLD.valid_until
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'offers: the terms are fixed once sent; make a new offer';
  END IF;
  IF OLD.status <> 'SENT' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.deal_id IS DISTINCT FROM OLD.deal_id) THEN
    RAISE EXCEPTION 'offers: an answered offer is final';
  END IF;
  IF NEW.deal_id IS DISTINCT FROM OLD.deal_id AND NOT (NEW.status = 'ACCEPTED' AND OLD.deal_id IS NULL) THEN
    RAISE EXCEPTION 'offers: a deal is attached only when the offer is accepted';
  END IF;
  IF NEW.status = 'ACCEPTED' AND NEW.deal_id IS NULL THEN
    RAISE EXCEPTION 'offers: an accepted offer names its deal';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS offers_terms_fixed ON offers;
--> statement-breakpoint
CREATE TRIGGER offers_terms_fixed
  BEFORE UPDATE OR DELETE ON offers
  FOR EACH ROW EXECUTE FUNCTION offers_terms_fixed();
--> statement-breakpoint

-- Offer buyers never change after sending.
CREATE OR REPLACE FUNCTION offer_parties_fixed() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'offer_parties: an offer''s buyers are fixed once sent (% refused)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER offer_parties_fixed
  BEFORE UPDATE OR DELETE ON offer_parties
  FOR EACH ROW EXECUTE FUNCTION offer_parties_fixed();
--> statement-breakpoint

-- An answer link is used once: only answer NULL -> accept|reject with its time; never deleted.
CREATE OR REPLACE FUNCTION offer_links_once() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'offer_links: a link is never deleted';
  END IF;
  IF NEW.token_hash <> OLD.token_hash OR NEW.offer_id <> OLD.offer_id OR NEW.seller_party_id <> OLD.seller_party_id
     OR OLD.answer IS NOT NULL OR NEW.answer IS NULL OR NEW.answered_at IS NULL THEN
    RAISE EXCEPTION 'offer_links: a link is answered once and then never changes';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER offer_links_once
  BEFORE UPDATE OR DELETE ON offer_links
  FOR EACH ROW EXECUTE FUNCTION offer_links_once();
--> statement-breakpoint

-- KYC configs: publishing a draft can't change what was saved.
CREATE OR REPLACE FUNCTION spa_kyc_configs_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'published' THEN
    RAISE EXCEPTION 'spa_kyc_configs: a published version is immutable (% refused)', TG_OP;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW.id <> OLD.id OR NEW.role <> OLD.role OR NEW.scope <> OLD.scope OR NEW.values <> OLD.values
     OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'spa_kyc_configs: publishing can''t change the saved draft; save a new draft';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- Deposits: only held -> handed_to_seller | returned_to_buyer, once, with its time; never deleted.
CREATE OR REPLACE FUNCTION deposits_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'deposits: a deposit is never deleted';
  END IF;
  IF NEW.deal_id <> OLD.deal_id OR NEW.amount_fils <> OLD.amount_fils OR NEW.cheque_last4 <> OLD.cheque_last4
     OR NEW.bank <> OLD.bank OR NEW.cheque_on <> OLD.cheque_on OR NEW.holder <> OLD.holder
     OR NEW.recorded_at <> OLD.recorded_at THEN
    RAISE EXCEPTION 'deposits: a recorded deposit is immutable';
  END IF;
  IF OLD.status <> 'held' OR NEW.status = 'held' OR NEW.closed_at IS NULL THEN
    RAISE EXCEPTION 'deposits: a deposit closes once (held -> handed_to_seller | returned_to_buyer)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER deposits_guard
  BEFORE UPDATE OR DELETE ON deposits
  FOR EACH ROW EXECUTE FUNCTION deposits_guard();
--> statement-breakpoint

-- Template versions: the approval link is write-once; approved only with an approved template_approval row.
CREATE OR REPLACE FUNCTION spa_template_versions_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'spa_template_versions: a version is never deleted';
  END IF;
  IF NEW.id <> OLD.id OR NEW.template_id <> OLD.template_id OR NEW.version <> OLD.version
     OR NEW.doc_id <> OLD.doc_id OR NEW.doc_hash <> OLD.doc_hash OR NEW.sections <> OLD.sections
     OR NEW.look <> OLD.look OR NEW.party_blocks <> OLD.party_blocks
     OR NEW.signature_roles <> OLD.signature_roles OR NEW.rules_version <> OLD.rules_version
     OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'spa_template_versions: the read template is immutable';
  END IF;
  IF OLD.status = 'in_review' THEN
    IF OLD.approval_id IS NOT NULL AND NEW.approval_id IS DISTINCT FROM OLD.approval_id THEN
      RAISE EXCEPTION 'spa_template_versions: the approval link is set once';
    END IF;
    IF NEW.status = 'in_review' AND NEW.decided_at IS NOT NULL THEN
      RAISE EXCEPTION 'spa_template_versions: decided_at is set by the decision';
    END IF;
    IF NEW.status IN ('approved', 'rejected') AND NEW.decided_at IS NULL THEN
      RAISE EXCEPTION 'spa_template_versions: a decision records its time';
    END IF;
    IF NEW.status = 'approved' AND NOT EXISTS (
      SELECT 1 FROM spa_approvals a
      WHERE a.id = NEW.approval_id AND a.gate = 'template_approval' AND a.status = 'approved'
        AND a.entity_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'spa_template_versions: approved only through an approved template_approval';
    END IF;
    IF NEW.status NOT IN ('in_review', 'approved', 'rejected') THEN
      RAISE EXCEPTION 'spa_template_versions: in_review -> % refused', NEW.status;
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'approved' AND NEW.status = 'retired'
     AND NEW.blanks = OLD.blanks AND NEW.checks = OLD.checks
     AND NEW.approval_id IS NOT DISTINCT FROM OLD.approval_id
     AND NEW.decided_at IS NOT DISTINCT FROM OLD.decided_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'spa_template_versions: a % version is immutable', OLD.status;
END;
$$ LANGUAGE plpgsql;
