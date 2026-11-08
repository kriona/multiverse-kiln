ALTER TABLE "universe_edits" DROP COLUMN "change_counts";--> statement-breakpoint
UPDATE "universe_edits" SET "change_details" = NULL WHERE jsonb_path_exists("change_details", '$[*].fields[*] ? (@.type() == "string")');
