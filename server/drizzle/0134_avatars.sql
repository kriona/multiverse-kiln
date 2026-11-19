CREATE TABLE "character_hidden_slots" (
	"character_id" uuid NOT NULL,
	"slot" text NOT NULL,
	CONSTRAINT "character_hidden_slots_character_id_slot_pk" PRIMARY KEY("character_id","slot")
);
--> statement-breakpoint
ALTER TABLE "character_equipment" ADD COLUMN "layer" text DEFAULT 'stats' NOT NULL;--> statement-breakpoint
ALTER TABLE "character_equipment" DROP CONSTRAINT "character_equipment_character_id_slot_pk";--> statement-breakpoint
ALTER TABLE "character_equipment" ADD CONSTRAINT "character_equipment_character_id_layer_slot_pk" PRIMARY KEY("character_id","layer","slot");--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "body_type" text DEFAULT 'femmeThicc' NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "art_type" text DEFAULT 'stickFigure' NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "background" text DEFAULT 'darkGreen' NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "avatar_hash" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "avatar_item_id" integer;--> statement-breakpoint
ALTER TABLE "races" ADD COLUMN "avatar_race_id" integer;--> statement-breakpoint
ALTER TABLE "character_hidden_slots" ADD CONSTRAINT "character_hidden_slots_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_avatar_item_id_items_id_fk" FOREIGN KEY ("avatar_item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "races" ADD CONSTRAINT "races_avatar_race_id_races_id_fk" FOREIGN KEY ("avatar_race_id") REFERENCES "public"."races"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "items_avatar_item_id_index" ON "items" USING btree ("avatar_item_id");--> statement-breakpoint
CREATE INDEX "races_avatar_race_id_index" ON "races" USING btree ("avatar_race_id");--> statement-breakpoint
ALTER TABLE "character_equipment" ADD CONSTRAINT "character_equipment_layer" CHECK ("character_equipment"."layer" IN ('stats', 'social'));--> statement-breakpoint
ALTER TABLE "character_equipment" ADD CONSTRAINT "character_equipment_social_not_held" CHECK ("character_equipment"."layer" = 'stats' OR NOT "character_equipment"."both_hands");--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_avatar_on_added" CHECK ("items"."avatar_item_id" IS NULL OR ("items"."universe_id" IS NOT NULL AND "items"."overrides_item_id" IS NULL));--> statement-breakpoint
ALTER TABLE "races" ADD CONSTRAINT "races_avatar_on_added" CHECK ("races"."avatar_race_id" IS NULL OR ("races"."universe_id" IS NOT NULL AND "races"."overrides_race_id" IS NULL));
