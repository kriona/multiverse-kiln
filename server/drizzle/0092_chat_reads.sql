CREATE TABLE "chat_reads" (
	"player_id" uuid NOT NULL,
	"universe_id" uuid NOT NULL,
	"group_id" uuid,
	"read_at" timestamp with time zone NOT NULL,
	CONSTRAINT "chat_reads_chat_unique" UNIQUE NULLS NOT DISTINCT("player_id","universe_id","group_id")
);
--> statement-breakpoint
ALTER TABLE "chat_reads" ADD CONSTRAINT "chat_reads_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_reads" ADD CONSTRAINT "chat_reads_universe_id_universes_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_reads" ADD CONSTRAINT "chat_reads_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_reads_universe_id_index" ON "chat_reads" USING btree ("universe_id");--> statement-breakpoint
CREATE INDEX "chat_reads_group_id_index" ON "chat_reads" USING btree ("group_id");