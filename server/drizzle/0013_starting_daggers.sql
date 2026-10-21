-- Every character starts with a dagger by default (DEFAULT_STARTING_ITEMS in /shared), so the
-- Pathfinder 1E universes made before starting equipment existed get one too
INSERT INTO "universe_starting_items" ("universe_id", "item_id", "quantity")
SELECT "universes"."id", "items"."id", 1
FROM "universes"
JOIN "items" ON "items"."ruleset" = "universes"."ruleset"
	AND "items"."universe_id" IS NULL
	AND "items"."key" = 'dagger'
WHERE "universes"."ruleset" = 'pf1e';
