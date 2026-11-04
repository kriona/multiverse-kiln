ALTER TABLE "admin_events" ALTER COLUMN "kind" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."admin_event_kind";--> statement-breakpoint
CREATE TYPE "public"."admin_event_kind" AS ENUM('adminAdded', 'adminRemoved', 'universeDisabled', 'universeEnabled');--> statement-breakpoint
ALTER TABLE "admin_events" ALTER COLUMN "kind" SET DATA TYPE "public"."admin_event_kind" USING "kind"::"public"."admin_event_kind";