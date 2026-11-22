CREATE TABLE "spa_policy" (
	"version" integer PRIMARY KEY NOT NULL,
	"values" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "policy_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_state" CHECK ("state" in ('OFFER_AGREED', 'PARTY_CHECK', 'AML_HOLD', 'AGREEMENT_DRAFT', 'LEGAL_REVIEW', 'SIGNING', 'REGISTRATION', 'NOC', 'FINANCE', 'SETTLEMENT', 'TRANSFER', 'INSTALMENTS', 'HANDED_OVER', 'COMPLETED', 'CANCELLED'));--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_price_positive" CHECK ("deals"."price_fils" > 0);--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_state" CHECK ("state" in ('DRAFT', 'VERIFIED', 'ACTIVE', 'PUBLISHED', 'UNDER_OFFER', 'SOLD', 'WITHDRAWN'));--> statement-breakpoint
ALTER TABLE "spa_approvals" ADD CONSTRAINT "spa_approvals_gate" CHECK ("gate" in ('seller_verification', 'price_out_of_range', 'kyc_review', 'aml_flag', 'aml_report', 'template_approval', 'agreement_approval', 'noc_review', 'settlement_approval', 'oqood_submission', 'transfer_submission', 'cancellation', 'deposit_release', 'edd_signoff', 'helper_review', 'refund'));--> statement-breakpoint
ALTER TABLE "spa_approvals" ADD CONSTRAINT "spa_approvals_status" CHECK ("status" in ('pending', 'approved', 'rejected', 'edited', 'cancelled'));--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_state" CHECK ("state" in ('AVAILABLE', 'HELD', 'SOLD', 'REGISTERED', 'HANDED_OVER'));