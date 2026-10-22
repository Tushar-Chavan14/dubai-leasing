CREATE TABLE "action_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"purpose" text NOT NULL,
	"entity_kind" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"party_id" uuid,
	"outbound_message_id" uuid,
	"single_use" boolean NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "action_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "inbound_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ref" text NOT NULL,
	"type" text NOT NULL,
	"entity_kind" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"actor" text NOT NULL,
	"link_id" uuid,
	"dedupe_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"result" jsonb,
	"received_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "inbound_events_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "outbound_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_kind" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"milestone" text NOT NULL,
	"to" text NOT NULL,
	"intended_to" text NOT NULL,
	"template" text NOT NULL,
	"subject" text NOT NULL,
	"body_sha256" text,
	"attachment_sha256s" text[] DEFAULT '{}'::text[] NOT NULL,
	"document_id" uuid,
	"approval_id" uuid,
	"status" text DEFAULT 'sending' NOT NULL,
	"message_id" text,
	"smtp_response" text,
	"preview_url" text,
	"error" text,
	"sent_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"event_id" uuid,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sri_averages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community" text NOT NULL,
	"bedrooms" smallint NOT NULL,
	"avg_annual_rent_fils" bigint NOT NULL,
	"source" text NOT NULL,
	"effective_from" date NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sri_overrides" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lease_id" uuid NOT NULL,
	"avg_annual_rent_fils" bigint NOT NULL,
	"reason" text NOT NULL,
	"entered_by" text NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "action_links" ADD CONSTRAINT "action_links_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sri_overrides" ADD CONSTRAINT "sri_overrides_lease_id_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."leases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "action_links_entity_idx" ON "action_links" USING btree ("entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_events_dedupe_uq" ON "inbound_events" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "inbound_events_entity_idx" ON "inbound_events" USING btree ("entity_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "outbound_messages_uq" ON "outbound_messages" USING btree ("entity_id","purpose","milestone");--> statement-breakpoint
CREATE INDEX "outbound_messages_entity_idx" ON "outbound_messages" USING btree ("entity_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sri_averages_uq" ON "sri_averages" USING btree ("community","bedrooms","effective_from");--> statement-breakpoint
CREATE INDEX "sri_overrides_lease_idx" ON "sri_overrides" USING btree ("lease_id","at");