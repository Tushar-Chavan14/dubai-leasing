CREATE TABLE "portal_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_accounts_email_unique" UNIQUE("email"),
	CONSTRAINT "portal_accounts_email_lower" CHECK ("portal_accounts"."email" = lower("portal_accounts"."email"))
);
