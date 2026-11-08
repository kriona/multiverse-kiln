ALTER TYPE "public"."universe_role" ADD VALUE 'translator';--> statement-breakpoint
ALTER TABLE "universe_editors" ADD COLUMN "languages" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "universe_editors" ADD CONSTRAINT "universe_editors_languages_count" CHECK (cardinality("universe_editors"."languages") <= 20);--> statement-breakpoint
ALTER TABLE "universe_editors" ADD CONSTRAINT "universe_editors_languages_translator" CHECK ("universe_editors"."role"::text = 'translator' OR cardinality("universe_editors"."languages") = 0);