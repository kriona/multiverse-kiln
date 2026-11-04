ALTER TABLE "character_items" ADD COLUMN "hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "keep_playing" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "races" ADD COLUMN "keep_playing" boolean DEFAULT true NOT NULL;