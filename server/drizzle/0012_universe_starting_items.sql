CREATE TABLE "universe_starting_items" (
	"universe_id" uuid NOT NULL,
	"item_id" integer NOT NULL,
	"quantity" smallint NOT NULL,
	CONSTRAINT "universe_starting_items_universe_id_item_id_pk" PRIMARY KEY("universe_id","item_id"),
	CONSTRAINT "universe_starting_items_quantity_range" CHECK ("universe_starting_items"."quantity" BETWEEN 1 AND 999)
);
--> statement-breakpoint
ALTER TABLE "universe_starting_items" ADD CONSTRAINT "universe_starting_items_universe_id_universes_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "universe_starting_items" ADD CONSTRAINT "universe_starting_items_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "universe_starting_items_item_id_index" ON "universe_starting_items" USING btree ("item_id");