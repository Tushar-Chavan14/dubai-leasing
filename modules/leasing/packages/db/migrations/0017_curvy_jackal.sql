-- Dropping the column first also drops its unique and foreign-key constraints (the FK name is
-- 64 characters, which Postgres truncates, so it can't be dropped by the generated name).
ALTER TABLE "conversations" DROP COLUMN "customer_account_id";--> statement-breakpoint
DROP TABLE "customer_accounts" CASCADE;--> statement-breakpoint
DROP TABLE "customer_login_codes" CASCADE;
