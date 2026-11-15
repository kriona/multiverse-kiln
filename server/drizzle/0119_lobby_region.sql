ALTER TABLE "areas" ADD COLUMN "resolved_lobby" boolean NOT NULL;--> statement-breakpoint
ALTER TABLE "universe_drafts" ADD COLUMN "lobby_region_id" uuid;--> statement-breakpoint
ALTER TABLE "universes" ADD COLUMN "lobby_region_id" uuid;--> statement-breakpoint
ALTER TABLE "universe_drafts" ADD CONSTRAINT "universe_drafts_lobby_region_id_regions_id_fk" FOREIGN KEY ("lobby_region_id") REFERENCES "public"."regions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "universes" ADD CONSTRAINT "universes_lobby_region_id_regions_id_fk" FOREIGN KEY ("lobby_region_id") REFERENCES "public"."regions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "universe_drafts_lobby_region_id_index" ON "universe_drafts" USING btree ("lobby_region_id");--> statement-breakpoint
CREATE INDEX "universes_lobby_region_id_index" ON "universes" USING btree ("lobby_region_id");--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_resolved_passage_of_time_set" CHECK (("areas"."resolved_passage_of_time" IS NULL) = "areas"."resolved_lobby");