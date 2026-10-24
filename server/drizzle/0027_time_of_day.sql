CREATE TYPE "public"."lobby_passage_of_time" AS ENUM('always_dawn', 'always_noon', 'always_dusk', 'always_midnight', 'real_time', 'faerie');--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "clock_seconds" double precision DEFAULT 28800 NOT NULL;--> statement-breakpoint
ALTER TABLE "universes" ADD COLUMN "lobby_passage_of_time" "lobby_passage_of_time" DEFAULT 'real_time' NOT NULL;--> statement-breakpoint
ALTER TABLE "universes" ADD COLUMN "lobby_day_hours" smallint DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "universes" ADD COLUMN "lobby_faerie_morning" "faerie_morning";--> statement-breakpoint
ALTER TABLE "universes" ADD CONSTRAINT "universes_lobby_faerie_morning_set" CHECK (("universes"."lobby_passage_of_time" = 'faerie') = ("universes"."lobby_faerie_morning" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "universes" ADD CONSTRAINT "universes_lobby_day_hours_range" CHECK ("universes"."lobby_day_hours" BETWEEN 1 AND 240);