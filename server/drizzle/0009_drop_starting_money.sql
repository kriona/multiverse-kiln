-- Starting money was one total in copper pieces; keep it as that many copper pieces
UPDATE "universes" SET "starting_copper" = "starting_money";--> statement-breakpoint
ALTER TABLE "universes" DROP COLUMN "starting_money";
