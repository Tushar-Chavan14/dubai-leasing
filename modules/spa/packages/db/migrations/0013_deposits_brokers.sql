CREATE TABLE "deal_brokers" (
	"deal_id" uuid NOT NULL,
	"side" text NOT NULL,
	"agency_party_id" uuid NOT NULL,
	"agent_name" text NOT NULL,
	"orn" text NOT NULL,
	"brn" text NOT NULL,
	"commission_bps" integer NOT NULL,
	"payer" text NOT NULL,
	CONSTRAINT "deal_brokers_deal_id_side_pk" PRIMARY KEY("deal_id","side"),
	CONSTRAINT "deal_brokers_side" CHECK ("side" in ('seller', 'buyer')),
	CONSTRAINT "deal_brokers_payer" CHECK ("payer" in ('seller', 'buyer')),
	CONSTRAINT "deal_brokers_commission" CHECK ("deal_brokers"."commission_bps" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "deposits" (
	"deal_id" uuid PRIMARY KEY NOT NULL,
	"amount_fils" bigint NOT NULL,
	"cheque_last4" text NOT NULL,
	"bank" text NOT NULL,
	"cheque_on" date NOT NULL,
	"holder" text NOT NULL,
	"status" text DEFAULT 'held' NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "deposits_status" CHECK ("status" in ('held', 'handed_to_seller', 'returned_to_buyer')),
	CONSTRAINT "deposits_amount_positive" CHECK ("deposits"."amount_fils" > 0)
);
--> statement-breakpoint
ALTER TABLE "deal_brokers" ADD CONSTRAINT "deal_brokers_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_brokers" ADD CONSTRAINT "deal_brokers_agency_party_id_parties_id_fk" FOREIGN KEY ("agency_party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;