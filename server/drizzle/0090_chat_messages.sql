CREATE TABLE "chat_messages" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "chat_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"universe_id" uuid NOT NULL,
	"group_id" uuid,
	"player_id" uuid,
	"author_name" text,
	"text" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	CONSTRAINT "chat_messages_text_length" CHECK (char_length("chat_messages"."text") BETWEEN 1 AND 500)
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_universe_id_universes_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_messages_group_id_index" ON "chat_messages" USING btree ("group_id","id") WHERE "chat_messages"."group_id" is not null;--> statement-breakpoint
CREATE INDEX "chat_messages_editors_index" ON "chat_messages" USING btree ("universe_id","id") WHERE "chat_messages"."group_id" is null;--> statement-breakpoint
CREATE INDEX "chat_messages_player_id_index" ON "chat_messages" USING btree ("player_id");