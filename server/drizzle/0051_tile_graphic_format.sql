CREATE TYPE "public"."tile_graphic_format" AS ENUM('dualGrid', 'blob');--> statement-breakpoint
ALTER TABLE "tile_graphics" ALTER COLUMN "draw_order" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tile_graphics" ADD COLUMN "format" "tile_graphic_format" DEFAULT 'dualGrid' NOT NULL;--> statement-breakpoint
ALTER TABLE "tile_graphics" ADD CONSTRAINT "tile_graphics_draw_order_format" CHECK (("tile_graphics"."format" = 'blob') = ("tile_graphics"."draw_order" IS NULL));