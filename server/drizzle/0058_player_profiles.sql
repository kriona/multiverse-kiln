ALTER TABLE "characters" ADD COLUMN "visible_on_profile" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "locale" text;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "pronouns" text;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "time_zone" text;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "discord_username" text;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "facebook_username" text;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "instagram_username" text;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "tiktok_username" text;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "show_characters" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_locale_length" CHECK (char_length("players"."locale") <= 35);--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_pronouns_length" CHECK (char_length("players"."pronouns") <= 40);--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_location_length" CHECK (char_length("players"."location") <= 100);--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_social_usernames_length" CHECK (char_length("players"."discord_username") <= 50 AND char_length("players"."facebook_username") <= 50 AND char_length("players"."instagram_username") <= 50 AND char_length("players"."tiktok_username") <= 50);