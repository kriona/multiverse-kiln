CREATE INDEX "players_username_trigram_index" ON "players" USING gin (lower("username") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "players_display_name_trigram_index" ON "players" USING gin (lower("display_name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "players_email_trigram_index" ON "players" USING gin (lower("email") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "universes_name_trigram_index" ON "universes" USING gin (lower("name") gin_trgm_ops);