-- Every universe gets the default difficulty levels (DEFAULT_DIFFICULTY_LEVELS in /shared), which new
-- universes are made with
INSERT INTO "difficulty_levels" ("universe_id", "key", "is_default", "mob_scale", "permadeath")
SELECT "universes"."id", "levels"."key", "levels"."is_default", "levels"."mob_scale", "levels"."permadeath"
FROM "universes"
CROSS JOIN (VALUES
	('story', false, -50, false),
	('normal', true, 0, false),
	('hard', false, 50, false),
	('hardcore', false, 100, true)
) AS "levels" ("key", "is_default", "mob_scale", "permadeath")
ORDER BY "universes"."id", "levels"."mob_scale";
--> statement-breakpoint
-- Groups made before there were difficulty levels play at their universe's default
UPDATE "groups"
SET "difficulty_level_id" = "difficulty_levels"."id"
FROM "difficulty_levels"
WHERE "difficulty_levels"."universe_id" = "groups"."universe_id" AND "difficulty_levels"."is_default";
