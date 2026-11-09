ALTER TABLE "areas" DROP CONSTRAINT "areas_width";--> statement-breakpoint
ALTER TABLE "areas" DROP CONSTRAINT "areas_height";--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_width" CHECK ("areas"."max_column" - "areas"."min_column" BETWEEN 0 AND 511);--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_height" CHECK ("areas"."max_row" - "areas"."min_row" BETWEEN 0 AND 511);