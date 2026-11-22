ALTER TABLE "deal_brokers" ADD COLUMN "commission_status" text DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "deal_brokers" ADD COLUMN "commission_approval_id" uuid;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "seller_mortgage" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "plan_taken_over" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "deal_brokers" ADD CONSTRAINT "deal_brokers_commission_approval_id_spa_approvals_id_fk" FOREIGN KEY ("commission_approval_id") REFERENCES "public"."spa_approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_brokers" ADD CONSTRAINT "deal_brokers_commission_status" CHECK ("commission_status" in ('approved', 'pending'));--> statement-breakpoint
-- The new offer flags are fixed with the other terms (S39).
CREATE OR REPLACE FUNCTION offers_terms_fixed() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'offers: an offer is never deleted';
  END IF;
  IF NEW.id <> OLD.id
     OR NEW.price_fils IS DISTINCT FROM OLD.price_fils
     OR NEW.listing_id IS DISTINCT FROM OLD.listing_id
     OR NEW.buyer_mortgage IS DISTINCT FROM OLD.buyer_mortgage
     OR NEW.seller_mortgage IS DISTINCT FROM OLD.seller_mortgage
     OR NEW.plan_taken_over IS DISTINCT FROM OLD.plan_taken_over
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
