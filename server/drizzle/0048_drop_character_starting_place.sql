ALTER TABLE "characters" DROP CONSTRAINT "characters_area_id_areas_id_fk";
--> statement-breakpoint
DROP INDEX "characters_area_id_index";--> statement-breakpoint
ALTER TABLE "characters" DROP COLUMN "area_id";--> statement-breakpoint
ALTER TABLE "characters" DROP COLUMN "starting_column";--> statement-breakpoint
ALTER TABLE "characters" DROP COLUMN "starting_row";