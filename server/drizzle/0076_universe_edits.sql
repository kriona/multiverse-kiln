CREATE TYPE "public"."editor_role" AS ENUM('creator', 'builder', 'beta_tester', 'translator', 'admin');--> statement-breakpoint
CREATE TABLE "universe_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"universe_id" uuid NOT NULL,
	"player_id" uuid,
	"role" "editor_role" NOT NULL,
	"change_counts" jsonb,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "universe_edits" ADD CONSTRAINT "universe_edits_universe_id_universes_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "universe_edits" ADD CONSTRAINT "universe_edits_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "universe_edits_universe_id_saved_at_index" ON "universe_edits" USING btree ("universe_id","saved_at");--> statement-breakpoint
CREATE INDEX "universe_edits_player_id_index" ON "universe_edits" USING btree ("player_id");