CREATE INDEX "areas_default_tile_id_index" ON "areas" USING btree ("default_tile_id");--> statement-breakpoint
CREATE INDEX "chat_messages_universe_id_index" ON "chat_messages" USING btree ("universe_id");--> statement-breakpoint
CREATE INDEX "classes_overrides_class_id_index" ON "classes" USING btree ("overrides_class_id");--> statement-breakpoint
CREATE INDEX "items_overrides_item_id_index" ON "items" USING btree ("overrides_item_id");--> statement-breakpoint
CREATE INDEX "races_overrides_race_id_index" ON "races" USING btree ("overrides_race_id");--> statement-breakpoint
CREATE INDEX "themes_overrides_theme_id_index" ON "themes" USING btree ("overrides_theme_id");--> statement-breakpoint
CREATE INDEX "tile_graphics_uploaded_by_index" ON "tile_graphics" USING btree ("uploaded_by");--> statement-breakpoint
CREATE INDEX "tiles_overrides_tile_id_index" ON "tiles" USING btree ("overrides_tile_id");--> statement-breakpoint
CREATE INDEX "tiles_uploaded_graphic_id_index" ON "tiles" USING btree ("uploaded_graphic_id");--> statement-breakpoint
CREATE INDEX "universe_drafts_lobby_area_id_index" ON "universe_drafts" USING btree ("lobby_area_id");--> statement-breakpoint
CREATE INDEX "universe_drafts_starting_area_id_index" ON "universe_drafts" USING btree ("starting_area_id");--> statement-breakpoint
CREATE INDEX "universe_translations_saved_by_index" ON "universe_translations" USING btree ("saved_by");--> statement-breakpoint
CREATE INDEX "universe_translator_notes_note_saved_by_index" ON "universe_translator_notes" USING btree ("note_saved_by");--> statement-breakpoint
CREATE INDEX "universes_lobby_area_id_index" ON "universes" USING btree ("lobby_area_id");--> statement-breakpoint
CREATE INDEX "universes_starting_area_id_index" ON "universes" USING btree ("starting_area_id");