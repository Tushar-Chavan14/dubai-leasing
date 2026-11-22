CREATE TABLE "offer_links" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"offer_id" uuid NOT NULL,
	"seller_party_id" uuid NOT NULL,
	"answer" text,
	"answered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "offer_parties" (
	"offer_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"order" integer NOT NULL,
	"share_bps" integer,
	CONSTRAINT "offer_parties_offer_id_order_pk" PRIMARY KEY("offer_id","order")
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"listing_id" uuid NOT NULL,
	"status" text DEFAULT 'SENT' NOT NULL,
	"price_fils" bigint NOT NULL,
	"buyer_mortgage" boolean NOT NULL,
	"target_transfer_on" date,
	"conditions" text,
	"valid_until" date NOT NULL,
	"deal_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "offers_status" CHECK ("status" in ('SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED')),
	CONSTRAINT "offers_price_positive" CHECK ("offers"."price_fils" > 0)
);
--> statement-breakpoint
ALTER TABLE "offer_links" ADD CONSTRAINT "offer_links_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_links" ADD CONSTRAINT "offer_links_seller_party_id_parties_id_fk" FOREIGN KEY ("seller_party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_parties" ADD CONSTRAINT "offer_parties_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_parties" ADD CONSTRAINT "offer_parties_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "offers_one_open_uq" ON "offers" USING btree ("listing_id") WHERE "offers"."status" = 'SENT';