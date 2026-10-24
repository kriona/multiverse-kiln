-- Every ruleset's default mountains are drawn with the mountains graphic, and so is each universe's edited
-- copy of them, which keeps the look of the tile it was copied from
UPDATE "tiles" SET "graphic" = 'mountains'
WHERE ("key" = 'mountains' AND "universe_id" IS NULL)
	OR "overrides_tile_id" IN (SELECT "id" FROM "tiles" WHERE "key" = 'mountains' AND "universe_id" IS NULL);