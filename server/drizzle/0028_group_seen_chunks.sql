CREATE TABLE "group_seen_chunks" (
	"group_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"chunk_column" integer NOT NULL,
	"chunk_row" integer NOT NULL,
	"cells" "bytea" NOT NULL,
	CONSTRAINT "group_seen_chunks_group_id_area_id_chunk_column_chunk_row_pk" PRIMARY KEY("group_id","area_id","chunk_column","chunk_row"),
	CONSTRAINT "group_seen_chunks_cell_count" CHECK (octet_length("group_seen_chunks"."cells") = 128)
);
--> statement-breakpoint
ALTER TABLE "group_seen_chunks" ADD CONSTRAINT "group_seen_chunks_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_seen_chunks" ADD CONSTRAINT "group_seen_chunks_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_seen_chunks_area_id_index" ON "group_seen_chunks" USING btree ("area_id");