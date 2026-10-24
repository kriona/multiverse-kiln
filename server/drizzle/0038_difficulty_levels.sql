CREATE TABLE "difficulty_levels" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "difficulty_levels_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"universe_id" uuid NOT NULL,
	"key" text,
	"name" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"mob_scale" smallint DEFAULT 0 NOT NULL,
	"permadeath" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "difficulty_levels_universe_key_unique" UNIQUE("universe_id","key"),
	CONSTRAINT "difficulty_levels_name_required" CHECK ("difficulty_levels"."name" IS NOT NULL OR "difficulty_levels"."key" IS NOT NULL),
	CONSTRAINT "difficulty_levels_mob_scale_range" CHECK ("difficulty_levels"."mob_scale" BETWEEN -1000 AND 1000)
);
--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "difficulty_level_id" integer;--> statement-breakpoint
ALTER TABLE "difficulty_levels" ADD CONSTRAINT "difficulty_levels_universe_id_universes_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "difficulty_levels_universe_id_index" ON "difficulty_levels" USING btree ("universe_id");--> statement-breakpoint
CREATE UNIQUE INDEX "difficulty_levels_one_default" ON "difficulty_levels" USING btree ("universe_id") WHERE "difficulty_levels"."is_default";--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_difficulty_level_id_difficulty_levels_id_fk" FOREIGN KEY ("difficulty_level_id") REFERENCES "public"."difficulty_levels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "groups_difficulty_level_id_index" ON "groups" USING btree ("difficulty_level_id");