-- Where each default item equips (DEFAULT_ITEM_EQUIPS in /shared), and which default Pathfinder 1E races
-- have a tail (PF1E_RACES). Universes' edited copies of the defaults, in their drafts too, get the same
-- settings, since a copy holds every setting of its own
UPDATE "items" SET "equips" = "equips_of"."equips"
FROM (VALUES
	('pf1e', 'dagger', 'oneHand'),
	('pf1e', 'cestus', 'hands'),
	('pf1e', 'sword_cane', 'oneHand'),
	('pf1e', 'wooden_armor', 'armor'),
	('pf1e', 'quilted_cloth', 'armor'),
	('pf1e', 'kobold_long_lash', 'tail'),
	('pf1e', 'kobold_spiked_tail', 'tail'),
	('pf1e', 'ratfolk_tailblade', 'tail'),
	('sf1e', 'survival_knife', 'oneHand')
) AS "equips_of" ("ruleset", "key", "equips"), "items" AS "defaults"
WHERE "defaults"."ruleset" = "equips_of"."ruleset"::ruleset
	AND "defaults"."key" = "equips_of"."key"
	AND "defaults"."universe_id" IS NULL
	AND ("items"."id" = "defaults"."id" OR "items"."overrides_item_id" = "defaults"."id");--> statement-breakpoint
UPDATE "pf1e_races" SET "has_tail" = true
FROM "races" AS "race", "races" AS "defaults"
WHERE "pf1e_races"."race_id" = "race"."id"
	AND "defaults"."ruleset" = 'pf1e'
	AND "defaults"."universe_id" IS NULL
	AND "defaults"."key" IN ('catfolk', 'kitsune', 'kobold', 'ratfolk', 'tiefling', 'vanara')
	AND ("race"."id" = "defaults"."id" OR "race"."overrides_race_id" = "defaults"."id");
