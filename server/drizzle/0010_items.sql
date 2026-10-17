CREATE TABLE "items" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"ruleset" "ruleset" NOT NULL,
	"universe_id" uuid,
	"key" text,
	"overrides_item_id" integer,
	"name" text,
	"type" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_ruleset_key_unique" UNIQUE("ruleset","key"),
	CONSTRAINT "items_universe_overrides_unique" UNIQUE("universe_id","overrides_item_id"),
	CONSTRAINT "items_overrides_belong_to_universe" CHECK ("items"."overrides_item_id" IS NULL OR "items"."universe_id" IS NOT NULL),
	CONSTRAINT "items_name_required" CHECK ("items"."name" IS NOT NULL OR "items"."overrides_item_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_universe_id_universes_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_overrides_item_id_items_id_fk" FOREIGN KEY ("overrides_item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "items_universe_id_index" ON "items" USING btree ("universe_id");