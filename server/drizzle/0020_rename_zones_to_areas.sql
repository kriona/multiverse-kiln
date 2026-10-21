ALTER TYPE "public"."zone_link_mode" RENAME TO "area_link_mode";--> statement-breakpoint
ALTER TYPE "public"."zone_passage_of_time" RENAME TO "area_passage_of_time";--> statement-breakpoint
ALTER TABLE "zone_links" RENAME TO "area_links";--> statement-breakpoint
ALTER TABLE "zones" RENAME TO "areas";--> statement-breakpoint
ALTER TABLE "class_race_zones" RENAME TO "class_race_areas";--> statement-breakpoint
ALTER TABLE "characters" RENAME COLUMN "zone_id" TO "area_id";--> statement-breakpoint
ALTER TABLE "class_race_areas" RENAME COLUMN "zone_id" TO "area_id";--> statement-breakpoint
ALTER TABLE "classes" RENAME COLUMN "starting_zone_id" TO "starting_area_id";--> statement-breakpoint
ALTER TABLE "map_chunks" RENAME COLUMN "zone_id" TO "area_id";--> statement-breakpoint
ALTER TABLE "races" RENAME COLUMN "starting_zone_id" TO "starting_area_id";--> statement-breakpoint
ALTER TABLE "universes" RENAME COLUMN "lobby_zone_id" TO "lobby_area_id";--> statement-breakpoint
ALTER TABLE "universes" RENAME COLUMN "starting_zone_id" TO "starting_area_id";--> statement-breakpoint
ALTER TABLE "area_links" RENAME COLUMN "zone_id" TO "area_id";--> statement-breakpoint
ALTER TABLE "area_links" RENAME COLUMN "target_zone_id" TO "target_area_id";--> statement-breakpoint
ALTER TABLE "areas" RENAME COLUMN "parent_zone_id" TO "parent_area_id";--> statement-breakpoint
ALTER TABLE "area_links" DROP CONSTRAINT "zone_links_cell_unique";--> statement-breakpoint
ALTER TABLE "areas" DROP CONSTRAINT "zones_width";--> statement-breakpoint
ALTER TABLE "areas" DROP CONSTRAINT "zones_height";--> statement-breakpoint
ALTER TABLE "areas" DROP CONSTRAINT "zones_faerie_morning_set";--> statement-breakpoint
ALTER TABLE "areas" DROP CONSTRAINT "zones_faerie_does_not_loop";--> statement-breakpoint
ALTER TABLE "characters" DROP CONSTRAINT "characters_zone_id_zones_id_fk";
--> statement-breakpoint
ALTER TABLE "class_race_areas" DROP CONSTRAINT "class_race_zones_class_id_classes_id_fk";
--> statement-breakpoint
ALTER TABLE "class_race_areas" DROP CONSTRAINT "class_race_zones_race_id_races_id_fk";
--> statement-breakpoint
ALTER TABLE "class_race_areas" DROP CONSTRAINT "class_race_zones_zone_id_zones_id_fk";
--> statement-breakpoint
ALTER TABLE "classes" DROP CONSTRAINT "classes_starting_zone_id_zones_id_fk";
--> statement-breakpoint
ALTER TABLE "map_chunks" DROP CONSTRAINT "map_chunks_zone_id_zones_id_fk";
--> statement-breakpoint
ALTER TABLE "races" DROP CONSTRAINT "races_starting_zone_id_zones_id_fk";
--> statement-breakpoint
ALTER TABLE "universes" DROP CONSTRAINT "universes_lobby_zone_id_zones_id_fk";
--> statement-breakpoint
ALTER TABLE "universes" DROP CONSTRAINT "universes_starting_zone_id_zones_id_fk";
--> statement-breakpoint
ALTER TABLE "area_links" DROP CONSTRAINT "zone_links_zone_id_zones_id_fk";
--> statement-breakpoint
ALTER TABLE "area_links" DROP CONSTRAINT "zone_links_target_zone_id_zones_id_fk";
--> statement-breakpoint
ALTER TABLE "areas" DROP CONSTRAINT "zones_universe_id_universes_id_fk";
--> statement-breakpoint
ALTER TABLE "areas" DROP CONSTRAINT "zones_parent_zone_id_zones_id_fk";
--> statement-breakpoint
ALTER TABLE "areas" DROP CONSTRAINT "zones_default_tile_id_tiles_id_fk";
--> statement-breakpoint
DROP INDEX "characters_zone_id_index";--> statement-breakpoint
DROP INDEX "class_race_zones_race_id_index";--> statement-breakpoint
DROP INDEX "class_race_zones_zone_id_index";--> statement-breakpoint
DROP INDEX "classes_starting_zone_id_index";--> statement-breakpoint
DROP INDEX "races_starting_zone_id_index";--> statement-breakpoint
DROP INDEX "zone_links_target_zone_id_index";--> statement-breakpoint
DROP INDEX "zones_universe_id_index";--> statement-breakpoint
DROP INDEX "zones_parent_zone_id_index";--> statement-breakpoint
ALTER TABLE "class_race_areas" DROP CONSTRAINT "class_race_zones_class_id_race_id_pk";--> statement-breakpoint
ALTER TABLE "map_chunks" DROP CONSTRAINT "map_chunks_zone_id_layer_chunk_column_chunk_row_pk";--> statement-breakpoint
ALTER TABLE "class_race_areas" ADD CONSTRAINT "class_race_areas_class_id_race_id_pk" PRIMARY KEY("class_id","race_id");--> statement-breakpoint
ALTER TABLE "map_chunks" ADD CONSTRAINT "map_chunks_area_id_layer_chunk_column_chunk_row_pk" PRIMARY KEY("area_id","layer","chunk_column","chunk_row");--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_race_areas" ADD CONSTRAINT "class_race_areas_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_race_areas" ADD CONSTRAINT "class_race_areas_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_race_areas" ADD CONSTRAINT "class_race_areas_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_starting_area_id_areas_id_fk" FOREIGN KEY ("starting_area_id") REFERENCES "public"."areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_chunks" ADD CONSTRAINT "map_chunks_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "races" ADD CONSTRAINT "races_starting_area_id_areas_id_fk" FOREIGN KEY ("starting_area_id") REFERENCES "public"."areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "universes" ADD CONSTRAINT "universes_lobby_area_id_areas_id_fk" FOREIGN KEY ("lobby_area_id") REFERENCES "public"."areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "universes" ADD CONSTRAINT "universes_starting_area_id_areas_id_fk" FOREIGN KEY ("starting_area_id") REFERENCES "public"."areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "area_links" ADD CONSTRAINT "area_links_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "area_links" ADD CONSTRAINT "area_links_target_area_id_areas_id_fk" FOREIGN KEY ("target_area_id") REFERENCES "public"."areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_universe_id_universes_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_parent_area_id_areas_id_fk" FOREIGN KEY ("parent_area_id") REFERENCES "public"."areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_default_tile_id_tiles_id_fk" FOREIGN KEY ("default_tile_id") REFERENCES "public"."tiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "characters_area_id_index" ON "characters" USING btree ("area_id");--> statement-breakpoint
CREATE INDEX "class_race_areas_race_id_index" ON "class_race_areas" USING btree ("race_id");--> statement-breakpoint
CREATE INDEX "class_race_areas_area_id_index" ON "class_race_areas" USING btree ("area_id");--> statement-breakpoint
CREATE INDEX "classes_starting_area_id_index" ON "classes" USING btree ("starting_area_id");--> statement-breakpoint
CREATE INDEX "races_starting_area_id_index" ON "races" USING btree ("starting_area_id");--> statement-breakpoint
CREATE INDEX "area_links_target_area_id_index" ON "area_links" USING btree ("target_area_id");--> statement-breakpoint
CREATE INDEX "areas_universe_id_index" ON "areas" USING btree ("universe_id");--> statement-breakpoint
CREATE INDEX "areas_parent_area_id_index" ON "areas" USING btree ("parent_area_id");--> statement-breakpoint
ALTER TABLE "area_links" ADD CONSTRAINT "area_links_cell_unique" UNIQUE("area_id","column","row");--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_width" CHECK ("areas"."max_column" - "areas"."min_column" BETWEEN 0 AND 49999);--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_height" CHECK ("areas"."max_row" - "areas"."min_row" BETWEEN 0 AND 49999);--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_faerie_morning_set" CHECK (("areas"."passage_of_time" = 'faerie') = ("areas"."faerie_morning" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_faerie_does_not_loop" CHECK ("areas"."passage_of_time" <> 'faerie' OR NOT ("areas"."loops_east_west" OR "areas"."loops_north_south"));