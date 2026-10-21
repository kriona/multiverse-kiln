CREATE TYPE "public"."sf1e_ability" AS ENUM('strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma');--> statement-breakpoint
CREATE TYPE "public"."sf1e_size" AS ENUM('fine', 'diminutive', 'tiny', 'small', 'medium', 'large', 'huge', 'gargantuan', 'colossal');--> statement-breakpoint
-- A value added with ADD VALUE can't be used until its transaction commits, and the migrations run in
-- one transaction, so the next migration couldn't add the sf1e defaults. The columns move to a new type
-- holding both values instead, which can be used straight away
ALTER TYPE "public"."ruleset" RENAME TO "ruleset_old";--> statement-breakpoint
CREATE TYPE "public"."ruleset" AS ENUM('pf1e', 'sf1e');--> statement-breakpoint
ALTER TABLE "universes" ALTER COLUMN "ruleset" SET DATA TYPE "public"."ruleset" USING "ruleset"::text::"public"."ruleset";--> statement-breakpoint
ALTER TABLE "tiles" ALTER COLUMN "ruleset" SET DATA TYPE "public"."ruleset" USING "ruleset"::text::"public"."ruleset";--> statement-breakpoint
ALTER TABLE "items" ALTER COLUMN "ruleset" SET DATA TYPE "public"."ruleset" USING "ruleset"::text::"public"."ruleset";--> statement-breakpoint
ALTER TABLE "races" ALTER COLUMN "ruleset" SET DATA TYPE "public"."ruleset" USING "ruleset"::text::"public"."ruleset";--> statement-breakpoint
ALTER TABLE "classes" ALTER COLUMN "ruleset" SET DATA TYPE "public"."ruleset" USING "ruleset"::text::"public"."ruleset";--> statement-breakpoint
DROP TYPE "public"."ruleset_old";--> statement-breakpoint
CREATE TABLE "sf1e_characters" (
	"character_id" uuid PRIMARY KEY NOT NULL,
	"theme_id" integer NOT NULL,
	"strength" smallint NOT NULL,
	"dexterity" smallint NOT NULL,
	"constitution" smallint NOT NULL,
	"intelligence" smallint NOT NULL,
	"wisdom" smallint NOT NULL,
	"charisma" smallint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sf1e_classes" (
	"class_id" integer PRIMARY KEY NOT NULL,
	"key_ability" "sf1e_ability" NOT NULL,
	"hit_points" smallint NOT NULL,
	"stamina_points" smallint NOT NULL,
	CONSTRAINT "sf1e_classes_points_range" CHECK ("sf1e_classes"."hit_points" BETWEEN 0 AND 99 AND "sf1e_classes"."stamina_points" BETWEEN 0 AND 99)
);
--> statement-breakpoint
CREATE TABLE "sf1e_races" (
	"race_id" integer PRIMARY KEY NOT NULL,
	"strength_modifier" smallint DEFAULT 0 NOT NULL,
	"dexterity_modifier" smallint DEFAULT 0 NOT NULL,
	"constitution_modifier" smallint DEFAULT 0 NOT NULL,
	"intelligence_modifier" smallint DEFAULT 0 NOT NULL,
	"wisdom_modifier" smallint DEFAULT 0 NOT NULL,
	"charisma_modifier" smallint DEFAULT 0 NOT NULL,
	"floating_bonus" boolean DEFAULT false NOT NULL,
	"darkvision" boolean DEFAULT false NOT NULL,
	"size" "sf1e_size" DEFAULT 'medium' NOT NULL,
	"hit_points" smallint NOT NULL,
	CONSTRAINT "sf1e_races_modifiers_range" CHECK ("sf1e_races"."strength_modifier" BETWEEN -99 AND 99 AND "sf1e_races"."dexterity_modifier" BETWEEN -99 AND 99 AND "sf1e_races"."constitution_modifier" BETWEEN -99 AND 99 AND "sf1e_races"."intelligence_modifier" BETWEEN -99 AND 99 AND "sf1e_races"."wisdom_modifier" BETWEEN -99 AND 99 AND "sf1e_races"."charisma_modifier" BETWEEN -99 AND 99),
	CONSTRAINT "sf1e_races_hit_points_range" CHECK ("sf1e_races"."hit_points" BETWEEN 0 AND 99)
);
--> statement-breakpoint
CREATE TABLE "sf1e_settings" (
	"universe_id" uuid PRIMARY KEY NOT NULL,
	"ability_points" smallint DEFAULT 10 NOT NULL,
	"needs_sleep" boolean DEFAULT false NOT NULL,
	"tracks_ammo" boolean DEFAULT false NOT NULL,
	CONSTRAINT "sf1e_settings_ability_points_range" CHECK ("sf1e_settings"."ability_points" BETWEEN 0 AND 48)
);
--> statement-breakpoint
CREATE TABLE "sf1e_themes" (
	"theme_id" integer PRIMARY KEY NOT NULL,
	"ability" "sf1e_ability" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "themes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "themes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"ruleset" "ruleset" NOT NULL,
	"universe_id" uuid,
	"key" text,
	"overrides_theme_id" integer,
	"name" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "themes_ruleset_key_unique" UNIQUE("ruleset","key"),
	CONSTRAINT "themes_universe_overrides_unique" UNIQUE("universe_id","overrides_theme_id"),
	CONSTRAINT "themes_overrides_belong_to_universe" CHECK ("themes"."overrides_theme_id" IS NULL OR "themes"."universe_id" IS NOT NULL),
	CONSTRAINT "themes_name_required" CHECK ("themes"."name" IS NOT NULL OR "themes"."overrides_theme_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "credits" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "starting_credits" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "races" ADD COLUMN "starting_credits" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "universes" ADD COLUMN "starting_credits" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sf1e_characters" ADD CONSTRAINT "sf1e_characters_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sf1e_characters" ADD CONSTRAINT "sf1e_characters_theme_id_themes_id_fk" FOREIGN KEY ("theme_id") REFERENCES "public"."themes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sf1e_classes" ADD CONSTRAINT "sf1e_classes_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sf1e_races" ADD CONSTRAINT "sf1e_races_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sf1e_settings" ADD CONSTRAINT "sf1e_settings_universe_id_universes_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sf1e_themes" ADD CONSTRAINT "sf1e_themes_theme_id_themes_id_fk" FOREIGN KEY ("theme_id") REFERENCES "public"."themes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "themes" ADD CONSTRAINT "themes_universe_id_universes_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "themes" ADD CONSTRAINT "themes_overrides_theme_id_themes_id_fk" FOREIGN KEY ("overrides_theme_id") REFERENCES "public"."themes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sf1e_characters_theme_id_index" ON "sf1e_characters" USING btree ("theme_id");--> statement-breakpoint
CREATE INDEX "themes_universe_id_index" ON "themes" USING btree ("universe_id");--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_credits_range" CHECK ("characters"."credits" BETWEEN 0 AND 1000000000);--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_starting_credits_range" CHECK ("classes"."starting_credits" BETWEEN 0 AND 1000000000);--> statement-breakpoint
ALTER TABLE "races" ADD CONSTRAINT "races_starting_credits_range" CHECK ("races"."starting_credits" BETWEEN 0 AND 1000000000);--> statement-breakpoint
ALTER TABLE "universes" ADD CONSTRAINT "universes_starting_credits_range" CHECK ("universes"."starting_credits" BETWEEN 0 AND 1000000000);