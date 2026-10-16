CREATE TYPE "public"."universe_role" AS ENUM('creator', 'builder', 'beta_tester');--> statement-breakpoint
CREATE TABLE "universe_editors" (
	"universe_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"role" "universe_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "universe_editors_universe_id_player_id_pk" PRIMARY KEY("universe_id","player_id")
);
--> statement-breakpoint
ALTER TABLE "tiles" ADD COLUMN "overrides_tile_id" integer;--> statement-breakpoint
ALTER TABLE "universe_editors" ADD CONSTRAINT "universe_editors_universe_id_universes_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "universe_editors" ADD CONSTRAINT "universe_editors_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "universe_editors_player_id_index" ON "universe_editors" USING btree ("player_id");--> statement-breakpoint
ALTER TABLE "tiles" ADD CONSTRAINT "tiles_overrides_tile_id_tiles_id_fk" FOREIGN KEY ("overrides_tile_id") REFERENCES "public"."tiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tiles" ADD CONSTRAINT "tiles_universe_overrides_unique" UNIQUE("universe_id","overrides_tile_id");--> statement-breakpoint
ALTER TABLE "tiles" ADD CONSTRAINT "tiles_overrides_belong_to_universe" CHECK ("tiles"."overrides_tile_id" IS NULL OR "tiles"."universe_id" IS NOT NULL);