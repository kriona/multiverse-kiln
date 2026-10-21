CREATE TABLE "character_items" (
	"character_id" uuid NOT NULL,
	"item_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "character_items_character_id_item_id_pk" PRIMARY KEY("character_id","item_id"),
	CONSTRAINT "character_items_quantity_positive" CHECK ("character_items"."quantity" >= 1)
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"universe_id" uuid NOT NULL,
	"name" text NOT NULL,
	"race_id" integer NOT NULL,
	"class_id" integer NOT NULL,
	"platinum" integer DEFAULT 0 NOT NULL,
	"gold" integer DEFAULT 0 NOT NULL,
	"silver" integer DEFAULT 0 NOT NULL,
	"copper" integer DEFAULT 0 NOT NULL,
	"zone_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "characters_coins_range" CHECK ("characters"."platinum" BETWEEN 0 AND 1000000000 AND "characters"."gold" BETWEEN 0 AND 1000000000 AND "characters"."silver" BETWEEN 0 AND 1000000000 AND "characters"."copper" BETWEEN 0 AND 1000000000)
);
--> statement-breakpoint
CREATE TABLE "pf1e_ability_rolls" (
	"player_id" uuid NOT NULL,
	"universe_id" uuid NOT NULL,
	"stat_method" "pf1e_stat_method" NOT NULL,
	"scores" smallint[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pf1e_ability_rolls_player_id_universe_id_pk" PRIMARY KEY("player_id","universe_id"),
	CONSTRAINT "pf1e_ability_rolls_score_count" CHECK (cardinality("pf1e_ability_rolls"."scores") = 6)
);
--> statement-breakpoint
CREATE TABLE "pf1e_characters" (
	"character_id" uuid PRIMARY KEY NOT NULL,
	"strength" smallint NOT NULL,
	"dexterity" smallint NOT NULL,
	"constitution" smallint NOT NULL,
	"intelligence" smallint NOT NULL,
	"wisdom" smallint NOT NULL,
	"charisma" smallint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "character_items" ADD CONSTRAINT "character_items_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_items" ADD CONSTRAINT "character_items_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_universe_id_universes_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_zone_id_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."zones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pf1e_ability_rolls" ADD CONSTRAINT "pf1e_ability_rolls_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pf1e_ability_rolls" ADD CONSTRAINT "pf1e_ability_rolls_universe_id_universes_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pf1e_characters" ADD CONSTRAINT "pf1e_characters_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "character_items_item_id_index" ON "character_items" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "characters_player_universe_index" ON "characters" USING btree ("player_id","universe_id");--> statement-breakpoint
CREATE INDEX "characters_universe_id_index" ON "characters" USING btree ("universe_id");--> statement-breakpoint
CREATE INDEX "characters_race_id_index" ON "characters" USING btree ("race_id");--> statement-breakpoint
CREATE INDEX "characters_class_id_index" ON "characters" USING btree ("class_id");--> statement-breakpoint
CREATE INDEX "characters_zone_id_index" ON "characters" USING btree ("zone_id");--> statement-breakpoint
CREATE INDEX "pf1e_ability_rolls_universe_id_index" ON "pf1e_ability_rolls" USING btree ("universe_id");