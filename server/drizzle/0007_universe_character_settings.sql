CREATE TYPE "public"."pf1e_stat_method" AS ENUM('roll_3d6', 'roll_3d6_reroll_ones', 'roll_4d6_drop_lowest', 'roll_4d6_reroll_ones_drop_lowest', 'point_buy_low_fantasy', 'point_buy_standard_fantasy', 'point_buy_high_fantasy', 'point_buy_epic_fantasy', 'point_buy_custom');--> statement-breakpoint
CREATE TABLE "pf1e_settings" (
	"universe_id" uuid PRIMARY KEY NOT NULL,
	"stat_method" "pf1e_stat_method" DEFAULT 'roll_4d6_drop_lowest' NOT NULL,
	"custom_point_buy_budget" smallint DEFAULT 15 NOT NULL,
	"needs_sleep" boolean DEFAULT false NOT NULL,
	"coins_have_weight" boolean DEFAULT false NOT NULL,
	"tracks_ammo" boolean DEFAULT false NOT NULL,
	CONSTRAINT "pf1e_settings_custom_point_buy_budget_range" CHECK ("pf1e_settings"."custom_point_buy_budget" BETWEEN 0 AND 102)
);
--> statement-breakpoint
ALTER TABLE "universes" ADD COLUMN "group_size" smallint DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE "universes" ADD COLUMN "starting_money" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pf1e_settings" ADD CONSTRAINT "pf1e_settings_universe_id_universes_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "universes" ADD CONSTRAINT "universes_group_size_range" CHECK ("universes"."group_size" BETWEEN 1 AND 6);--> statement-breakpoint
ALTER TABLE "universes" ADD CONSTRAINT "universes_starting_money_range" CHECK ("universes"."starting_money" BETWEEN 0 AND 1000000000);