ALTER TABLE "areas" ADD COLUMN "fog_of_war" boolean;--> statement-breakpoint
ALTER TABLE "areas" ADD COLUMN "resolved_fog_of_war" boolean NOT NULL;--> statement-breakpoint
ALTER TABLE "regions" ADD COLUMN "fog_of_war" boolean;--> statement-breakpoint
ALTER TABLE "universe_drafts" DROP COLUMN "lobby_no_vision_cost";--> statement-breakpoint
ALTER TABLE "universes" DROP COLUMN "lobby_no_vision_cost";