-- Every area must now be in a region, with its settings worked out from them, so the areas go: no universe
-- holds real data yet, and the seed script rebuilds the sample universe. Deleting them clears the lobby and
-- starting areas, races' and classes' starting areas, groups' starting areas and saved positions, and what
-- groups have seen of them (their foreign keys), and with them the translations and notes of their names
UPDATE "group_members" SET "column" = NULL, "row" = NULL;--> statement-breakpoint
DELETE FROM "universe_translations" WHERE "kind" = 'area';--> statement-breakpoint
DELETE FROM "universe_translator_notes" WHERE "kind" = 'area';--> statement-breakpoint
DELETE FROM "areas";--> statement-breakpoint
CREATE TABLE "area_regions" (
	"area_id" uuid NOT NULL,
	"region_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "area_regions_area_id_region_id_pk" PRIMARY KEY("area_id","region_id")
);
--> statement-breakpoint
CREATE TABLE "region_assignments" (
	"region_id" uuid NOT NULL,
	"universe_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "region_assignments_region_id_player_id_pk" PRIMARY KEY("region_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "region_parents" (
	"region_id" uuid NOT NULL,
	"parent_region_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "region_parents_region_id_parent_region_id_pk" PRIMARY KEY("region_id","parent_region_id"),
	CONSTRAINT "region_parents_not_itself" CHECK ("region_parents"."region_id" <> "region_parents"."parent_region_id")
);
--> statement-breakpoint
CREATE TABLE "regions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"universe_id" uuid NOT NULL,
	"draft" boolean DEFAULT false NOT NULL,
	"origin_id" uuid,
	"name" text NOT NULL,
	"enabled" boolean,
	"indoors" boolean,
	"light_level" "area_light_level",
	"default_tile_id" integer,
	"passage_of_time" "passage_of_time",
	"faerie_morning" "faerie_morning",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "regions_origin_in_draft" CHECK ("regions"."origin_id" IS NULL OR "regions"."draft"),
	CONSTRAINT "regions_draft_belongs_to_universe" CHECK (NOT "regions"."draft" OR "regions"."universe_id" IS NOT NULL),
	CONSTRAINT "regions_name_length" CHECK (char_length("regions"."name") BETWEEN 1 AND 60),
	CONSTRAINT "regions_faerie_morning_set" CHECK (("regions"."passage_of_time" IS NOT DISTINCT FROM 'faerie') = ("regions"."faerie_morning" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "areas" DROP CONSTRAINT "areas_faerie_morning_set";--> statement-breakpoint
ALTER TABLE "areas" DROP CONSTRAINT "areas_faerie_does_not_loop";--> statement-breakpoint
ALTER TABLE "universe_drafts" DROP CONSTRAINT "universe_drafts_faerie_morning_set";--> statement-breakpoint
ALTER TABLE "universes" DROP CONSTRAINT "universes_faerie_morning_set";--> statement-breakpoint
ALTER TABLE "areas" ALTER COLUMN "enabled" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "areas" ALTER COLUMN "enabled" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "areas" ALTER COLUMN "indoors" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "areas" ALTER COLUMN "light_level" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "areas" ALTER COLUMN "light_level" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "areas" ALTER COLUMN "default_tile_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "areas" ALTER COLUMN "passage_of_time" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "areas" ALTER COLUMN "passage_of_time" SET DATA TYPE "public"."passage_of_time" USING "passage_of_time"::text::"public"."passage_of_time";--> statement-breakpoint
ALTER TABLE "areas" ALTER COLUMN "passage_of_time" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "areas" ADD COLUMN "parent_area_added_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "areas" ADD COLUMN "resolved_enabled" boolean NOT NULL;--> statement-breakpoint
ALTER TABLE "areas" ADD COLUMN "resolved_indoors" boolean NOT NULL;--> statement-breakpoint
ALTER TABLE "areas" ADD COLUMN "resolved_light_level" "area_light_level";--> statement-breakpoint
ALTER TABLE "areas" ADD COLUMN "resolved_default_tile_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "areas" ADD COLUMN "resolved_passage_of_time" "passage_of_time";--> statement-breakpoint
ALTER TABLE "areas" ADD COLUMN "resolved_faerie_morning" "faerie_morning";--> statement-breakpoint
ALTER TABLE "universe_editors" ADD COLUMN "can_edit_tiles" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "universe_editors" ADD COLUMN "can_edit_items" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "universe_editors" ADD COLUMN "can_edit_mobs" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "area_regions" ADD CONSTRAINT "area_regions_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "area_regions" ADD CONSTRAINT "area_regions_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "region_assignments" ADD CONSTRAINT "region_assignments_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "region_assignments" ADD CONSTRAINT "region_assignments_editor_fk" FOREIGN KEY ("universe_id","player_id") REFERENCES "public"."universe_editors"("universe_id","player_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "region_parents" ADD CONSTRAINT "region_parents_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "region_parents" ADD CONSTRAINT "region_parents_parent_region_id_regions_id_fk" FOREIGN KEY ("parent_region_id") REFERENCES "public"."regions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regions" ADD CONSTRAINT "regions_universe_id_universes_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regions" ADD CONSTRAINT "regions_origin_id_regions_id_fk" FOREIGN KEY ("origin_id") REFERENCES "public"."regions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regions" ADD CONSTRAINT "regions_default_tile_id_tiles_id_fk" FOREIGN KEY ("default_tile_id") REFERENCES "public"."tiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "area_regions_region_id_index" ON "area_regions" USING btree ("region_id");--> statement-breakpoint
CREATE INDEX "region_assignments_editor_index" ON "region_assignments" USING btree ("universe_id","player_id");--> statement-breakpoint
CREATE INDEX "region_parents_parent_region_id_index" ON "region_parents" USING btree ("parent_region_id");--> statement-breakpoint
CREATE INDEX "regions_universe_id_index" ON "regions" USING btree ("universe_id");--> statement-breakpoint
CREATE INDEX "regions_default_tile_id_index" ON "regions" USING btree ("default_tile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "regions_name_unique" ON "regions" USING btree ("universe_id","draft",lower("name"));--> statement-breakpoint
CREATE INDEX "regions_origin_id_index" ON "regions" USING btree ("origin_id");--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_resolved_default_tile_id_tiles_id_fk" FOREIGN KEY ("resolved_default_tile_id") REFERENCES "public"."tiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "areas_resolved_default_tile_id_index" ON "areas" USING btree ("resolved_default_tile_id");--> statement-breakpoint
ALTER TABLE "universe_drafts" DROP COLUMN "passage_of_time";--> statement-breakpoint
ALTER TABLE "universe_drafts" DROP COLUMN "faerie_morning";--> statement-breakpoint
ALTER TABLE "universes" DROP COLUMN "passage_of_time";--> statement-breakpoint
ALTER TABLE "universes" DROP COLUMN "faerie_morning";--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_not_inside_itself" CHECK ("areas"."parent_area_id" <> "areas"."id");--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_resolved_light_level_set" CHECK (("areas"."resolved_light_level" IS NOT NULL) = "areas"."resolved_indoors");--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_resolved_faerie_morning_set" CHECK (("areas"."resolved_passage_of_time" IS NOT DISTINCT FROM 'faerie') = ("areas"."resolved_faerie_morning" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_faerie_morning_set" CHECK (("areas"."passage_of_time" IS NOT DISTINCT FROM 'faerie') = ("areas"."faerie_morning" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_faerie_does_not_loop" CHECK ("areas"."resolved_passage_of_time" IS DISTINCT FROM 'faerie' OR NOT ("areas"."loops_east_west" OR "areas"."loops_north_south"));--> statement-breakpoint
ALTER TABLE "universe_editors" ADD CONSTRAINT "universe_editors_permissions_builder" CHECK ("universe_editors"."role"::text = 'builder' OR NOT ("universe_editors"."can_edit_tiles" OR "universe_editors"."can_edit_items" OR "universe_editors"."can_edit_mobs"));--> statement-breakpoint
DROP TYPE "public"."area_passage_of_time";