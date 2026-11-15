ALTER TABLE "classes" ADD COLUMN "rulebook" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "rulebook" text;--> statement-breakpoint
ALTER TABLE "pf1e_settings" ADD COLUMN "rulebooks" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "pf1e_settings" ADD COLUMN "barred_rulebooks" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "races" ADD COLUMN "rulebook" text;--> statement-breakpoint
ALTER TABLE "sf1e_settings" ADD COLUMN "rulebooks" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "sf1e_settings" ADD COLUMN "barred_rulebooks" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "themes" ADD COLUMN "rulebook" text;--> statement-breakpoint
-- The book each default race, class, theme and item comes from (PF1E_RACE_RULEBOOKS and the like in /shared)
UPDATE "races" SET "rulebook" = 'core' WHERE "universe_id" IS NULL;--> statement-breakpoint
UPDATE "races" SET "rulebook" = 'arg' WHERE "universe_id" IS NULL AND "ruleset" = 'pf1e' AND "key" IN ('catfolk', 'drow', 'goblin', 'hobgoblin', 'ratfolk');--> statement-breakpoint
UPDATE "classes" SET "rulebook" = 'core' WHERE "universe_id" IS NULL;--> statement-breakpoint
UPDATE "classes" SET "rulebook" = 'apg' WHERE "universe_id" IS NULL AND "ruleset" = 'pf1e' AND "key" IN ('alchemist', 'cavalier', 'inquisitor', 'oracle', 'summoner', 'witch');--> statement-breakpoint
UPDATE "themes" SET "rulebook" = 'core' WHERE "universe_id" IS NULL;--> statement-breakpoint
UPDATE "items" SET "rulebook" = 'core' WHERE "universe_id" IS NULL;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_rulebook_on_defaults" CHECK (("classes"."universe_id" IS NULL) = ("classes"."rulebook" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_rulebook_on_defaults" CHECK (("items"."universe_id" IS NULL) = ("items"."rulebook" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "races" ADD CONSTRAINT "races_rulebook_on_defaults" CHECK (("races"."universe_id" IS NULL) = ("races"."rulebook" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "themes" ADD CONSTRAINT "themes_rulebook_on_defaults" CHECK (("themes"."universe_id" IS NULL) = ("themes"."rulebook" IS NOT NULL));