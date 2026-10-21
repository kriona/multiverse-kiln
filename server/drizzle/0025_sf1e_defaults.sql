-- The default tiles, items, races, classes and themes every Starfinder 1E universe starts with
-- (DEFAULT_TILE_NAMES, DEFAULT_ITEM_NAMES, SF1E_RACES, SF1E_CLASSES and SF1E_THEMES in /shared)
INSERT INTO "tiles" ("ruleset", "key", "name", "indoors", "color", "vision_cost", "movement_cost") VALUES
	('sf1e', 'grass', 'Grass', false, x'7AFF3D'::int, 0, 0),
	('sf1e', 'sand', 'Sand', false, x'D9C27A'::int, 0, 50),
	('sf1e', 'rock', 'Rock', false, x'6B6B6B'::int, 100, 100),
	('sf1e', 'water', 'Water', false, x'3D97FF'::int, 0, 100),
	('sf1e', 'metal_floor', 'Metal Floor', true, x'9AA4AE'::int, 0, 0),
	('sf1e', 'bulkhead', 'Bulkhead', true, x'4A5560'::int, 100, 100);
--> statement-breakpoint
INSERT INTO "items" ("ruleset", "key", "name", "type") VALUES
	('sf1e', 'survival_knife', 'survival knife', 'survival_knife');
--> statement-breakpoint
INSERT INTO "races" ("ruleset", "key", "name") VALUES
	('sf1e', 'android', 'Android'),
	('sf1e', 'human', 'Human'),
	('sf1e', 'kasatha', 'Kasatha'),
	('sf1e', 'lashunta', 'Lashunta'),
	('sf1e', 'shirren', 'Shirren'),
	('sf1e', 'vesk', 'Vesk'),
	('sf1e', 'ysoki', 'Ysoki');
--> statement-breakpoint
INSERT INTO "sf1e_races" ("race_id", "strength_modifier", "dexterity_modifier", "constitution_modifier", "intelligence_modifier", "wisdom_modifier", "charisma_modifier", "floating_bonus", "darkvision", "size", "hit_points")
SELECT "races"."id", "rules"."strength", "rules"."dexterity", "rules"."constitution", "rules"."intelligence", "rules"."wisdom", "rules"."charisma", "rules"."floating_bonus", "rules"."darkvision", "rules"."size"::"sf1e_size", "rules"."hit_points"
FROM (VALUES
	('android', 0, 2, 0, 2, 0, -2, false, true, 'medium', 4),
	('human', 0, 0, 0, 0, 0, 0, true, false, 'medium', 4),
	('kasatha', 2, 0, 0, -2, 2, 0, false, false, 'medium', 4),
	('lashunta', 0, 0, 0, 0, 0, 2, false, false, 'medium', 4),
	('shirren', 0, 0, 2, 0, 2, -2, false, false, 'medium', 6),
	('vesk', 2, 0, 2, -2, 0, 0, false, false, 'medium', 6),
	('ysoki', -2, 2, 0, 2, 0, 0, false, true, 'small', 2)
) AS "rules" ("key", "strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma", "floating_bonus", "darkvision", "size", "hit_points")
JOIN "races" ON "races"."ruleset" = 'sf1e'
	AND "races"."universe_id" IS NULL
	AND "races"."key" = "rules"."key";
--> statement-breakpoint
INSERT INTO "classes" ("ruleset", "key", "name") VALUES
	('sf1e', 'envoy', 'Envoy'),
	('sf1e', 'mechanic', 'Mechanic'),
	('sf1e', 'mystic', 'Mystic'),
	('sf1e', 'operative', 'Operative'),
	('sf1e', 'solarian', 'Solarian'),
	('sf1e', 'soldier', 'Soldier'),
	('sf1e', 'technomancer', 'Technomancer');
--> statement-breakpoint
INSERT INTO "sf1e_classes" ("class_id", "key_ability", "hit_points", "stamina_points")
SELECT "classes"."id", "rules"."key_ability"::"sf1e_ability", "rules"."hit_points", "rules"."stamina_points"
FROM (VALUES
	('envoy', 'charisma', 6, 6),
	('mechanic', 'intelligence', 6, 6),
	('mystic', 'wisdom', 6, 6),
	('operative', 'dexterity', 6, 6),
	('solarian', 'charisma', 7, 7),
	('soldier', 'strength', 7, 7),
	('technomancer', 'intelligence', 5, 5)
) AS "rules" ("key", "key_ability", "hit_points", "stamina_points")
JOIN "classes" ON "classes"."ruleset" = 'sf1e'
	AND "classes"."universe_id" IS NULL
	AND "classes"."key" = "rules"."key";
--> statement-breakpoint
INSERT INTO "themes" ("ruleset", "key", "name") VALUES
	('sf1e', 'ace_pilot', 'Ace Pilot'),
	('sf1e', 'bounty_hunter', 'Bounty Hunter'),
	('sf1e', 'icon', 'Icon'),
	('sf1e', 'mercenary', 'Mercenary'),
	('sf1e', 'outlaw', 'Outlaw'),
	('sf1e', 'priest', 'Priest'),
	('sf1e', 'scholar', 'Scholar'),
	('sf1e', 'spacefarer', 'Spacefarer'),
	('sf1e', 'xenoseeker', 'Xenoseeker');
--> statement-breakpoint
INSERT INTO "sf1e_themes" ("theme_id", "ability")
SELECT "themes"."id", "rules"."ability"::"sf1e_ability"
FROM (VALUES
	('ace_pilot', 'dexterity'),
	('bounty_hunter', 'constitution'),
	('icon', 'charisma'),
	('mercenary', 'strength'),
	('outlaw', 'dexterity'),
	('priest', 'wisdom'),
	('scholar', 'intelligence'),
	('spacefarer', 'constitution'),
	('xenoseeker', 'charisma')
) AS "rules" ("key", "ability")
JOIN "themes" ON "themes"."ruleset" = 'sf1e'
	AND "themes"."universe_id" IS NULL
	AND "themes"."key" = "rules"."key";
