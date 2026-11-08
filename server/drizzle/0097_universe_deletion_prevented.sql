ALTER TABLE "admin_events" ADD COLUMN "prevents_deletion" boolean;--> statement-breakpoint
ALTER TABLE "universes" ADD COLUMN "deletion_prevented" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "universes" ADD CONSTRAINT "universes_deletion_prevented_disabled" CHECK (NOT "universes"."deletion_prevented" OR ("universes"."disabled_at" IS NOT NULL));