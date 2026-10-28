-- Every ruleset's default grass is drawn with the grass graphic, and so is each universe's edited copy
-- of it, which keeps the look of the tile it was copied from
UPDATE "tiles" SET "graphic" = 'grass'
WHERE ("key" = 'grass' AND "universe_id" IS NULL)
	OR "overrides_tile_id" IN (SELECT "id" FROM "tiles" WHERE "key" = 'grass' AND "universe_id" IS NULL);