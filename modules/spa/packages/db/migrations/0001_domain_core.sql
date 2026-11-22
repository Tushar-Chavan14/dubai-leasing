CREATE SEQUENCE "public"."spa_deal_ref_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "deal_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_kind" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"type" text NOT NULL,
	"from_state" text,
	"to_state" text,
	"actor" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rules_version" text,
	"at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ref" text DEFAULT 'D-' || lpad(nextval('spa_deal_ref_seq')::text, 4, '0') NOT NULL,
	"deal_type" text NOT NULL,
	"seller_mortgage" boolean DEFAULT false NOT NULL,
	"buyer_mortgage" boolean DEFAULT false NOT NULL,
	"plan_taken_over" boolean DEFAULT false NOT NULL,
	"unit_id" uuid,
	"listing_id" uuid,
	"price_fils" bigint NOT NULL,
	"state" text DEFAULT 'OFFER_AGREED' NOT NULL,
	"rules_version" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deals_ref_unique" UNIQUE("ref"),
	CONSTRAINT "deals_one_property" CHECK (("deals"."deal_type" = 'primary_offplan' and "deals"."unit_id" is not null and "deals"."listing_id" is null) or ("deals"."deal_type" <> 'primary_offplan' and "deals"."listing_id" is not null and "deals"."unit_id" is null)),
	CONSTRAINT "deals_plan_offplan_resale" CHECK (not "deals"."plan_taken_over" or "deals"."deal_type" = 'resale_offplan')
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ref" text NOT NULL,
	"state" text DEFAULT 'DRAFT' NOT NULL,
	"asking_price_fils" bigint,
	"permit_no" text,
	"permit_expires_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listings_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "spa_approvals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"gate" text NOT NULL,
	"entity_kind" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"dedupe_key" text NOT NULL,
	"title" text NOT NULL,
	"proposal" jsonb NOT NULL,
	"reasons" text[] DEFAULT '{}'::text[] NOT NULL,
	"rules_version" text,
	"approver_role" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"outcome" text,
	"proposed_by" text NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"edited_proposal" jsonb,
	"consumed_by_event_id" uuid,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"state" text DEFAULT 'AVAILABLE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "units_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spa_approvals" ADD CONSTRAINT "spa_approvals_decided_by_spa_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."spa_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deal_events_entity_idx" ON "deal_events" USING btree ("entity_kind","entity_id","at");--> statement-breakpoint
CREATE INDEX "spa_approvals_status_idx" ON "spa_approvals" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "spa_approvals_entity_idx" ON "spa_approvals" USING btree ("entity_kind","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "spa_approvals_dedupe_uq" ON "spa_approvals" USING btree ("dedupe_key");