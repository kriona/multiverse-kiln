ALTER TYPE "public"."auth_event_kind" ADD VALUE 'twoFactorEnabled';--> statement-breakpoint
ALTER TYPE "public"."auth_event_kind" ADD VALUE 'twoFactorDisabled';--> statement-breakpoint
ALTER TYPE "public"."auth_event_kind" ADD VALUE 'twoFactorFailed';--> statement-breakpoint
ALTER TYPE "public"."auth_event_kind" ADD VALUE 'recoveryCodeUsed';--> statement-breakpoint
ALTER TYPE "public"."auth_event_kind" ADD VALUE 'recoveryCodesReplaced';--> statement-breakpoint
ALTER TYPE "public"."auth_event_kind" ADD VALUE 'browserTrusted';--> statement-breakpoint
ALTER TYPE "public"."auth_event_kind" ADD VALUE 'trustedBrowsersForgotten';--> statement-breakpoint
ALTER TYPE "public"."rate_limit_kind" ADD VALUE 'accountTwoFactorAttempt';--> statement-breakpoint
CREATE TABLE "authenticators" (
	"player_id" uuid PRIMARY KEY NOT NULL,
	"encrypted_secret" "bytea" NOT NULL,
	"last_used_step" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"enabled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pending_two_factor_logins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"continuation_hash" "bytea" NOT NULL,
	"player_id" uuid NOT NULL,
	"remember_me" boolean NOT NULL,
	"wrong_guesses" smallint DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pending_two_factor_logins_continuation_hash_length" CHECK (octet_length("pending_two_factor_logins"."continuation_hash") = 32),
	CONSTRAINT "pending_two_factor_logins_wrong_guesses_range" CHECK ("pending_two_factor_logins"."wrong_guesses" >= 0)
);
--> statement-breakpoint
CREATE TABLE "recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"code_hash" "bytea" NOT NULL,
	CONSTRAINT "recovery_codes_code_hash_length" CHECK (octet_length("recovery_codes"."code_hash") = 32)
);
--> statement-breakpoint
CREATE TABLE "trusted_browsers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"player_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "trusted_browsers_token_hash_length" CHECK (octet_length("trusted_browsers"."token_hash") = 32)
);
--> statement-breakpoint
ALTER TABLE "authenticators" ADD CONSTRAINT "authenticators_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_two_factor_logins" ADD CONSTRAINT "pending_two_factor_logins_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trusted_browsers" ADD CONSTRAINT "trusted_browsers_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pending_two_factor_logins_continuation_hash_unique" ON "pending_two_factor_logins" USING btree ("continuation_hash");--> statement-breakpoint
CREATE INDEX "pending_two_factor_logins_player_id_index" ON "pending_two_factor_logins" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "pending_two_factor_logins_expires_at_index" ON "pending_two_factor_logins" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "recovery_codes_player_id_index" ON "recovery_codes" USING btree ("player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trusted_browsers_token_player_unique" ON "trusted_browsers" USING btree ("token_hash","player_id");--> statement-breakpoint
CREATE INDEX "trusted_browsers_player_id_index" ON "trusted_browsers" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "trusted_browsers_expires_at_index" ON "trusted_browsers" USING btree ("expires_at");