-- Each tile's walk seconds from its movement cost: 0% takes 10 seconds, 50% twice as long, and 100% can't be entered
UPDATE "tiles" SET "walk_seconds" = CASE
	WHEN "movement_cost" >= 100 THEN 0
	ELSE round(1000.0 / (100 - "movement_cost"))
END;
