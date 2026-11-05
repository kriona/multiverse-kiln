CREATE TABLE "universe_drafts" (
	"universe_id" uuid PRIMARY KEY NOT NULL,
	"short_description" text DEFAULT '' NOT NULL,
	"long_description" text DEFAULT '' NOT NULL,
	"passage_of_time" "passage_of_time" DEFAULT 'flows_normally' NOT NULL,
	"faerie_morning" "faerie_morning",
	"display_time" "display_time" DEFAULT 'precise' NOT NULL,
	"lobby_area_id" uuid,
	"lobby_column" integer DEFAULT 0 NOT NULL,
	"lobby_row" integer DEFAULT 0 NOT NULL,
	"lobby_passage_of_time" "lobby_passage_of_time" DEFAULT 'real_time' NOT NULL,
	"lobby_day_hours" smallint DEFAULT 24 NOT NULL,
	"lobby_faerie_morning" "faerie_morning",
	"lobby_no_vision_cost" boolean DEFAULT true NOT NULL,
	"starting_area_id" uuid,
	"starting_column" integer DEFAULT 0 NOT NULL,
	"starting_row" integer DEFAULT 0 NOT NULL,
	"group_size" smallint DEFAULT 6 NOT NULL,
	"starting_platinum" integer DEFAULT 0 NOT NULL,
	"starting_gold" integer DEFAULT 0 NOT NULL,
	"starting_silver" integer DEFAULT 0 NOT NULL,
	"starting_copper" integer DEFAULT 0 NOT NULL,
	"starting_credits" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "universe_drafts_faerie_morning_set" CHECK (("universe_drafts"."passage_of_time" = 'faerie') = ("universe_drafts"."faerie_morning" IS NOT NULL)),
	CONSTRAINT "universe_drafts_lobby_faerie_morning_set" CHECK (("universe_drafts"."lobby_passage_of_time" = 'faerie') = ("universe_drafts"."lobby_faerie_morning" IS NOT NULL)),
	CONSTRAINT "universe_drafts_lobby_day_hours_range" CHECK ("universe_drafts"."lobby_day_hours" BETWEEN 1 AND 240),
	CONSTRAINT "universe_drafts_group_size_range" CHECK ("universe_drafts"."group_size" BETWEEN 1 AND 6),
	CONSTRAINT "universe_drafts_starting_coins_range" CHECK ("universe_drafts"."starting_platinum" BETWEEN 0 AND 1000000000 AND "universe_drafts"."starting_gold" BETWEEN 0 AND 1000000000 AND "universe_drafts"."starting_silver" BETWEEN 0 AND 1000000000 AND "universe_drafts"."starting_copper" BETWEEN 0 AND 1000000000),
	CONSTRAINT "universe_drafts_starting_credits_range" CHECK ("universe_drafts"."starting_credits" BETWEEN 0 AND 1000000000)
);
--> statement-breakpoint
ALTER TABLE "classes" DROP CONSTRAINT "classes_universe_overrides_unique";--> statement-breakpoint
ALTER TABLE "difficulty_levels" DROP CONSTRAINT "difficulty_levels_universe_key_unique";--> statement-breakpoint
ALTER TABLE "items" DROP CONSTRAINT "items_universe_overrides_unique";--> statement-breakpoint
ALTER TABLE "races" DROP CONSTRAINT "races_universe_overrides_unique";--> statement-breakpoint
ALTER TABLE "themes" DROP CONSTRAINT "themes_universe_overrides_unique";--> statement-breakpoint
ALTER TABLE "tile_graphics" DROP CONSTRAINT "tile_graphics_storage_key_unique";--> statement-breakpoint
ALTER TABLE "tiles" DROP CONSTRAINT "tiles_universe_overrides_unique";--> statement-breakpoint
DROP INDEX "difficulty_levels_one_default";--> statement-breakpoint
ALTER TABLE "universe_starting_items" DROP CONSTRAINT "universe_starting_items_universe_id_item_id_pk";--> statement-breakpoint
ALTER TABLE "universe_translations" DROP CONSTRAINT "universe_translations_universe_id_kind_thing_id_field_language_pk";--> statement-breakpoint
ALTER TABLE "universe_translator_notes" DROP CONSTRAINT "universe_translator_notes_universe_id_kind_thing_id_field_pk";--> statement-breakpoint
ALTER TABLE "pf1e_settings" DROP CONSTRAINT "pf1e_settings_pkey";--> statement-breakpoint
ALTER TABLE "sf1e_settings" DROP CONSTRAINT "sf1e_settings_pkey";--> statement-breakpoint
ALTER TABLE "areas" ADD COLUMN "draft" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "areas" ADD COLUMN "origin_id" uuid;--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "draft" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "origin_id" integer;--> statement-breakpoint
ALTER TABLE "difficulty_levels" ADD COLUMN "draft" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "difficulty_levels" ADD COLUMN "origin_id" integer;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "draft" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "origin_id" integer;--> statement-breakpoint
ALTER TABLE "pf1e_settings" ADD COLUMN "draft" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "races" ADD COLUMN "draft" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "races" ADD COLUMN "origin_id" integer;--> statement-breakpoint
ALTER TABLE "sf1e_settings" ADD COLUMN "draft" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "themes" ADD COLUMN "draft" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "themes" ADD COLUMN "origin_id" integer;--> statement-breakpoint
ALTER TABLE "tile_graphics" ADD COLUMN "draft" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tile_graphics" ADD COLUMN "origin_id" uuid;--> statement-breakpoint
ALTER TABLE "tiles" ADD COLUMN "draft" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tiles" ADD COLUMN "origin_id" integer;--> statement-breakpoint
ALTER TABLE "universe_edits" ADD COLUMN "draft" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "universe_starting_items" ADD COLUMN "draft" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "universe_translations" ADD COLUMN "draft" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "universe_translator_notes" ADD COLUMN "draft" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pf1e_settings" ADD CONSTRAINT "pf1e_settings_universe_id_draft_pk" PRIMARY KEY("universe_id","draft");--> statement-breakpoint
ALTER TABLE "sf1e_settings" ADD CONSTRAINT "sf1e_settings_universe_id_draft_pk" PRIMARY KEY("universe_id","draft");--> statement-breakpoint
ALTER TABLE "universe_starting_items" ADD CONSTRAINT "universe_starting_items_universe_id_draft_item_id_pk" PRIMARY KEY("universe_id","draft","item_id");--> statement-breakpoint
ALTER TABLE "universe_translations" ADD CONSTRAINT "universe_translations_universe_id_draft_kind_thing_id_field_language_pk" PRIMARY KEY("universe_id","draft","kind","thing_id","field","language");--> statement-breakpoint
ALTER TABLE "universe_translator_notes" ADD CONSTRAINT "universe_translator_notes_universe_id_draft_kind_thing_id_field_pk" PRIMARY KEY("universe_id","draft","kind","thing_id","field");--> statement-breakpoint
ALTER TABLE "universe_drafts" ADD CONSTRAINT "universe_drafts_universe_id_universes_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "universe_drafts" ADD CONSTRAINT "universe_drafts_lobby_area_id_areas_id_fk" FOREIGN KEY ("lobby_area_id") REFERENCES "public"."areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "universe_drafts" ADD CONSTRAINT "universe_drafts_starting_area_id_areas_id_fk" FOREIGN KEY ("starting_area_id") REFERENCES "public"."areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_origin_id_areas_id_fk" FOREIGN KEY ("origin_id") REFERENCES "public"."areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_origin_id_classes_id_fk" FOREIGN KEY ("origin_id") REFERENCES "public"."classes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "difficulty_levels" ADD CONSTRAINT "difficulty_levels_origin_id_difficulty_levels_id_fk" FOREIGN KEY ("origin_id") REFERENCES "public"."difficulty_levels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_origin_id_items_id_fk" FOREIGN KEY ("origin_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "races" ADD CONSTRAINT "races_origin_id_races_id_fk" FOREIGN KEY ("origin_id") REFERENCES "public"."races"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "themes" ADD CONSTRAINT "themes_origin_id_themes_id_fk" FOREIGN KEY ("origin_id") REFERENCES "public"."themes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tile_graphics" ADD CONSTRAINT "tile_graphics_origin_id_tile_graphics_id_fk" FOREIGN KEY ("origin_id") REFERENCES "public"."tile_graphics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tiles" ADD CONSTRAINT "tiles_origin_id_tiles_id_fk" FOREIGN KEY ("origin_id") REFERENCES "public"."tiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "areas_origin_id_index" ON "areas" USING btree ("origin_id");--> statement-breakpoint
CREATE INDEX "classes_origin_id_index" ON "classes" USING btree ("origin_id");--> statement-breakpoint
CREATE INDEX "difficulty_levels_origin_id_index" ON "difficulty_levels" USING btree ("origin_id");--> statement-breakpoint
CREATE INDEX "items_origin_id_index" ON "items" USING btree ("origin_id");--> statement-breakpoint
CREATE INDEX "races_origin_id_index" ON "races" USING btree ("origin_id");--> statement-breakpoint
CREATE INDEX "themes_origin_id_index" ON "themes" USING btree ("origin_id");--> statement-breakpoint
CREATE INDEX "tile_graphics_origin_id_index" ON "tile_graphics" USING btree ("origin_id");--> statement-breakpoint
CREATE INDEX "tiles_origin_id_index" ON "tiles" USING btree ("origin_id");--> statement-breakpoint
CREATE UNIQUE INDEX "difficulty_levels_one_default" ON "difficulty_levels" USING btree ("universe_id","draft") WHERE "difficulty_levels"."is_default";--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_universe_overrides_unique" UNIQUE("universe_id","draft","overrides_class_id");--> statement-breakpoint
ALTER TABLE "difficulty_levels" ADD CONSTRAINT "difficulty_levels_universe_key_unique" UNIQUE("universe_id","draft","key");--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_universe_overrides_unique" UNIQUE("universe_id","draft","overrides_item_id");--> statement-breakpoint
ALTER TABLE "races" ADD CONSTRAINT "races_universe_overrides_unique" UNIQUE("universe_id","draft","overrides_race_id");--> statement-breakpoint
ALTER TABLE "themes" ADD CONSTRAINT "themes_universe_overrides_unique" UNIQUE("universe_id","draft","overrides_theme_id");--> statement-breakpoint
ALTER TABLE "tile_graphics" ADD CONSTRAINT "tile_graphics_draft_storage_key_unique" UNIQUE("draft","storage_key");--> statement-breakpoint
ALTER TABLE "tiles" ADD CONSTRAINT "tiles_universe_overrides_unique" UNIQUE("universe_id","draft","overrides_tile_id");--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_origin_in_draft" CHECK ("areas"."origin_id" IS NULL OR "areas"."draft");--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_draft_belongs_to_universe" CHECK (NOT "areas"."draft" OR "areas"."universe_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_origin_in_draft" CHECK ("classes"."origin_id" IS NULL OR "classes"."draft");--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_draft_belongs_to_universe" CHECK (NOT "classes"."draft" OR "classes"."universe_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "difficulty_levels" ADD CONSTRAINT "difficulty_levels_origin_in_draft" CHECK ("difficulty_levels"."origin_id" IS NULL OR "difficulty_levels"."draft");--> statement-breakpoint
ALTER TABLE "difficulty_levels" ADD CONSTRAINT "difficulty_levels_draft_belongs_to_universe" CHECK (NOT "difficulty_levels"."draft" OR "difficulty_levels"."universe_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_origin_in_draft" CHECK ("items"."origin_id" IS NULL OR "items"."draft");--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_draft_belongs_to_universe" CHECK (NOT "items"."draft" OR "items"."universe_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "races" ADD CONSTRAINT "races_origin_in_draft" CHECK ("races"."origin_id" IS NULL OR "races"."draft");--> statement-breakpoint
ALTER TABLE "races" ADD CONSTRAINT "races_draft_belongs_to_universe" CHECK (NOT "races"."draft" OR "races"."universe_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "themes" ADD CONSTRAINT "themes_origin_in_draft" CHECK ("themes"."origin_id" IS NULL OR "themes"."draft");--> statement-breakpoint
ALTER TABLE "themes" ADD CONSTRAINT "themes_draft_belongs_to_universe" CHECK (NOT "themes"."draft" OR "themes"."universe_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "tile_graphics" ADD CONSTRAINT "tile_graphics_origin_in_draft" CHECK ("tile_graphics"."origin_id" IS NULL OR "tile_graphics"."draft");--> statement-breakpoint
ALTER TABLE "tile_graphics" ADD CONSTRAINT "tile_graphics_draft_belongs_to_universe" CHECK (NOT "tile_graphics"."draft" OR "tile_graphics"."universe_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "tiles" ADD CONSTRAINT "tiles_origin_in_draft" CHECK ("tiles"."origin_id" IS NULL OR "tiles"."draft");--> statement-breakpoint
ALTER TABLE "tiles" ADD CONSTRAINT "tiles_draft_belongs_to_universe" CHECK (NOT "tiles"."draft" OR "tiles"."universe_id" IS NOT NULL);