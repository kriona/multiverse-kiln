CREATE TABLE "tile_graphics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"universe_id" uuid NOT NULL,
	"name" text NOT NULL,
	"draw_order" smallint NOT NULL,
	"storage_key" text NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tile_graphics_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "tile_graphics_draw_order_range" CHECK ("tile_graphics"."draw_order" BETWEEN 1 AND 99)
);
--> statement-breakpoint
ALTER TABLE "tiles" ADD COLUMN "uploaded_graphic_id" uuid;--> statement-breakpoint
ALTER TABLE "tile_graphics" ADD CONSTRAINT "tile_graphics_universe_id_universes_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tile_graphics" ADD CONSTRAINT "tile_graphics_uploaded_by_players_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tile_graphics_universe_id_index" ON "tile_graphics" USING btree ("universe_id");--> statement-breakpoint
ALTER TABLE "tiles" ADD CONSTRAINT "tiles_uploaded_graphic_id_tile_graphics_id_fk" FOREIGN KEY ("uploaded_graphic_id") REFERENCES "public"."tile_graphics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tiles" ADD CONSTRAINT "tiles_one_graphic" CHECK ("tiles"."graphic" IS NULL OR "tiles"."uploaded_graphic_id" IS NULL);