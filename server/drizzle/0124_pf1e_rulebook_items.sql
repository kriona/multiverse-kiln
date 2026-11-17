-- The Pathfinder 1E items of the Advanced Player's Guide, Advanced Race Guide and Advanced Class Guide
-- (PF1E_DEFAULT_ITEM_NAMES and PF1E_ITEM_RULEBOOKS in /shared, scratchpad/rulebooks-rules.md for their
-- sources). Universes see them only once they turn their book on
INSERT INTO "items" ("ruleset", "key", "name", "type", "rulebook") VALUES
	('pf1e', 'cestus', 'cestus', 'cestus', 'apg'),
	('pf1e', 'sword_cane', 'sword cane', 'sword_cane', 'apg'),
	('pf1e', 'wooden_armor', 'wooden armor', 'wooden_armor', 'apg'),
	('pf1e', 'quilted_cloth', 'quilted cloth', 'quilted_cloth', 'apg'),
	('pf1e', 'kobold_long_lash', 'long lash tail attachment', 'kobold_long_lash', 'arg'),
	('pf1e', 'kobold_spiked_tail', 'spiked tail attachment', 'kobold_spiked_tail', 'arg'),
	('pf1e', 'ratfolk_tailblade', 'ratfolk tailblade', 'ratfolk_tailblade', 'arg'),
	('pf1e', 'arcanist_kit', 'arcanist''s kit', 'other_gear', 'acg'),
	('pf1e', 'bloodrager_kit', 'bloodrager''s kit', 'other_gear', 'acg'),
	('pf1e', 'brawler_kit', 'brawler''s kit', 'other_gear', 'acg'),
	('pf1e', 'hunter_kit', 'hunter''s kit', 'other_gear', 'acg'),
	('pf1e', 'investigator_kit', 'investigator''s kit', 'other_gear', 'acg'),
	('pf1e', 'shaman_kit', 'shaman''s kit', 'other_gear', 'acg'),
	('pf1e', 'skald_kit', 'skald''s kit', 'other_gear', 'acg'),
	('pf1e', 'slayer_kit', 'slayer''s kit', 'other_gear', 'acg'),
	('pf1e', 'swashbuckler_kit', 'swashbuckler''s kit', 'other_gear', 'acg'),
	('pf1e', 'warpriest_kit', 'warpriest''s kit', 'other_gear', 'acg');
