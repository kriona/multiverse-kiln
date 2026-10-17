-- The default races and classes every Pathfinder 1E universe starts with (PF1E_RACES and PF1E_CLASSES in /shared,
-- STRUCTURE-OVERVIEW.md, Tab: Races and Tab: Classes)
INSERT INTO "races" ("ruleset", "key", "name") VALUES
	('pf1e', 'catfolk', 'Catfolk'),
	('pf1e', 'drow', 'Drow'),
	('pf1e', 'dwarf', 'Dwarf'),
	('pf1e', 'elf', 'Elf'),
	('pf1e', 'gnome', 'Gnome'),
	('pf1e', 'goblin', 'Goblin'),
	('pf1e', 'half_elf', 'Half-Elf'),
	('pf1e', 'half_orc', 'Half-Orc'),
	('pf1e', 'halfling', 'Halfling'),
	('pf1e', 'hobgoblin', 'Hobgoblin'),
	('pf1e', 'human', 'Human'),
	('pf1e', 'ratfolk', 'Ratfolk');
--> statement-breakpoint
INSERT INTO "pf1e_races" ("race_id", "strength_modifier", "dexterity_modifier", "constitution_modifier", "intelligence_modifier", "wisdom_modifier", "charisma_modifier", "floating_bonus", "darkvision", "size")
SELECT "races"."id", "rules"."strength", "rules"."dexterity", "rules"."constitution", "rules"."intelligence", "rules"."wisdom", "rules"."charisma", "rules"."floating_bonus", "rules"."darkvision", "rules"."size"::"pf1e_size"
FROM (VALUES
	('catfolk', 0, 2, 0, 0, -2, 2, false, false, 'medium'),
	('drow', 0, 2, -2, 0, 0, 2, false, true, 'medium'),
	('dwarf', 0, 0, 2, 0, 2, -2, false, true, 'medium'),
	('elf', 0, 2, -2, 2, 0, 0, false, false, 'medium'),
	('gnome', -2, 0, 2, 0, 0, 2, false, false, 'small'),
	('goblin', -2, 4, 0, 0, 0, -2, false, true, 'small'),
	('half_elf', 0, 0, 0, 0, 0, 0, true, false, 'medium'),
	('half_orc', 0, 0, 0, 0, 0, 0, true, true, 'medium'),
	('halfling', -2, 2, 0, 0, 0, 2, false, false, 'small'),
	('hobgoblin', 0, 2, 2, 0, 0, 0, false, true, 'medium'),
	('human', 0, 0, 0, 0, 0, 0, true, false, 'medium'),
	('ratfolk', -2, 2, 0, 2, 0, 0, false, true, 'small')
) AS "rules" ("key", "strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma", "floating_bonus", "darkvision", "size")
JOIN "races" ON "races"."ruleset" = 'pf1e'
	AND "races"."universe_id" IS NULL
	AND "races"."key" = "rules"."key";
--> statement-breakpoint
INSERT INTO "classes" ("ruleset", "key", "name") VALUES
	('pf1e', 'alchemist', 'Alchemist'),
	('pf1e', 'barbarian', 'Barbarian'),
	('pf1e', 'bard', 'Bard'),
	('pf1e', 'cavalier', 'Cavalier'),
	('pf1e', 'cleric', 'Cleric'),
	('pf1e', 'druid', 'Druid'),
	('pf1e', 'fighter', 'Fighter'),
	('pf1e', 'inquisitor', 'Inquisitor'),
	('pf1e', 'monk', 'Monk'),
	('pf1e', 'oracle', 'Oracle'),
	('pf1e', 'paladin', 'Paladin'),
	('pf1e', 'ranger', 'Ranger'),
	('pf1e', 'rogue', 'Rogue'),
	('pf1e', 'sorcerer', 'Sorcerer'),
	('pf1e', 'summoner', 'Summoner'),
	('pf1e', 'witch', 'Witch'),
	('pf1e', 'wizard', 'Wizard');
--> statement-breakpoint
INSERT INTO "pf1e_classes" ("class_id", "primary_ability", "tradition", "casting_style")
SELECT "classes"."id", "rules"."primary_ability"::"pf1e_ability", "rules"."tradition"::"pf1e_magic_tradition", "rules"."casting_style"::"pf1e_casting_style"
FROM (VALUES
	('alchemist', 'intelligence', 'arcane', 'prepared'),
	('barbarian', 'strength', 'none', 'none'),
	('bard', 'charisma', 'arcane', 'spontaneous'),
	('cavalier', 'strength', 'none', 'none'),
	('cleric', 'wisdom', 'divine', 'prepared'),
	('druid', 'wisdom', 'divine', 'prepared'),
	('fighter', 'strength', 'none', 'none'),
	('inquisitor', 'wisdom', 'divine', 'spontaneous'),
	('monk', 'wisdom', 'none', 'none'),
	('oracle', 'charisma', 'divine', 'spontaneous'),
	('paladin', 'strength', 'divine', 'prepared'),
	('ranger', 'dexterity', 'divine', 'prepared'),
	('rogue', 'dexterity', 'none', 'none'),
	('sorcerer', 'charisma', 'arcane', 'spontaneous'),
	('summoner', 'charisma', 'arcane', 'spontaneous'),
	('witch', 'intelligence', 'arcane', 'prepared'),
	('wizard', 'intelligence', 'arcane', 'prepared')
) AS "rules" ("key", "primary_ability", "tradition", "casting_style")
JOIN "classes" ON "classes"."ruleset" = 'pf1e'
	AND "classes"."universe_id" IS NULL
	AND "classes"."key" = "rules"."key";
