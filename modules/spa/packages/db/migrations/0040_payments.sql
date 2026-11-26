CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"deal_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"document_id" uuid NOT NULL,
	"read_id" uuid NOT NULL,
	"status" text NOT NULL,
	"method" text NOT NULL,
	"amount_read_fils" bigint,
	"amount_fils" bigint,
	"paid_on" date,
	"payer_name_read" text,
	"payer_party_id" uuid,
	"account_read_masked" text,
	"into_escrow" boolean NOT NULL,
	"payer_is_buyer" boolean NOT NULL,
	"reason_code" text,
	"registered_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"confirmed_by" text,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "payments_status" CHECK ("status" in ('read', 'counted', 'not_counted', 'needs_review')),
	CONSTRAINT "payments_method" CHECK ("method" in ('transfer', 'cheque', 'cash', 'card', 'other')),
	CONSTRAINT "payments_amount_read_positive" CHECK ("payments"."amount_read_fils" is null or "payments"."amount_read_fils" > 0),
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount_fils" is null or "payments"."amount_fils" > 0),
	CONSTRAINT "payments_amount_needs_confirmer" CHECK ("payments"."amount_fils" is null or "payments"."confirmed_by" is not null),
	CONSTRAINT "payments_confirmation_pair" CHECK (("payments"."confirmed_by" is null) = ("payments"."confirmed_at" is null)),
	CONSTRAINT "payments_counted_needs_confirmation" CHECK ("payments"."status" <> 'counted' or ("payments"."amount_fils" is not null and "payments"."confirmed_by" is not null and "payments"."into_escrow"))
);
--> statement-breakpoint
CREATE TABLE "project_escrow_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_code" text NOT NULL,
	"account_holder" text NOT NULL,
	"iban" text NOT NULL,
	"bank_name" text NOT NULL,
	"entered_by" text NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "project_escrow_accounts_iban" CHECK ("project_escrow_accounts"."iban" ~ '^AE[0-9]{21}$')
);
--> statement-breakpoint
CREATE TABLE "spa_tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"deal_id" uuid,
	"kind" text NOT NULL,
	"role" text NOT NULL,
	"title" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"done_at" timestamp with time zone,
	"done_by" text,
	CONSTRAINT "spa_tasks_kind" CHECK ("kind" in ('payment_not_escrow', 'payment_review', 'confirm_amount', 'default_flagged', 'milestone_reached')),
	CONSTRAINT "spa_tasks_role" CHECK ("role" in ('sales_officer', 'sales_manager', 'sales_admin', 'legal', 'compliance_officer', 'mlro', 'finance', 'admin')),
	CONSTRAINT "spa_tasks_status" CHECK ("status" in ('open', 'done', 'cancelled')),
	CONSTRAINT "spa_tasks_done_needs_who" CHECK ("spa_tasks"."status" = 'open' or ("spa_tasks"."done_at" is not null and "spa_tasks"."done_by" is not null))
);
--> statement-breakpoint
ALTER TABLE "document_reads" DROP CONSTRAINT "document_reads_profile";--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_kind";--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "in_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "in_default_since" date;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "in_default_reason" text;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_read_id_document_reads_id_fk" FOREIGN KEY ("read_id") REFERENCES "public"."document_reads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_payer_party_id_parties_id_fk" FOREIGN KEY ("payer_party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_plan_row_fk" FOREIGN KEY ("deal_id","seq") REFERENCES "public"."payment_plan_rows"("deal_id","seq") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spa_tasks" ADD CONSTRAINT "spa_tasks_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_document_uq" ON "payments" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "payments_deal_idx" ON "payments" USING btree ("deal_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "project_escrow_accounts_current_uq" ON "project_escrow_accounts" USING btree ("project_code") WHERE "project_escrow_accounts"."superseded_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "spa_tasks_open_dedupe_uq" ON "spa_tasks" USING btree ("dedupe_key") WHERE "spa_tasks"."status" = 'open';--> statement-breakpoint
CREATE INDEX "spa_tasks_role_idx" ON "spa_tasks" USING btree ("role","status");--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_default_needs_date" CHECK (not "deals"."in_default" or "deals"."in_default_since" is not null);--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_default_reason" CHECK ("deals"."in_default_reason" is null or "deals"."in_default_reason" in ('overdue', 'withdrew', 'no_show'));--> statement-breakpoint
ALTER TABLE "document_reads" ADD CONSTRAINT "document_reads_profile" CHECK ("profile" in ('noc', 'liability_letter', 'release_letter', 'pre_approval', 'final_offer', 'sof_evidence', 'edd', 'trade_licence', 'moa', 'poa', 'board_resolution', 'title_deed', 'oqood', 'payment_receipt'));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_kind" CHECK ("kind" in ('noc', 'liability_letter', 'release_letter', 'pre_approval', 'valuation', 'final_offer', 'passport', 'emirates_id_front', 'emirates_id_back', 'visa', 'proof_of_address', 'trade_licence', 'title_deed', 'oqood', 'poa', 'board_resolution', 'memorandum', 'payment_receipt'));