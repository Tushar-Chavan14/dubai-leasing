CREATE TABLE "document_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"deal_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"kyc_role" text NOT NULL,
	"config_scope" text NOT NULL,
	"config_version" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "document_requests_role" CHECK ("kyc_role" in ('buyer_person', 'seller_person', 'company_party', 'beneficial_owner'))
);
--> statement-breakpoint
CREATE TABLE "helper_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"helper" text NOT NULL,
	"deal_id" uuid,
	"entity_kind" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"status" text NOT NULL,
	"result" jsonb NOT NULL,
	"reasons" jsonb NOT NULL,
	"model_tag" text,
	"prompt_version" text,
	"rules_version" text NOT NULL,
	"kyc_config_version" integer,
	"aml_policy_version" integer,
	"visibility" text DEFAULT 'staff' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "helper_runs_status" CHECK ("status" in ('ok', 'needs_human')),
	CONSTRAINT "helper_runs_visibility" CHECK ("visibility" in ('staff', 'compliance'))
);
--> statement-breakpoint
CREATE TABLE "kyc_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"deal_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"role" text NOT NULL,
	"config_scope" text NOT NULL,
	"config_version" integer NOT NULL,
	"status" text NOT NULL,
	"flags" jsonb NOT NULL,
	"identity" jsonb NOT NULL,
	"answers" jsonb NOT NULL,
	"valid_until" date,
	"docs_hash" text NOT NULL,
	"run_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "kyc_runs_status" CHECK ("status" in ('passed', 'review', 'blocked', 'needs_human')),
	CONSTRAINT "kyc_runs_role" CHECK ("role" in ('buyer_person', 'seller_person', 'beneficial_owner'))
);
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_kind";--> statement-breakpoint
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helper_runs" ADD CONSTRAINT "helper_runs_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_runs" ADD CONSTRAINT "kyc_runs_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_runs" ADD CONSTRAINT "kyc_runs_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_runs" ADD CONSTRAINT "kyc_runs_run_id_helper_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."helper_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_requests_deal_party_uq" ON "document_requests" USING btree ("deal_id","party_id");--> statement-breakpoint
CREATE INDEX "helper_runs_entity_idx" ON "helper_runs" USING btree ("entity_kind","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "kyc_runs_party_idx" ON "kyc_runs" USING btree ("deal_id","party_id","created_at");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_kind" CHECK ("kind" in ('noc', 'liability_letter', 'release_letter', 'pre_approval', 'valuation', 'final_offer', 'passport', 'emirates_id_front', 'emirates_id_back', 'visa', 'proof_of_address', 'trade_licence', 'title_deed', 'oqood', 'poa', 'board_resolution', 'memorandum'));