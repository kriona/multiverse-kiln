ALTER TABLE "universe_drafts" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "universe_drafts" ADD COLUMN "source_language" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "universe_drafts" ADD COLUMN "translation_languages" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
-- Drafts started before now take the live version's name and languages
UPDATE "universe_drafts" AS d SET "name" = u."name", "source_language" = u."source_language", "translation_languages" = u."translation_languages" FROM "universes" AS u WHERE u."id" = d."universe_id";--> statement-breakpoint
ALTER TABLE "universe_drafts" ALTER COLUMN "name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "universe_drafts" ADD CONSTRAINT "universe_drafts_source_language_length" CHECK (char_length("universe_drafts"."source_language") BETWEEN 1 AND 35);--> statement-breakpoint
ALTER TABLE "universe_drafts" ADD CONSTRAINT "universe_drafts_translation_languages_count" CHECK (cardinality("universe_drafts"."translation_languages") <= 50);--> statement-breakpoint
ALTER TABLE "universe_drafts" ADD CONSTRAINT "universe_drafts_translation_languages_not_source" CHECK (NOT ("universe_drafts"."source_language" = ANY("universe_drafts"."translation_languages")));