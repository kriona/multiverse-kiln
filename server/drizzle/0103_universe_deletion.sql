ALTER TYPE "public"."admin_event_kind" ADD VALUE 'universeDeleted';--> statement-breakpoint
ALTER TYPE "public"."email_code_purpose" ADD VALUE 'deleteUniverse';--> statement-breakpoint
ALTER TABLE "admin_events" ADD COLUMN "universe_name" text;