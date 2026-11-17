-- The Pathfinder 1E races of the Advanced Race Guide and classes of the Advanced Class Guide that weren't
-- default races and classes yet (PF1E_RACES, PF1E_CLASSES and PF1E_RACE_RULEBOOKS in /shared,
-- STRUCTURE-OVERVIEW.md, Races and Classes). Universes see them only once they turn their book on
INSERT INTO "races" ("ruleset", "key", "name", "rulebook") VALUES
	('pf1e', 'aasimar', 'Aasimar', 'arg'),
	('pf1e', 'changeling', 'Changeling', 'arg'),
	('pf1e', 'dhampir', 'Dhampir', 'arg'),
	('pf1e', 'duergar', 'Duergar', 'arg'),
	('pf1e', 'fetchling', 'Fetchling', 'arg'),
	('pf1e', 'gillman', 'Gillman', 'arg'),
	('pf1e', 'grippli', 'Grippli', 'arg'),
	('pf1e', 'ifrit', 'Ifrit', 'arg'),
	('pf1e', 'kitsune', 'Kitsune', 'arg'),
	('pf1e', 'kobold', 'Kobold', 'arg'),
	('pf1e', 'merfolk', 'Merfolk', 'arg'),
	('pf1e', 'nagaji', 'Nagaji', 'arg'),
	('pf1e', 'orc', 'Orc', 'arg'),
	('pf1e', 'oread', 'Oread', 'arg'),
	('pf1e', 'samsaran', 'Samsaran', 'arg'),
	('pf1e', 'strix', 'Strix', 'arg'),
	('pf1e', 'suli', 'Suli', 'arg'),
	('pf1e', 'svirfneblin', 'Svirfneblin', 'arg'),
	('pf1e', 'sylph', 'Sylph', 'arg'),
	('pf1e', 'tengu', 'Tengu', 'arg'),
	('pf1e', 'tiefling', 'Tiefling', 'arg'),
	('pf1e', 'undine', 'Undine', 'arg'),
	('pf1e', 'vanara', 'Vanara', 'arg'),
	('pf1e', 'vishkanya', 'Vishkanya', 'arg'),
	('pf1e', 'wayang', 'Wayang', 'arg');
--> statement-breakpoint
INSERT INTO "pf1e_races" ("race_id", "strength_modifier", "dexterity_modifier", "constitution_modifier", "intelligence_modifier", "wisdom_modifier", "charisma_modifier", "floating_bonus", "darkvision", "light_sensitivity", "size")
SELECT "races"."id", "rules"."strength", "rules"."dexterity", "rules"."constitution", "rules"."intelligence", "rules"."wisdom", "rules"."charisma", false, "rules"."darkvision"::"darkvision", "rules"."light_sensitivity", "rules"."size"::"pf1e_size"
FROM (VALUES
	('aasimar', 0, 0, 0, 0, 2, 2, 'normal', false, 'medium'),
	('changeling', 0, 0, -2, 0, 2, 2, 'normal', false, 'medium'),
	('dhampir', 0, 2, -2, 0, 0, 2, 'normal', true, 'medium'),
	('duergar', 0, 0, 2, 0, 2, -4, 'superior', true, 'medium'),
	('fetchling', 0, 2, 0, 0, -2, 2, 'normal', false, 'medium'),
	('gillman', 0, 0, 2, 0, -2, 2, 'none', false, 'medium'),
	('grippli', -2, 2, 0, 0, 2, 0, 'normal', false, 'small'),
	('ifrit', 0, 2, 0, 0, -2, 2, 'normal', false, 'medium'),
	('kitsune', -2, 2, 0, 0, 0, 2, 'none', false, 'medium'),
	('kobold', -4, 2, -2, 0, 0, 0, 'normal', true, 'small'),
	('merfolk', 0, 2, 2, 0, 0, 2, 'none', false, 'medium'),
	('nagaji', 2, 0, 0, -2, 0, 2, 'none', false, 'medium'),
	('orc', 4, 0, 0, -2, -2, -2, 'normal', true, 'medium'),
	('oread', 2, 0, 0, 0, 2, -2, 'normal', false, 'medium'),
	('samsaran', 0, 0, -2, 2, 2, 0, 'none', false, 'medium'),
	('strix', 0, 2, 0, 0, 0, -2, 'normal', false, 'medium'),
	('suli', 2, 0, 0, -2, 0, 2, 'none', false, 'medium'),
	('svirfneblin', -2, 2, 0, 0, 2, -4, 'superior', false, 'small'),
	('sylph', 0, 2, -2, 2, 0, 0, 'normal', false, 'medium'),
	('tengu', 0, 2, -2, 0, 2, 0, 'none', false, 'medium'),
	('tiefling', 0, 2, 0, 2, 0, -2, 'normal', false, 'medium'),
	('undine', -2, 2, 0, 0, 2, 0, 'normal', false, 'medium'),
	('vanara', 0, 2, 0, 0, 2, -2, 'none', false, 'medium'),
	('vishkanya', 0, 2, 0, 0, -2, 2, 'none', false, 'medium'),
	('wayang', 0, 2, 0, 2, -2, 0, 'normal', false, 'small')
) AS "rules" ("key", "strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma", "darkvision", "light_sensitivity", "size")
JOIN "races" ON "races"."ruleset" = 'pf1e'
	AND "races"."universe_id" IS NULL
	AND "races"."key" = "rules"."key";
--> statement-breakpoint
INSERT INTO "classes" ("ruleset", "key", "name", "rulebook") VALUES
	('pf1e', 'arcanist', 'Arcanist', 'acg'),
	('pf1e', 'bloodrager', 'Bloodrager', 'acg'),
	('pf1e', 'brawler', 'Brawler', 'acg'),
	('pf1e', 'hunter', 'Hunter', 'acg'),
	('pf1e', 'investigator', 'Investigator', 'acg'),
	('pf1e', 'shaman', 'Shaman', 'acg'),
	('pf1e', 'skald', 'Skald', 'acg'),
	('pf1e', 'slayer', 'Slayer', 'acg'),
	('pf1e', 'swashbuckler', 'Swashbuckler', 'acg'),
	('pf1e', 'warpriest', 'Warpriest', 'acg');
--> statement-breakpoint
INSERT INTO "pf1e_classes" ("class_id", "primary_ability", "tradition", "casting_style")
SELECT "classes"."id", "rules"."primary_ability"::"pf1e_ability", "rules"."tradition"::"pf1e_magic_tradition", "rules"."casting_style"::"pf1e_casting_style"
FROM (VALUES
	('arcanist', 'intelligence', 'arcane', 'prepared'),
	('bloodrager', 'strength', 'arcane', 'spontaneous'),
	('brawler', 'strength', 'none', 'none'),
	('hunter', 'wisdom', 'divine', 'spontaneous'),
	('investigator', 'intelligence', 'arcane', 'prepared'),
	('shaman', 'wisdom', 'divine', 'prepared'),
	('skald', 'charisma', 'arcane', 'spontaneous'),
	('slayer', 'dexterity', 'none', 'none'),
	('swashbuckler', 'dexterity', 'none', 'none'),
	('warpriest', 'wisdom', 'divine', 'prepared')
) AS "rules" ("key", "primary_ability", "tradition", "casting_style")
JOIN "classes" ON "classes"."ruleset" = 'pf1e'
	AND "classes"."universe_id" IS NULL
	AND "classes"."key" = "rules"."key";
