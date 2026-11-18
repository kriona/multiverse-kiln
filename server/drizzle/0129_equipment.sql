ALTER TYPE "public"."chat_notice" ADD VALUE 'gave';--> statement-breakpoint
CREATE TABLE "character_equipment" (
	"character_id" uuid NOT NULL,
	"slot" text NOT NULL,
	"item_id" integer NOT NULL,
	"both_hands" boolean DEFAULT false NOT NULL,
	CONSTRAINT "character_equipment_character_id_slot_pk" PRIMARY KEY("character_id","slot"),
	CONSTRAINT "character_equipment_both_hands_in_main_hand" CHECK (NOT "character_equipment"."both_hands" OR "character_equipment"."slot" = 'mainHand')
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "notice_details" jsonb;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "equips" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "pf1e_races" ADD COLUMN "has_tail" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "character_equipment" ADD CONSTRAINT "character_equipment_carried_item_fk" FOREIGN KEY ("character_id","item_id") REFERENCES "public"."character_items"("character_id","item_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "character_equipment_item_index" ON "character_equipment" USING btree ("item_id","character_id");