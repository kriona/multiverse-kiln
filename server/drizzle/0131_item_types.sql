-- Renames and drops item types (currentItemTypes() in /shared): Pathfinder 1E's torch becomes light
-- source, and Starfinder 1E's types, which were each one item, become its weapon categories, ammunition
-- and light armor; the comm unit type is dropped. Every item row changes: the defaults, universes' own
-- items and edited copies, in their drafts too. Each item's types stay in the ruleset's order, each once
WITH "renamed" ("ruleset", "old_type", "new_type") AS (
	VALUES
		('pf1e'::ruleset, 'torch', 'light_source'),
		('sf1e'::ruleset, 'survival_knife', 'basic_melee'),
		('sf1e'::ruleset, 'tactical_baton', 'basic_melee'),
		('sf1e'::ruleset, 'laser_pistol', 'small_arms'),
		('sf1e'::ruleset, 'semi_auto_pistol', 'small_arms'),
		('sf1e'::ruleset, 'laser_rifle', 'longarms'),
		('sf1e'::ruleset, 'frag_grenade', 'grenades'),
		('sf1e'::ruleset, 'battery', 'ammunition'),
		('sf1e'::ruleset, 'small_arm_rounds', 'ammunition'),
		('sf1e'::ruleset, 'second_skin', 'light_armor'),
		('sf1e'::ruleset, 'comm_unit', NULL),
		('sf1e'::ruleset, 'flashlight', 'light_source')
),
"type_order" ("ruleset", "type", "position") AS (
	SELECT 'pf1e'::ruleset, "type", "position" FROM unnest(ARRAY['axes', 'blades_heavy', 'blades_light', 'bows', 'close', 'crossbows', 'double', 'flails', 'hammers', 'monk', 'natural', 'polearms', 'spears', 'thrown', 'ammunition', 'light_armor', 'medium_armor', 'heavy_armor', 'shields', 'alchemical', 'clothing', 'food_and_drink', 'light_source', 'poison', 'rope', 'tool']) WITH ORDINALITY AS "types" ("type", "position")
	UNION ALL
	SELECT 'sf1e'::ruleset, "type", "position" FROM unnest(ARRAY['basic_melee', 'advanced_melee', 'small_arms', 'longarms', 'heavy_weapons', 'sniper_weapons', 'grenades', 'special_weapons', 'ammunition', 'light_armor', 'heavy_armor', 'alchemical', 'clothing', 'drug', 'food_and_drink', 'light_source', 'medicinal', 'poison', 'tool']) WITH ORDINALITY AS "types" ("type", "position")
),
"converted" ("id", "types") AS (
	SELECT "items"."id", coalesce((
		SELECT array_agg("current"."type" ORDER BY "current"."position", "current"."type")
		FROM (
			SELECT DISTINCT coalesce("renamed"."new_type", "old"."type") AS "type", coalesce("type_order"."position", 1000) AS "position"
			FROM unnest("items"."types") AS "old" ("type")
			LEFT JOIN "renamed" ON "renamed"."ruleset" = "items"."ruleset" AND "renamed"."old_type" = "old"."type"
			LEFT JOIN "type_order" ON "type_order"."ruleset" = "items"."ruleset" AND "type_order"."type" = coalesce("renamed"."new_type", "old"."type")
			WHERE "renamed"."old_type" IS NULL OR "renamed"."new_type" IS NOT NULL
		) AS "current"
	), '{}')
	FROM "items"
	WHERE EXISTS (
		SELECT 1 FROM "renamed"
		WHERE "renamed"."ruleset" = "items"."ruleset" AND "renamed"."old_type" = ANY("items"."types")
	)
)
UPDATE "items" SET "types" = "converted"."types"
FROM "converted"
WHERE "items"."id" = "converted"."id";
