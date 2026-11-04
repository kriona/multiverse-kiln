CREATE TYPE "public"."universe_text_field" AS ENUM('name', 'shortDescription', 'longDescription');--> statement-breakpoint
CREATE TYPE "public"."universe_text_kind" AS ENUM('universe', 'area', 'tile', 'item', 'race', 'class', 'theme', 'difficultyLevel');--> statement-breakpoint
CREATE TABLE "universe_translations" (
	"universe_id" uuid NOT NULL,
	"kind" "universe_text_kind" NOT NULL,
	"thing_id" text NOT NULL,
	"field" "universe_text_field" NOT NULL,
	"language" text NOT NULL,
	"text" text NOT NULL,
	"source_hash" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "universe_translations_universe_id_kind_thing_id_field_language_pk" PRIMARY KEY("universe_id","kind","thing_id","field","language"),
	CONSTRAINT "universe_translations_language_length" CHECK (char_length("universe_translations"."language") BETWEEN 1 AND 35),
	CONSTRAINT "universe_translations_text_length" CHECK (char_length("universe_translations"."text") <= 20000),
	CONSTRAINT "universe_translations_source_hash_form" CHECK ("universe_translations"."source_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "universe_translator_notes" (
	"universe_id" uuid NOT NULL,
	"kind" "universe_text_kind" NOT NULL,
	"thing_id" text NOT NULL,
	"field" "universe_text_field" NOT NULL,
	"note" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "universe_translator_notes_universe_id_kind_thing_id_field_pk" PRIMARY KEY("universe_id","kind","thing_id","field"),
	CONSTRAINT "universe_translator_notes_note_length" CHECK (char_length("universe_translator_notes"."note") BETWEEN 1 AND 1000)
);
--> statement-breakpoint
ALTER TABLE "universes" ADD COLUMN "source_language" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "universes" ADD COLUMN "translation_languages" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "universe_translations" ADD CONSTRAINT "universe_translations_universe_id_universes_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "universe_translator_notes" ADD CONSTRAINT "universe_translator_notes_universe_id_universes_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "universes" ADD CONSTRAINT "universes_source_language_length" CHECK (char_length("universes"."source_language") BETWEEN 1 AND 35);--> statement-breakpoint
ALTER TABLE "universes" ADD CONSTRAINT "universes_translation_languages_count" CHECK (cardinality("universes"."translation_languages") <= 50);--> statement-breakpoint
ALTER TABLE "universes" ADD CONSTRAINT "universes_translation_languages_not_source" CHECK (NOT ("universes"."source_language" = ANY("universes"."translation_languages")));