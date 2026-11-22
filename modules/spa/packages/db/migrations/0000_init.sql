CREATE TABLE "spa_demo_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"clock_offset_ms" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spa_demo_settings_one_row" CHECK ("spa_demo_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "spa_users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"password_hash" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spa_users_email_unique" UNIQUE("email"),
	CONSTRAINT "spa_users_role" CHECK (role in ('sales_officer', 'sales_manager', 'sales_admin', 'legal', 'compliance_officer', 'mlro', 'finance', 'admin')),
	CONSTRAINT "spa_users_email_lower" CHECK ("spa_users"."email" = lower("spa_users"."email"))
);
