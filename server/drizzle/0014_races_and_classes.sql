CREATE TYPE "public"."pf1e_ability" AS ENUM('strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma');--> statement-breakpoint
CREATE TYPE "public"."pf1e_casting_style" AS ENUM('none', 'prepared', 'spontaneous');--> statement-breakpoint
CREATE TYPE "public"."pf1e_magic_tradition" AS ENUM('none', 'arcane', 'divine');--> statement-breakpoint
CREATE TYPE "public"."pf1e_size" AS ENUM('fine', 'diminutive', 'tiny', 'small', 'medium', 'large', 'huge', 'gargantuan', 'colossal');--> statement-breakpoint
CREATE TABLE "class_race_zones" (
	"class_id" integer NOT NULL,
	"race_id" integer NOT NULL,
	"zone_id" uuid NOT NULL,
	CONSTRAINT "class_race_zones_class_id_race_id_pk" PRIMARY KEY("class_id","race_id")
);
--> statement-breakpoint
CREATE TABLE "class_starting_items" (
	"class_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"quantity" smallint NOT NULL,
	CONSTRAINT "class_starting_items_class_id_item_id_pk" PRIMARY KEY("class_id","item_id"),
	CONSTRAINT "class_starting_items_quantity_range" CHECK ("class_starting_items"."quantity" BETWEEN 1 AND 999)
);
--> statement-breakpoint
CREATE TABLE "classes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "classes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"ruleset" "ruleset" NOT NULL,
	"universe_id" uuid,
	"key" text,
	"overrides_class_id" integer,
	"name" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"starting_platinum" integer DEFAULT 0 NOT NULL,
	"starting_gold" integer DEFAULT 0 NOT NULL,
	"starting_silver" integer DEFAULT 0 NOT NULL,
	"starting_copper" integer DEFAULT 0 NOT NULL,
	"starting_zone_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "classes_ruleset_key_unique" UNIQUE("ruleset","key"),
	CONSTRAINT "classes_universe_overrides_unique" UNIQUE("universe_id","overrides_class_id"),
	CONSTRAINT "classes_overrides_belong_to_universe" CHECK ("classes"."overrides_class_id" IS NULL OR "classes"."universe_id" IS NOT NULL),
	CONSTRAINT "classes_name_required" CHECK ("classes"."name" IS NOT NULL OR "classes"."overrides_class_id" IS NOT NULL),
	CONSTRAINT "classes_starting_coins_range" CHECK ("classes"."starting_platinum" BETWEEN 0 AND 1000000000 AND "classes"."starting_gold" BETWEEN 0 AND 1000000000 AND "classes"."starting_silver" BETWEEN 0 AND 1000000000 AND "classes"."starting_copper" BETWEEN 0 AND 1000000000)
);
--> statement-breakpoint
CREATE TABLE "pf1e_classes" (
	"class_id" integer PRIMARY KEY NOT NULL,
	"primary_ability" "pf1e_ability" NOT NULL,
	"tradition" "pf1e_magic_tradition" DEFAULT 'none' NOT NULL,
	"casting_style" "pf1e_casting_style" DEFAULT 'none' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pf1e_races" (
	"race_id" integer PRIMARY KEY NOT NULL,
	"strength_modifier" smallint DEFAULT 0 NOT NULL,
	"dexterity_modifier" smallint DEFAULT 0 NOT NULL,
	"constitution_modifier" smallint DEFAULT 0 NOT NULL,
	"intelligence_modifier" smallint DEFAULT 0 NOT NULL,
	"wisdom_modifier" smallint DEFAULT 0 NOT NULL,
	"charisma_modifier" smallint DEFAULT 0 NOT NULL,
	"floating_bonus" boolean DEFAULT false NOT NULL,
	"darkvision" boolean DEFAULT false NOT NULL,
	"size" "pf1e_size" DEFAULT 'medium' NOT NULL,
	CONSTRAINT "pf1e_races_modifiers_range" CHECK ("pf1e_races"."strength_modifier" BETWEEN -99 AND 99 AND "pf1e_races"."dexterity_modifier" BETWEEN -99 AND 99 AND "pf1e_races"."constitution_modifier" BETWEEN -99 AND 99 AND "pf1e_races"."intelligence_modifier" BETWEEN -99 AND 99 AND "pf1e_races"."wisdom_modifier" BETWEEN -99 AND 99 AND "pf1e_races"."charisma_modifier" BETWEEN -99 AND 99)
);
--> statement-breakpoint
CREATE TABLE "race_starting_items" (
	"race_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"quantity" smallint NOT NULL,
	CONSTRAINT "race_starting_items_race_id_item_id_pk" PRIMARY KEY("race_id","item_id"),
	CONSTRAINT "race_starting_items_quantity_range" CHECK ("race_starting_items"."quantity" BETWEEN 1 AND 999)
);
--> statement-breakpoint
CREATE TABLE "races" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "races_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"ruleset" "ruleset" NOT NULL,
	"universe_id" uuid,
	"key" text,
	"overrides_race_id" integer,
	"name" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"starting_platinum" integer DEFAULT 0 NOT NULL,
	"starting_gold" integer DEFAULT 0 NOT NULL,
	"starting_silver" integer DEFAULT 0 NOT NULL,
	"starting_copper" integer DEFAULT 0 NOT NULL,
	"starting_zone_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "races_ruleset_key_unique" UNIQUE("ruleset","key"),
	CONSTRAINT "races_universe_overrides_unique" UNIQUE("universe_id","overrides_race_id"),
	CONSTRAINT "races_overrides_belong_to_universe" CHECK ("races"."overrides_race_id" IS NULL OR "races"."universe_id" IS NOT NULL),
	CONSTRAINT "races_name_required" CHECK ("races"."name" IS NOT NULL OR "races"."overrides_race_id" IS NOT NULL),
	CONSTRAINT "races_starting_coins_range" CHECK ("races"."starting_platinum" BETWEEN 0 AND 1000000000 AND "races"."starting_gold" BETWEEN 0 AND 1000000000 AND "races"."starting_silver" BETWEEN 0 AND 1000000000 AND "races"."starting_copper" BETWEEN 0 AND 1000000000)
);
--> statement-breakpoint
ALTER TABLE "class_race_zones" ADD CONSTRAINT "class_race_zones_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_race_zones" ADD CONSTRAINT "class_race_zones_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_race_zones" ADD CONSTRAINT "class_race_zones_zone_id_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_starting_items" ADD CONSTRAINT "class_starting_items_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_starting_items" ADD CONSTRAINT "class_starting_items_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_universe_id_universes_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_overrides_class_id_classes_id_fk" FOREIGN KEY ("overrides_class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_starting_zone_id_zones_id_fk" FOREIGN KEY ("starting_zone_id") REFERENCES "public"."zones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pf1e_classes" ADD CONSTRAINT "pf1e_classes_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pf1e_races" ADD CONSTRAINT "pf1e_races_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_starting_items" ADD CONSTRAINT "race_starting_items_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_starting_items" ADD CONSTRAINT "race_starting_items_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "races" ADD CONSTRAINT "races_universe_id_universes_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "races" ADD CONSTRAINT "races_overrides_race_id_races_id_fk" FOREIGN KEY ("overrides_race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "races" ADD CONSTRAINT "races_starting_zone_id_zones_id_fk" FOREIGN KEY ("starting_zone_id") REFERENCES "public"."zones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "class_race_zones_race_id_index" ON "class_race_zones" USING btree ("race_id");--> statement-breakpoint
CREATE INDEX "class_race_zones_zone_id_index" ON "class_race_zones" USING btree ("zone_id");--> statement-breakpoint
CREATE INDEX "class_starting_items_item_id_index" ON "class_starting_items" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "classes_universe_id_index" ON "classes" USING btree ("universe_id");--> statement-breakpoint
CREATE INDEX "classes_starting_zone_id_index" ON "classes" USING btree ("starting_zone_id");--> statement-breakpoint
CREATE INDEX "race_starting_items_item_id_index" ON "race_starting_items" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "races_universe_id_index" ON "races" USING btree ("universe_id");--> statement-breakpoint
CREATE INDEX "races_starting_zone_id_index" ON "races" USING btree ("starting_zone_id");