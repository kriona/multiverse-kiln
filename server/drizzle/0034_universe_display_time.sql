CREATE TYPE "public"."display_time" AS ENUM('precise', 'rough', 'none');--> statement-breakpoint
ALTER TABLE "universes" ADD COLUMN "display_time" "display_time" DEFAULT 'precise' NOT NULL;