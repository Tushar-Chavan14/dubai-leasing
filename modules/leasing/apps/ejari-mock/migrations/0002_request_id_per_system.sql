ALTER TABLE "ejari_mock"."submissions" DROP CONSTRAINT IF EXISTS "submissions_request_id_unique";--> statement-breakpoint
ALTER TABLE "ejari_mock"."submissions" DROP CONSTRAINT IF EXISTS "submissions_system_request_id_unique";--> statement-breakpoint
ALTER TABLE "ejari_mock"."submissions" ADD CONSTRAINT "submissions_system_request_id_unique" UNIQUE("system","request_id");
