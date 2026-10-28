CREATE TYPE "public"."darkvision" AS ENUM('none', 'normal', 'superior');--> statement-breakpoint
ALTER TABLE "tiles" DROP CONSTRAINT "tiles_walk_seconds_range";--> statement-breakpoint
ALTER TABLE "pf1e_races" ALTER COLUMN "darkvision" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "pf1e_races" ALTER COLUMN "darkvision" SET DATA TYPE "public"."darkvision" USING (CASE WHEN "darkvision" THEN 'normal' ELSE 'none' END)::"public"."darkvision";--> statement-breakpoint
ALTER TABLE "pf1e_races" ALTER COLUMN "darkvision" SET DEFAULT 'none'::"public"."darkvision";--> statement-breakpoint
ALTER TABLE "sf1e_races" ALTER COLUMN "darkvision" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "sf1e_races" ALTER COLUMN "darkvision" SET DATA TYPE "public"."darkvision" USING (CASE WHEN "darkvision" THEN 'normal' ELSE 'none' END)::"public"."darkvision";--> statement-breakpoint
ALTER TABLE "sf1e_races" ALTER COLUMN "darkvision" SET DEFAULT 'none'::"public"."darkvision";--> statement-breakpoint
ALTER TABLE "pf1e_races" ADD COLUMN "light_sensitivity" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sf1e_races" ADD COLUMN "light_sensitivity" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tiles" ADD CONSTRAINT "tiles_walk_seconds_range" CHECK ("tiles"."walk_seconds" BETWEEN 0 AND 36000);