CREATE TABLE "bank_letters" (
	"id" uuid PRIMARY KEY NOT NULL,
	"deal_id" uuid NOT NULL,
	"side" text NOT NULL,
	"kind" text NOT NULL,
	"document_id" uuid NOT NULL,
	"issued_on" date NOT NULL,
	"valid_until" date,
	"amount_fils" bigint,
	"amount_read_fils" bigint,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"status" text DEFAULT 'current' NOT NULL,
	"entered_by" text NOT NULL,
	"entered_at" timestamp with time zone NOT NULL,
	CONSTRAINT "bank_letters_side" CHECK ("side" in ('seller', 'buyer')),
	CONSTRAINT "bank_letters_kind" CHECK (("bank_letters"."side" = 'seller' and "bank_letters"."kind" in ('liability_letter', 'release_letter')) or ("bank_letters"."side" = 'buyer' and "bank_letters"."kind" in ('pre_approval', 'valuation', 'final_offer'))),
	CONSTRAINT "bank_letters_status" CHECK ("status" in ('current', 'superseded')),
	CONSTRAINT "bank_letters_amount_confirmed" CHECK ("bank_letters"."amount_fils" is null or ("bank_letters"."confirmed_by" is not null and "bank_letters"."confirmed_at" is not null)),
	CONSTRAINT "bank_letters_amount_positive" CHECK ("bank_letters"."amount_fils" is null or "bank_letters"."amount_fils" > 0)
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"deal_id" uuid NOT NULL,
	"party_id" uuid,
	"kind" text NOT NULL,
	"file_name" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"supersedes_id" uuid,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "documents_kind" CHECK ("kind" in ('noc', 'liability_letter', 'release_letter', 'pre_approval', 'valuation', 'final_offer')),
	CONSTRAINT "documents_size" CHECK ("documents"."size_bytes" > 0)
);
--> statement-breakpoint
CREATE TABLE "noc_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"deal_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"source" text NOT NULL,
	"unit_no" text NOT NULL,
	"seller_names" text[] NOT NULL,
	"issued_on" date NOT NULL,
	"expires_on" date NOT NULL,
	"service_charges_cleared" boolean NOT NULL,
	"paid_fils" bigint,
	"paid_read_fils" bigint,
	"paid_confirmed_by" uuid,
	"status" text NOT NULL,
	"mismatches" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"entered_by" text NOT NULL,
	"entered_at" timestamp with time zone NOT NULL,
	CONSTRAINT "noc_records_source" CHECK ("source" in ('manual', 'reader')),
	CONSTRAINT "noc_records_status" CHECK ("status" in ('matched', 'review', 'superseded')),
	CONSTRAINT "noc_records_paid_confirmed" CHECK ("noc_records"."paid_fils" is null or "noc_records"."paid_confirmed_by" is not null),
	CONSTRAINT "noc_records_paid_positive" CHECK ("noc_records"."paid_fils" is null or "noc_records"."paid_fils" >= 0)
);
--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "target_transfer_on" date;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "unit_no" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "project_code" text;--> statement-breakpoint
ALTER TABLE "bank_letters" ADD CONSTRAINT "bank_letters_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_letters" ADD CONSTRAINT "bank_letters_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_letters" ADD CONSTRAINT "bank_letters_confirmed_by_spa_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."spa_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "noc_records" ADD CONSTRAINT "noc_records_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "noc_records" ADD CONSTRAINT "noc_records_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "noc_records" ADD CONSTRAINT "noc_records_paid_confirmed_by_spa_users_id_fk" FOREIGN KEY ("paid_confirmed_by") REFERENCES "public"."spa_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_letters_one_current_uq" ON "bank_letters" USING btree ("deal_id","kind") WHERE "bank_letters"."status" = 'current';--> statement-breakpoint
CREATE INDEX "documents_deal_idx" ON "documents" USING btree ("deal_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "noc_records_one_current_uq" ON "noc_records" USING btree ("deal_id") WHERE "noc_records"."status" <> 'superseded';