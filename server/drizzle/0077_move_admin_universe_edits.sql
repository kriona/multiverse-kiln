-- Moves the saves server admins made with the site admin role from admin_events to universe_edits, which records every save. Their changes weren't counted, so change_counts is null; saves to universes since deleted have nothing to move to
INSERT INTO "universe_edits" ("universe_id", "player_id", "role", "change_counts", "saved_at")
SELECT "universe_id", "admin_id", 'admin', NULL, "occurred_at"
FROM "admin_events"
WHERE "kind" = 'universeEdited' AND "universe_id" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "admin_events"
WHERE "kind" = 'universeEdited';
