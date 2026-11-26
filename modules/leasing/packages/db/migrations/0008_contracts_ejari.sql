CREATE TABLE "contract_signers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"contract_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"role" text NOT NULL,
	"name_en" text NOT NULL,
	"email" text,
	"link_id" uuid,
	"outbound_message_id" uuid,
	"signed_at" timestamp with time zone,
	"typed_name" text,
	"ip" text,
	"user_agent" text,
	"inbound_event_id" uuid,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lease_id" uuid NOT NULL,
	"version" smallint NOT NULL,
	"status" text NOT NULL,
	"fields" jsonb NOT NULL,
	"sources" jsonb NOT NULL,
	"addendum" jsonb NOT NULL,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"input_hash" text NOT NULL,
	"helper_run_id" uuid,
	"document_id" uuid,
	"sha256" text NOT NULL,
	"approval_id" uuid,
	"signed_document_id" uuid,
	"signed_sha256" text,
	"sent_at" timestamp with time zone,
	"signed_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ejari_submissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lease_id" uuid NOT NULL,
	"approval_id" uuid NOT NULL,
	"attempt" smallint NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_sha256" text NOT NULL,
	"status" text NOT NULL,
	"tries" smallint DEFAULT 0 NOT NULL,
	"ejari_no" text,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"autofix" jsonb,
	"certificate_document_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "contract_signers" ADD CONSTRAINT "contract_signers_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_signers" ADD CONSTRAINT "contract_signers_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_lease_id_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."leases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ejari_submissions" ADD CONSTRAINT "ejari_submissions_lease_id_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."leases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contract_signers_uq" ON "contract_signers" USING btree ("contract_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "contracts_lease_version_uq" ON "contracts" USING btree ("lease_id","version");--> statement-breakpoint
CREATE INDEX "contracts_lease_idx" ON "contracts" USING btree ("lease_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ejari_submissions_attempt_uq" ON "ejari_submissions" USING btree ("approval_id","attempt");--> statement-breakpoint
CREATE INDEX "ejari_submissions_lease_idx" ON "ejari_submissions" USING btree ("lease_id","created_at");