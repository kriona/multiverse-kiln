ALTER TABLE "players" ADD COLUMN "languages" text;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_languages_length" CHECK (char_length("players"."languages") <= 100);