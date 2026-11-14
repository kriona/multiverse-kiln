ALTER TABLE "areas" ADD COLUMN "north_area_id" uuid;--> statement-breakpoint
ALTER TABLE "areas" ADD COLUMN "east_area_id" uuid;--> statement-breakpoint
ALTER TABLE "areas" ADD COLUMN "south_area_id" uuid;--> statement-breakpoint
ALTER TABLE "areas" ADD COLUMN "west_area_id" uuid;--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_north_area_id_areas_id_fk" FOREIGN KEY ("north_area_id") REFERENCES "public"."areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_east_area_id_areas_id_fk" FOREIGN KEY ("east_area_id") REFERENCES "public"."areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_south_area_id_areas_id_fk" FOREIGN KEY ("south_area_id") REFERENCES "public"."areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_west_area_id_areas_id_fk" FOREIGN KEY ("west_area_id") REFERENCES "public"."areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "areas_north_area_id_index" ON "areas" USING btree ("north_area_id");--> statement-breakpoint
CREATE INDEX "areas_east_area_id_index" ON "areas" USING btree ("east_area_id");--> statement-breakpoint
CREATE INDEX "areas_south_area_id_index" ON "areas" USING btree ("south_area_id");--> statement-breakpoint
CREATE INDEX "areas_west_area_id_index" ON "areas" USING btree ("west_area_id");--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_not_own_neighbor" CHECK ("areas"."id" NOT IN ("areas"."north_area_id", "areas"."east_area_id", "areas"."south_area_id", "areas"."west_area_id"));