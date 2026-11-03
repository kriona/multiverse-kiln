CREATE TYPE "public"."admin_event_kind" AS ENUM('adminAdded', 'adminRemoved', 'universeDisabled', 'universeEnabled');--> statement-breakpoint
CREATE TABLE "admin_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid,
	"kind" "admin_event_kind" NOT NULL,
	"player_id" uuid,
	"universe_id" uuid,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_events_reason_length" CHECK (char_length("admin_events"."reason") <= 500)
);
--> statement-breakpoint
ALTER TABLE "universes" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "universes" ADD COLUMN "disabled_reason" text;--> statement-breakpoint
ALTER TABLE "admin_events" ADD CONSTRAINT "admin_events_admin_id_players_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_events" ADD CONSTRAINT "admin_events_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_events" ADD CONSTRAINT "admin_events_universe_id_universes_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_events_admin_id_index" ON "admin_events" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX "admin_events_player_id_index" ON "admin_events" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "admin_events_universe_id_index" ON "admin_events" USING btree ("universe_id");--> statement-breakpoint
CREATE INDEX "admin_events_occurred_at_index" ON "admin_events" USING btree ("occurred_at");--> statement-breakpoint
ALTER TABLE "universes" ADD CONSTRAINT "universes_disabled_reason_set" CHECK (("universes"."disabled_at" IS NULL) = ("universes"."disabled_reason" IS NULL));--> statement-breakpoint
ALTER TABLE "universes" ADD CONSTRAINT "universes_disabled_reason_length" CHECK (char_length("universes"."disabled_reason") BETWEEN 1 AND 500);