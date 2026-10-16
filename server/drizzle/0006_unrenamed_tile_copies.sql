-- Edited copies of default tiles that kept the default tile's name store none, so players read the
-- name in their language (DEFAULT_TILE_NAMES in /shared)
UPDATE "tiles" AS "copy"
SET "name" = NULL
FROM "tiles" AS "default_tile"
WHERE "copy"."overrides_tile_id" = "default_tile"."id"
	AND "copy"."name" = "default_tile"."name";
