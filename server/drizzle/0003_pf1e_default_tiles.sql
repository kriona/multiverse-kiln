-- The default tiles every Pathfinder 1E universe starts with (STRUCTURE-OVERVIEW.md, Tab: Tilesets)
INSERT INTO "tiles" ("ruleset", "key", "name", "indoors", "color", "vision_cost", "movement_cost") VALUES
	('pf1e', 'grass', 'Grass', false, x'7AFF3D'::int, 0, 0),
	('pf1e', 'forest', 'Forest', false, x'00AA11'::int, 50, 50),
	('pf1e', 'desert', 'Desert', false, x'E5E500'::int, 0, 50),
	('pf1e', 'mountains', 'Mountains', false, x'777777'::int, 100, 100),
	('pf1e', 'water', 'Water', false, x'3D97FF'::int, 0, 100),
	('pf1e', 'wood_floor', 'Wood Floor', true, x'7A3202'::int, 0, 0);
