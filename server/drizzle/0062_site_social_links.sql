ALTER TABLE "site_settings" ADD COLUMN "discord_url" text;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "facebook_url" text;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "instagram_url" text;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "tiktok_url" text;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "x_url" text;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "youtube_url" text;--> statement-breakpoint
ALTER TABLE "site_settings" ADD CONSTRAINT "site_settings_social_urls_length" CHECK (char_length("site_settings"."discord_url") <= 500 AND char_length("site_settings"."facebook_url") <= 500 AND char_length("site_settings"."instagram_url") <= 500 AND char_length("site_settings"."tiktok_url") <= 500 AND char_length("site_settings"."x_url") <= 500 AND char_length("site_settings"."youtube_url") <= 500);