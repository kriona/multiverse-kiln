-- Handles are called usernames. Renaming the column keeps its values, and the check and index follow it
ALTER TABLE "players" RENAME COLUMN "handle" TO "username";--> statement-breakpoint
ALTER INDEX "players_handle_lower_unique" RENAME TO "players_username_lower_unique";--> statement-breakpoint
ALTER TABLE "players" RENAME CONSTRAINT "players_handle_form" TO "players_username_form";
