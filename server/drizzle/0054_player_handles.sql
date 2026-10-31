ALTER TYPE "public"."rate_limit_kind" ADD VALUE 'addressLoginAttempt';--> statement-breakpoint
ALTER TYPE "public"."rate_limit_kind" ADD VALUE 'networkLoginAttempt';--> statement-breakpoint
DROP INDEX "players_display_name_lower_unique";--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "handle" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "players_handle_lower_unique" ON "players" USING btree (lower("handle"));--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_handle_form" CHECK ("players"."handle" ~ '^[A-Za-z0-9_]{3,20}$');