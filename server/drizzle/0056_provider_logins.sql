CREATE TYPE "public"."login_provider" AS ENUM('google', 'discord');--> statement-breakpoint
ALTER TYPE "public"."auth_event_kind" ADD VALUE 'providerLinked';--> statement-breakpoint
CREATE TABLE "pending_provider_logins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"continuation_hash" "bytea" NOT NULL,
	"provider" "login_provider" NOT NULL,
	"provider_user_id" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"player_id" uuid,
	"remember_me" boolean NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pending_provider_logins_continuation_hash_length" CHECK (octet_length("pending_provider_logins"."continuation_hash") = 32)
);
--> statement-breakpoint
CREATE TABLE "provider_logins" (
	"provider" "login_provider" NOT NULL,
	"provider_user_id" text NOT NULL,
	"player_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_logins_provider_provider_user_id_pk" PRIMARY KEY("provider","provider_user_id"),
	CONSTRAINT "provider_logins_player_provider_unique" UNIQUE("player_id","provider")
);
--> statement-breakpoint
ALTER TABLE "pending_provider_logins" ADD CONSTRAINT "pending_provider_logins_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_logins" ADD CONSTRAINT "provider_logins_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pending_provider_logins_continuation_hash_unique" ON "pending_provider_logins" USING btree ("continuation_hash");--> statement-breakpoint
CREATE INDEX "pending_provider_logins_player_id_index" ON "pending_provider_logins" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "pending_provider_logins_expires_at_index" ON "pending_provider_logins" USING btree ("expires_at");