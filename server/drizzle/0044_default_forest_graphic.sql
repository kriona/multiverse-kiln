-- Every ruleset's default forest is drawn with the forest graphic, and so is each universe's edited copy
-- of it, which keeps the look of the tile it was copied from
UPDATE "tiles" SET "graphic" = 'forest'
WHERE ("key" = 'forest' AND "universe_id" IS NULL)
	OR "overrides_tile_id" IN (SELECT "id" FROM "tiles" WHERE "key" = 'forest' AND "universe_id" IS NULL);