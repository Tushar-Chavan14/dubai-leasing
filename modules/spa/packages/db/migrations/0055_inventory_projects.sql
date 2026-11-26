CREATE TABLE "buildings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_list_items" (
	"price_list_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"price_fils" bigint NOT NULL,
	CONSTRAINT "price_list_items_price_list_id_unit_id_pk" PRIMARY KEY("price_list_id","unit_id"),
	CONSTRAINT "price_list_items_price_positive" CHECK ("price_list_items"."price_fils" > 0)
);
--> statement-breakpoint
CREATE TABLE "price_lists" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_lists_version" CHECK ("price_lists"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"emirate" text DEFAULT 'dubai' NOT NULL,
	"developer_company_id" uuid NOT NULL,
	"anticipated_completion_on" date,
	"template_kind" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_code_unique" UNIQUE("code"),
	CONSTRAINT "projects_template_kind" CHECK ("projects"."template_kind" is null or "projects"."template_kind" in ('spa', 'mou', 'assignment', 'listing_agreement'))
);
--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "building_id" uuid;--> statement-breakpoint
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_developer_company_id_companies_id_fk" FOREIGN KEY ("developer_company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "buildings_project_code_uq" ON "buildings" USING btree ("project_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "price_lists_project_version_uq" ON "price_lists" USING btree ("project_id","version");--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE no action ON UPDATE no action;