CREATE TABLE "character_drafts" (
	"player_id" uuid NOT NULL,
	"universe_id" uuid NOT NULL,
	"draft" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_drafts_player_id_universe_id_pk" PRIMARY KEY("player_id","universe_id")
);
--> statement-breakpoint
ALTER TABLE "character_drafts" ADD CONSTRAINT "character_drafts_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_drafts" ADD CONSTRAINT "character_drafts_universe_id_universes_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "character_drafts_universe_id_index" ON "character_drafts" USING btree ("universe_id");