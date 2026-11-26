CREATE SEQUENCE "public"."spa_lead_ref_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "spa_lead_messages" (
	"lead_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "spa_lead_messages_lead_id_seq_pk" PRIMARY KEY("lead_id","seq"),
	CONSTRAINT "spa_lead_messages_body" CHECK (char_length("spa_lead_messages"."body") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "spa_leads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ref" text DEFAULT 'LD-' || lpad(nextval('spa_lead_ref_seq')::text, 4, '0') NOT NULL,
	"property_kind" text NOT NULL,
	"listing_id" uuid,
	"unit_id" uuid,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"source" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"agent_user_id" uuid,
	"deal_id" uuid,
	"consent_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "spa_leads_ref_unique" UNIQUE("ref"),
	CONSTRAINT "spa_leads_property_kind" CHECK ("property_kind" in ('listing', 'unit')),
	CONSTRAINT "spa_leads_one_property" CHECK (("spa_leads"."listing_id" is not null and "spa_leads"."unit_id" is null and "spa_leads"."property_kind" = 'listing') or ("spa_leads"."unit_id" is not null and "spa_leads"."listing_id" is null and "spa_leads"."property_kind" = 'unit')),
	CONSTRAINT "spa_leads_source" CHECK ("source" in ('form', 'listing_chat', 'staff')),
	CONSTRAINT "spa_leads_status" CHECK ("status" in ('new', 'contacted', 'viewing_booked', 'interested', 'not_interested', 'converted', 'closed')),
	CONSTRAINT "spa_leads_email_lower" CHECK ("spa_leads"."email" = lower("spa_leads"."email"))
);
--> statement-breakpoint
CREATE TABLE "spa_viewings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lead_id" uuid NOT NULL,
	"listing_id" uuid,
	"unit_id" uuid,
	"agent_user_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'booked' NOT NULL,
	"outcome_note" text,
	"cancel_reason" text,
	"cancel_token_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "spa_viewings_status" CHECK ("status" in ('booked', 'cancelled', 'attended', 'no_show')),
	CONSTRAINT "spa_viewings_one_property" CHECK (("spa_viewings"."listing_id" is not null and "spa_viewings"."unit_id" is null) or ("spa_viewings"."unit_id" is not null and "spa_viewings"."listing_id" is null)),
	CONSTRAINT "spa_viewings_end_after_start" CHECK ("spa_viewings"."ends_at" > "spa_viewings"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "sales_agent_user_id" uuid;--> statement-breakpoint
ALTER TABLE "spa_lead_messages" ADD CONSTRAINT "spa_lead_messages_lead_id_spa_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."spa_leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spa_leads" ADD CONSTRAINT "spa_leads_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spa_leads" ADD CONSTRAINT "spa_leads_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spa_leads" ADD CONSTRAINT "spa_leads_agent_user_id_spa_users_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."spa_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spa_leads" ADD CONSTRAINT "spa_leads_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spa_viewings" ADD CONSTRAINT "spa_viewings_lead_id_spa_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."spa_leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spa_viewings" ADD CONSTRAINT "spa_viewings_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spa_viewings" ADD CONSTRAINT "spa_viewings_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spa_viewings" ADD CONSTRAINT "spa_viewings_agent_user_id_spa_users_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."spa_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "spa_leads_open_listing_uq" ON "spa_leads" USING btree ("email","listing_id") WHERE "spa_leads"."status" not in ('converted', 'closed') and "spa_leads"."listing_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "spa_leads_open_unit_uq" ON "spa_leads" USING btree ("email","unit_id") WHERE "spa_leads"."status" not in ('converted', 'closed') and "spa_leads"."unit_id" is not null;--> statement-breakpoint
CREATE INDEX "spa_leads_agent_idx" ON "spa_leads" USING btree ("agent_user_id","status");--> statement-breakpoint
CREATE INDEX "spa_leads_created_idx" ON "spa_leads" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "spa_viewings_agent_slot_uq" ON "spa_viewings" USING btree ("agent_user_id","starts_at") WHERE "spa_viewings"."status" = 'booked' and "spa_viewings"."agent_user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "spa_viewings_listing_slot_uq" ON "spa_viewings" USING btree ("listing_id","starts_at") WHERE "spa_viewings"."status" = 'booked' and "spa_viewings"."agent_user_id" is null and "spa_viewings"."listing_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "spa_viewings_unit_slot_uq" ON "spa_viewings" USING btree ("unit_id","starts_at") WHERE "spa_viewings"."status" = 'booked' and "spa_viewings"."agent_user_id" is null and "spa_viewings"."unit_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "spa_viewings_token_uq" ON "spa_viewings" USING btree ("cancel_token_hash");--> statement-breakpoint
CREATE INDEX "spa_viewings_lead_idx" ON "spa_viewings" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "spa_viewings_starts_idx" ON "spa_viewings" USING btree ("status","starts_at");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_sales_agent_user_id_spa_users_id_fk" FOREIGN KEY ("sales_agent_user_id") REFERENCES "public"."spa_users"("id") ON DELETE no action ON UPDATE no action;-- M5 (S79): what a visitor wrote never changes or goes. The lead row moves on; its messages stay.
CREATE OR REPLACE FUNCTION spa_lead_messages_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'spa_lead_messages is append-only (% refused)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER spa_lead_messages_no_update_delete
  BEFORE UPDATE OR DELETE ON spa_lead_messages
  FOR EACH ROW EXECUTE FUNCTION spa_lead_messages_append_only();
