CREATE TABLE "site_settings" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"universe_creation_enabled" boolean DEFAULT true NOT NULL,
	"universes_per_creator" integer DEFAULT 5 NOT NULL,
	CONSTRAINT "site_settings_one_row" CHECK ("site_settings"."id"),
	CONSTRAINT "site_settings_universes_per_creator_range" CHECK ("site_settings"."universes_per_creator" BETWEEN 1 AND 1000)
);
