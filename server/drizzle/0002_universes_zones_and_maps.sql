CREATE TYPE "public"."faerie_morning" AS ENUM('north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest', 'center', 'horizon');--> statement-breakpoint
CREATE TYPE "public"."passage_of_time" AS ENUM('flows_normally', 'always_dawn', 'always_noon', 'always_dusk', 'always_midnight', 'faerie');--> statement-breakpoint
CREATE TYPE "public"."ruleset" AS ENUM('pf1e');--> statement-breakpoint
CREATE TYPE "public"."universe_stage" AS ENUM('in_the_beginning', 'prologue', 'let_there_be_light', 'end_of_time');--> statement-breakpoint
CREATE TYPE "public"."zone_link_mode" AS ENUM('automatic', 'manual');--> statement-breakpoint
CREATE TYPE "public"."zone_passage_of_time" AS ENUM('inherit', 'flows_normally', 'always_dawn', 'always_noon', 'always_dusk', 'always_midnight', 'faerie');--> statement-breakpoint
CREATE TABLE "map_chunks" (
	"zone_id" uuid NOT NULL,
	"layer" smallint DEFAULT 0 NOT NULL,
	"chunk_column" integer NOT NULL,
	"chunk_row" integer NOT NULL,
	"cells" integer[] NOT NULL,
	CONSTRAINT "map_chunks_zone_id_layer_chunk_column_chunk_row_pk" PRIMARY KEY("zone_id","layer","chunk_column","chunk_row"),
	CONSTRAINT "map_chunks_cell_count" CHECK (cardinality("map_chunks"."cells") = 1024)
);
--> statement-breakpoint
CREATE TABLE "tiles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tiles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"ruleset" "ruleset" NOT NULL,
	"universe_id" uuid,
	"key" text,
	"name" text NOT NULL,
	"indoors" boolean NOT NULL,
	"color" integer NOT NULL,
	"vision_cost" smallint DEFAULT 0 NOT NULL,
	"movement_cost" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tiles_ruleset_key_unique" UNIQUE("ruleset","key"),
	CONSTRAINT "tiles_color_range" CHECK ("tiles"."color" BETWEEN 0 AND 16777215),
	CONSTRAINT "tiles_vision_cost_range" CHECK ("tiles"."vision_cost" BETWEEN 0 AND 100),
	CONSTRAINT "tiles_movement_cost_range" CHECK ("tiles"."movement_cost" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "universes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"short_description" text DEFAULT '' NOT NULL,
	"long_description" text DEFAULT '' NOT NULL,
	"stage" "universe_stage" DEFAULT 'in_the_beginning' NOT NULL,
	"ruleset" "ruleset" NOT NULL,
	"passage_of_time" "passage_of_time" DEFAULT 'flows_normally' NOT NULL,
	"faerie_morning" "faerie_morning",
	"lobby_zone_id" uuid,
	"starting_zone_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "universes_faerie_morning_set" CHECK (("universes"."passage_of_time" = 'faerie') = ("universes"."faerie_morning" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "zone_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zone_id" uuid NOT NULL,
	"column" integer NOT NULL,
	"row" integer NOT NULL,
	"target_zone_id" uuid NOT NULL,
	"target_column" integer NOT NULL,
	"target_row" integer NOT NULL,
	"mode" "zone_link_mode" NOT NULL,
	"requires_whole_group" boolean DEFAULT false NOT NULL,
	CONSTRAINT "zone_links_cell_unique" UNIQUE("zone_id","column","row")
);
--> statement-breakpoint
CREATE TABLE "zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"universe_id" uuid NOT NULL,
	"parent_zone_id" uuid,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"indoors" boolean NOT NULL,
	"default_tile_id" integer NOT NULL,
	"min_column" integer NOT NULL,
	"min_row" integer NOT NULL,
	"max_column" integer NOT NULL,
	"max_row" integer NOT NULL,
	"loops_east_west" boolean DEFAULT false NOT NULL,
	"loops_north_south" boolean DEFAULT false NOT NULL,
	"passage_of_time" "zone_passage_of_time" DEFAULT 'inherit' NOT NULL,
	"faerie_morning" "faerie_morning",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zones_width" CHECK ("zones"."max_column" - "zones"."min_column" BETWEEN 0 AND 49999),
	CONSTRAINT "zones_height" CHECK ("zones"."max_row" - "zones"."min_row" BETWEEN 0 AND 49999),
	CONSTRAINT "zones_faerie_morning_set" CHECK (("zones"."passage_of_time" = 'faerie') = ("zones"."faerie_morning" IS NOT NULL)),
	CONSTRAINT "zones_faerie_does_not_loop" CHECK ("zones"."passage_of_time" <> 'faerie' OR NOT ("zones"."loops_east_west" OR "zones"."loops_north_south"))
);
--> statement-breakpoint
ALTER TABLE "map_chunks" ADD CONSTRAINT "map_chunks_zone_id_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tiles" ADD CONSTRAINT "tiles_universe_id_universes_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "universes" ADD CONSTRAINT "universes_lobby_zone_id_zones_id_fk" FOREIGN KEY ("lobby_zone_id") REFERENCES "public"."zones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "universes" ADD CONSTRAINT "universes_starting_zone_id_zones_id_fk" FOREIGN KEY ("starting_zone_id") REFERENCES "public"."zones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zone_links" ADD CONSTRAINT "zone_links_zone_id_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zone_links" ADD CONSTRAINT "zone_links_target_zone_id_zones_id_fk" FOREIGN KEY ("target_zone_id") REFERENCES "public"."zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zones" ADD CONSTRAINT "zones_universe_id_universes_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zones" ADD CONSTRAINT "zones_parent_zone_id_zones_id_fk" FOREIGN KEY ("parent_zone_id") REFERENCES "public"."zones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zones" ADD CONSTRAINT "zones_default_tile_id_tiles_id_fk" FOREIGN KEY ("default_tile_id") REFERENCES "public"."tiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tiles_universe_id_index" ON "tiles" USING btree ("universe_id");--> statement-breakpoint
CREATE INDEX "zone_links_target_zone_id_index" ON "zone_links" USING btree ("target_zone_id");--> statement-breakpoint
CREATE INDEX "zones_universe_id_index" ON "zones" USING btree ("universe_id");--> statement-breakpoint
CREATE INDEX "zones_parent_zone_id_index" ON "zones" USING btree ("parent_zone_id");