ALTER TABLE "companies" ADD COLUMN "party_id" uuid;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "trade_licence_authority" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "rera_orn" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "registered_address" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "cheque_payee_name" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "signatory_name" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "signatory_title" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "signatory_email" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "signatory_id_kind" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "signatory_id_no" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "signatory_id_expires_on" date;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_party_id_unique" UNIQUE("party_id");
--> statement-breakpoint
-- D44: every existing company gets a legal party (kind company) from its name, licence number and email.
-- Legal details (address, signatory, ...) are completed in Settings -> Companies before a contract is prepared.
DO $$
DECLARE c RECORD; pid uuid;
BEGIN
  FOR c IN SELECT id, name, trade_licence_no, email FROM "companies" WHERE party_id IS NULL LOOP
    pid := gen_random_uuid();
    INSERT INTO "parties" (id, kind, full_name_en, email, trade_licence_no) VALUES (pid, 'company', c.name, c.email, c.trade_licence_no);
    UPDATE "companies" SET party_id = pid WHERE id = c.id;
  END LOOP;
END $$;
