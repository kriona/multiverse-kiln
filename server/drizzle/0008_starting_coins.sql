ALTER TABLE "universes" DROP CONSTRAINT "universes_starting_money_range";--> statement-breakpoint
ALTER TABLE "universes" ADD COLUMN "starting_platinum" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "universes" ADD COLUMN "starting_gold" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "universes" ADD COLUMN "starting_silver" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "universes" ADD COLUMN "starting_copper" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "universes" ADD CONSTRAINT "universes_starting_coins_range" CHECK ("universes"."starting_platinum" BETWEEN 0 AND 1000000000 AND "universes"."starting_gold" BETWEEN 0 AND 1000000000 AND "universes"."starting_silver" BETWEEN 0 AND 1000000000 AND "universes"."starting_copper" BETWEEN 0 AND 1000000000);