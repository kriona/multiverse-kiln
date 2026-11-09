ALTER TABLE "map_chunks" RENAME TO "area_chunks";--> statement-breakpoint
ALTER TABLE "area_chunks" RENAME CONSTRAINT "map_chunks_area_id_layer_chunk_column_chunk_row_pk" TO "area_chunks_area_id_layer_chunk_column_chunk_row_pk";--> statement-breakpoint
ALTER TABLE "area_chunks" RENAME CONSTRAINT "map_chunks_area_id_areas_id_fk" TO "area_chunks_area_id_areas_id_fk";--> statement-breakpoint
ALTER TABLE "area_chunks" RENAME CONSTRAINT "map_chunks_cell_count" TO "area_chunks_cell_count";
