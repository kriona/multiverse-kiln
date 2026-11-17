ALTER TYPE "public"."universe_text_field" ADD VALUE 'description';--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "races" ADD COLUMN "description" text;