CREATE TYPE "public"."area_light_level" AS ENUM('lit', 'dark');--> statement-breakpoint
ALTER TABLE "areas" ADD COLUMN "light_level" "area_light_level" DEFAULT 'lit' NOT NULL;