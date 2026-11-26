CREATE TABLE "contract_change_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ref" text NOT NULL,
	"lease_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"signer_id" uuid NOT NULL,
	"role" text NOT NULL,
	"party_id" uuid NOT NULL,
	"target" text NOT NULL,
	"text" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"analysis" jsonb,
	"helper_run_id" uuid,
	"inbound_event_id" uuid,
	"new_contract_id" uuid,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contract_change_requests" ADD CONSTRAINT "contract_change_requests_lease_id_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."leases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_change_requests" ADD CONSTRAINT "contract_change_requests_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_change_requests" ADD CONSTRAINT "contract_change_requests_signer_id_contract_signers_id_fk" FOREIGN KEY ("signer_id") REFERENCES "public"."contract_signers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_change_requests" ADD CONSTRAINT "contract_change_requests_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_change_requests_lease_idx" ON "contract_change_requests" USING btree ("lease_id","created_at");--> statement-breakpoint
CREATE INDEX "contract_change_requests_contract_idx" ON "contract_change_requests" USING btree ("contract_id","status");