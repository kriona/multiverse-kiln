ALTER TYPE "public"."universe_text_field" ADD VALUE 'abbreviation';--> statement-breakpoint
ALTER TABLE "universe_drafts" ADD COLUMN "platinum_name" text;--> statement-breakpoint
ALTER TABLE "universe_drafts" ADD COLUMN "gold_name" text;--> statement-breakpoint
ALTER TABLE "universe_drafts" ADD COLUMN "silver_name" text;--> statement-breakpoint
ALTER TABLE "universe_drafts" ADD COLUMN "copper_name" text;--> statement-breakpoint
ALTER TABLE "universe_drafts" ADD COLUMN "credits_name" text;--> statement-breakpoint
ALTER TABLE "universes" ADD COLUMN "platinum_name" text;--> statement-breakpoint
ALTER TABLE "universes" ADD COLUMN "gold_name" text;--> statement-breakpoint
ALTER TABLE "universes" ADD COLUMN "silver_name" text;--> statement-breakpoint
ALTER TABLE "universes" ADD COLUMN "copper_name" text;--> statement-breakpoint
ALTER TABLE "universes" ADD COLUMN "credits_name" text;--> statement-breakpoint
ALTER TABLE "universe_drafts" ADD CONSTRAINT "universe_drafts_coin_names_length" CHECK (char_length("universe_drafts"."platinum_name") BETWEEN 1 AND 30 AND char_length("universe_drafts"."gold_name") BETWEEN 1 AND 30 AND char_length("universe_drafts"."silver_name") BETWEEN 1 AND 30 AND char_length("universe_drafts"."copper_name") BETWEEN 1 AND 30 AND char_length("universe_drafts"."credits_name") BETWEEN 1 AND 30);--> statement-breakpoint
ALTER TABLE "universes" ADD CONSTRAINT "universes_coin_names_length" CHECK (char_length("universes"."platinum_name") BETWEEN 1 AND 30 AND char_length("universes"."gold_name") BETWEEN 1 AND 30 AND char_length("universes"."silver_name") BETWEEN 1 AND 30 AND char_length("universes"."copper_name") BETWEEN 1 AND 30 AND char_length("universes"."credits_name") BETWEEN 1 AND 30);