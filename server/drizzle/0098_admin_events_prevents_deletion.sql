-- The universes already disabled were disabled without keeping their creators from deleting them
UPDATE "admin_events"
SET "prevents_deletion" = false
WHERE "kind" = 'universeDisabled';
