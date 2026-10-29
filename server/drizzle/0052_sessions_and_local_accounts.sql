CREATE TYPE "public"."auth_event_kind" AS ENUM('registered', 'loggedIn', 'loginFailed', 'loggedOut', 'passwordReset', 'passwordChanged', 'passwordRehashed', 'emailChanged');--> statement-breakpoint
CREATE TYPE "public"."email_code_purpose" AS ENUM('register', 'resetPassword', 'changeEmail');--> statement-breakpoint
CREATE TYPE "public"."rate_limit_kind" AS ENUM('addressCodeSent', 'addressWrongGuess', 'networkCodeRequest', 'networkGuess');--> statement-breakpoint
CREATE TABLE "auth_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid,
	"kind" "auth_event_kind" NOT NULL,
	"network_hash" "bytea",
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_events_network_hash_length" CHECK (octet_length("auth_events"."network_hash") = 32)
);
--> statement-breakpoint
CREATE TABLE "email_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" "email_code_purpose" NOT NULL,
	"address_hash" "bytea" NOT NULL,
	"player_id" uuid,
	"code_hash" "bytea" NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"wrong_guesses" smallint DEFAULT 0 NOT NULL,
	"used_at" timestamp with time zone,
	"continuation_hash" "bytea",
	"continuation_expires_at" timestamp with time zone,
	CONSTRAINT "email_codes_address_hash_length" CHECK (octet_length("email_codes"."address_hash") = 32),
	CONSTRAINT "email_codes_code_hash_length" CHECK (octet_length("email_codes"."code_hash") = 32),
	CONSTRAINT "email_codes_continuation_hash_length" CHECK (octet_length("email_codes"."continuation_hash") = 32),
	CONSTRAINT "email_codes_wrong_guesses_range" CHECK ("email_codes"."wrong_guesses" >= 0),
	CONSTRAINT "email_codes_player_purpose" CHECK (("email_codes"."purpose" = 'register') = ("email_codes"."player_id" IS NULL)),
	CONSTRAINT "email_codes_continuation" CHECK (("email_codes"."continuation_hash" IS NULL) = ("email_codes"."continuation_expires_at" IS NULL) AND ("email_codes"."continuation_hash" IS NULL OR "email_codes"."used_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "rate_limit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "rate_limit_kind" NOT NULL,
	"subject_hash" "bytea" NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_limit_events_subject_hash_length" CHECK (octet_length("rate_limit_events"."subject_hash") = 32)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"player_id" uuid NOT NULL,
	"remember_me" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_length" CHECK (octet_length("sessions"."token_hash") = 32)
);
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "auth_events" ADD CONSTRAINT "auth_events_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_codes" ADD CONSTRAINT "email_codes_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_events_player_id_index" ON "auth_events" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "auth_events_occurred_at_index" ON "auth_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_codes_purpose_address_unique" ON "email_codes" USING btree ("purpose","address_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "email_codes_continuation_hash_unique" ON "email_codes" USING btree ("continuation_hash");--> statement-breakpoint
CREATE INDEX "email_codes_player_id_index" ON "email_codes" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "rate_limit_events_subject_index" ON "rate_limit_events" USING btree ("kind","subject_hash","occurred_at");--> statement-breakpoint
CREATE INDEX "rate_limit_events_occurred_at_index" ON "rate_limit_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_unique" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_player_id_index" ON "sessions" USING btree ("player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "players_email_lower_unique" ON "players" USING btree (lower("email"));