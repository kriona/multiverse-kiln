-- Every tile is for outdoor areas when it isn't for indoor ones
UPDATE "tiles" SET "outdoors" = NOT "indoors";
--> statement-breakpoint
-- Outdoor tiles take minutes where indoor ones take seconds: 10 seconds becomes 10 minutes, up to the
-- most a tile can take
UPDATE "tiles" SET "walk_seconds" = LEAST("walk_seconds" * 60, 3600) WHERE "outdoors" AND "walk_seconds" > 0;
