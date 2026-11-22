CREATE TABLE "outbound_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_kind" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"milestone" text NOT NULL,
	"to_email" text NOT NULL,
	"intended_to" text NOT NULL,
	"template" text NOT NULL,
	"template_version" integer NOT NULL,
	"subject" text NOT NULL,
	"body_sha256" text,
	"attachment_sha256s" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'sending' NOT NULL,
	"message_id" text,
	"smtp_response" text,
	"preview_url" text,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "outbound_messages_purpose" CHECK ("purpose" in ('link', 'reminder', 'receipt', 'notice')),
	CONSTRAINT "outbound_messages_status" CHECK ("status" in ('sending', 'sent', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "signatures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"envelope_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"role" text NOT NULL,
	"party_id" uuid NOT NULL,
	"name_on_agreement" text NOT NULL,
	"email" text NOT NULL,
	"link_token_hash" text NOT NULL,
	"link_expires_at" timestamp with time zone NOT NULL,
	"link_used_at" timestamp with time zone,
	"signed_at" timestamp with time zone,
	"typed_name" text,
	"consent" boolean,
	"ip" text,
	"user_agent" text,
	"anchor" jsonb NOT NULL,
	CONSTRAINT "signatures_link_token_hash_unique" UNIQUE("link_token_hash"),
	CONSTRAINT "signatures_role" CHECK ("role" in ('purchaser', 'broker', 'seller')),
	CONSTRAINT "signatures_signed_complete" CHECK ("signatures"."signed_at" is null or ("signatures"."typed_name" is not null and "signatures"."consent" is true and "signatures"."link_used_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "signing_envelopes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"deal_id" uuid NOT NULL,
	"agreement_id" uuid NOT NULL,
	"doc_hash" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"signed_doc_hash" text,
	"storage_key" text,
	"created_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "signing_envelopes_status" CHECK ("status" in ('open', 'complete', 'superseded')),
	CONSTRAINT "signing_envelopes_complete_needs" CHECK ("signing_envelopes"."status" <> 'complete' or ("signing_envelopes"."signed_doc_hash" is not null and "signing_envelopes"."storage_key" is not null and "signing_envelopes"."completed_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_envelope_id_signing_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "public"."signing_envelopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_envelopes" ADD CONSTRAINT "signing_envelopes_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_envelopes" ADD CONSTRAINT "signing_envelopes_agreement_id_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "outbound_messages_once_uq" ON "outbound_messages" USING btree ("entity_id","purpose","milestone");--> statement-breakpoint
CREATE UNIQUE INDEX "signatures_envelope_seq_uq" ON "signatures" USING btree ("envelope_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "signing_envelopes_one_open_uq" ON "signing_envelopes" USING btree ("agreement_id") WHERE "signing_envelopes"."status" = 'open';--> statement-breakpoint
CREATE INDEX "signing_envelopes_deal_idx" ON "signing_envelopes" USING btree ("deal_id");