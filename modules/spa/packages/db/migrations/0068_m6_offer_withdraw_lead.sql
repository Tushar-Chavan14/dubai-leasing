ALTER TABLE "offers" DROP CONSTRAINT "offers_status";--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "lead_id" uuid;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_lead_id_spa_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."spa_leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_status" CHECK ("status" in ('SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'WITHDRAWN'));