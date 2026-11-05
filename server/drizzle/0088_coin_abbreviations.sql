ALTER TYPE "public"."universe_text_kind" ADD VALUE 'coin';--> statement-breakpoint
ALTER TABLE "universe_drafts" ADD COLUMN "platinum_abbreviation" text;--> statement-breakpoint
ALTER TABLE "universe_drafts" ADD COLUMN "gold_abbreviation" text;--> statement-breakpoint
ALTER TABLE "universe_drafts" ADD COLUMN "silver_abbreviation" text;--> statement-breakpoint
ALTER TABLE "universe_drafts" ADD COLUMN "copper_abbreviation" text;--> statement-breakpoint
ALTER TABLE "universe_drafts" ADD COLUMN "credits_abbreviation" text;--> statement-breakpoint
ALTER TABLE "universes" ADD COLUMN "platinum_abbreviation" text;--> statement-breakpoint
ALTER TABLE "universes" ADD COLUMN "gold_abbreviation" text;--> statement-breakpoint
ALTER TABLE "universes" ADD COLUMN "silver_abbreviation" text;--> statement-breakpoint
ALTER TABLE "universes" ADD COLUMN "copper_abbreviation" text;--> statement-breakpoint
ALTER TABLE "universes" ADD COLUMN "credits_abbreviation" text;--> statement-breakpoint
ALTER TABLE "universe_drafts" ADD CONSTRAINT "universe_drafts_coin_abbreviations_length" CHECK (char_length("universe_drafts"."platinum_abbreviation") BETWEEN 1 AND 10 AND char_length("universe_drafts"."gold_abbreviation") BETWEEN 1 AND 10 AND char_length("universe_drafts"."silver_abbreviation") BETWEEN 1 AND 10 AND char_length("universe_drafts"."copper_abbreviation") BETWEEN 1 AND 10 AND char_length("universe_drafts"."credits_abbreviation") BETWEEN 1 AND 10);--> statement-breakpoint
ALTER TABLE "universes" ADD CONSTRAINT "universes_coin_abbreviations_length" CHECK (char_length("universes"."platinum_abbreviation") BETWEEN 1 AND 10 AND char_length("universes"."gold_abbreviation") BETWEEN 1 AND 10 AND char_length("universes"."silver_abbreviation") BETWEEN 1 AND 10 AND char_length("universes"."copper_abbreviation") BETWEEN 1 AND 10 AND char_length("universes"."credits_abbreviation") BETWEEN 1 AND 10);