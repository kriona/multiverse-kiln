-- Items have a category and any number of that category's types (ITEM_KINDS in /shared), where they had
-- one type each. A Pathfinder 1E weapon's types are the fighter's weapon groups it is in, and armor's
-- are light, medium and heavy armor and shields. "Other gear" becomes no type. 0126 drops the old column
ALTER TABLE "items" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "types" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
UPDATE "items" SET "category" = "kinds"."category", "types" = "kinds"."types"
FROM (VALUES
	('pf1e', 'dagger', 'weapon', ARRAY['blades_light', 'thrown']),
	('pf1e', 'club', 'weapon', ARRAY['hammers', 'thrown']),
	('pf1e', 'quarterstaff', 'weapon', ARRAY['double', 'monk']),
	('pf1e', 'spear', 'weapon', ARRAY['spears', 'thrown']),
	('pf1e', 'short_sword', 'weapon', ARRAY['blades_light']),
	('pf1e', 'longsword', 'weapon', ARRAY['blades_heavy']),
	('pf1e', 'shortbow', 'weapon', ARRAY['bows']),
	('pf1e', 'longbow', 'weapon', ARRAY['bows']),
	('pf1e', 'light_crossbow', 'weapon', ARRAY['crossbows']),
	('pf1e', 'arrows', 'weapon', ARRAY[]::text[]),
	('pf1e', 'crossbow_bolts', 'weapon', ARRAY[]::text[]),
	('pf1e', 'cestus', 'weapon', ARRAY['close', 'monk']),
	('pf1e', 'sword_cane', 'weapon', ARRAY['blades_light']),
	('pf1e', 'kobold_long_lash', 'weapon', ARRAY[]::text[]),
	('pf1e', 'kobold_spiked_tail', 'weapon', ARRAY[]::text[]),
	('pf1e', 'ratfolk_tailblade', 'weapon', ARRAY['blades_light']),
	('pf1e', 'padded_armor', 'armor', ARRAY['light_armor']),
	('pf1e', 'leather_armor', 'armor', ARRAY['light_armor']),
	('pf1e', 'chain_shirt', 'armor', ARRAY['light_armor']),
	('pf1e', 'wooden_armor', 'armor', ARRAY['light_armor']),
	('pf1e', 'quilted_cloth', 'armor', ARRAY['light_armor']),
	('pf1e', 'light_shield', 'armor', ARRAY['shields']),
	('pf1e', 'heavy_shield', 'armor', ARRAY['shields']),
	('pf1e', 'rope', 'gear', ARRAY['rope']),
	('pf1e', 'torch', 'gear', ARRAY['torch']),
	('pf1e', 'other_gear', 'gear', ARRAY[]::text[]),
	('sf1e', 'survival_knife', 'weapon', ARRAY['survival_knife']),
	('sf1e', 'tactical_baton', 'weapon', ARRAY['tactical_baton']),
	('sf1e', 'laser_pistol', 'weapon', ARRAY['laser_pistol']),
	('sf1e', 'semi_auto_pistol', 'weapon', ARRAY['semi_auto_pistol']),
	('sf1e', 'laser_rifle', 'weapon', ARRAY['laser_rifle']),
	('sf1e', 'frag_grenade', 'weapon', ARRAY['frag_grenade']),
	('sf1e', 'battery', 'weapon', ARRAY['battery']),
	('sf1e', 'small_arm_rounds', 'weapon', ARRAY['small_arm_rounds']),
	('sf1e', 'second_skin', 'armor', ARRAY['second_skin']),
	('sf1e', 'light_armor', 'armor', ARRAY['light_armor']),
	('sf1e', 'heavy_armor', 'armor', ARRAY['heavy_armor']),
	('sf1e', 'comm_unit', 'gear', ARRAY['comm_unit']),
	('sf1e', 'flashlight', 'gear', ARRAY['flashlight']),
	('sf1e', 'other_gear', 'gear', ARRAY[]::text[])
) AS "kinds" ("ruleset", "type", "category", "types")
WHERE "items"."ruleset" = "kinds"."ruleset"::ruleset AND "items"."type" = "kinds"."type";--> statement-breakpoint
-- The Advanced Class Guide's class kits are lists of other items, so its own gear replaces them. A
-- character carrying a kit no longer does; the other rows naming a kit go with it
DELETE FROM "character_items" WHERE "item_id" IN (SELECT "id" FROM "items" WHERE "ruleset" = 'pf1e' AND "universe_id" IS NULL AND "key" LIKE '%\_kit');--> statement-breakpoint
DELETE FROM "items" WHERE "ruleset" = 'pf1e' AND "universe_id" IS NULL AND "key" LIKE '%\_kit';--> statement-breakpoint
INSERT INTO "items" ("ruleset", "key", "name", "type", "category", "types", "rulebook") VALUES
	('pf1e', 'book_of_puzzles', 'book of puzzles', '', 'gear', '{}', 'acg'),
	('pf1e', 'book_of_war_prayers', 'book of war prayers', '', 'gear', '{}', 'acg'),
	('pf1e', 'footprints_cast', 'footprints cast', '', 'gear', '{}', 'acg'),
	('pf1e', 'light_fire_ink', 'light fire ink', '', 'gear', '{}', 'acg'),
	('pf1e', 'tome_of_epics', 'tome of epics', '', 'gear', '{}', 'acg');--> statement-breakpoint
ALTER TABLE "items" ALTER COLUMN "category" SET NOT NULL;
