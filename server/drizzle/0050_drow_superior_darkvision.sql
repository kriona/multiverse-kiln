-- Pathfinder's default drow have superior darkvision and light sensitivity, and so does each universe's
-- edited copy of them that still sees in the dark
UPDATE "pf1e_races" SET "darkvision" = 'superior', "light_sensitivity" = true
WHERE "race_id" IN (SELECT "id" FROM "races" WHERE "ruleset" = 'pf1e' AND "key" = 'drow' AND "universe_id" IS NULL)
	OR ("darkvision" = 'normal' AND "race_id" IN (
		SELECT "id" FROM "races" WHERE "overrides_race_id" IN (SELECT "id" FROM "races" WHERE "ruleset" = 'pf1e' AND "key" = 'drow' AND "universe_id" IS NULL)
	));
