-- Gives accounts that already exist the last login the auth events still record (they are kept 90 days)
UPDATE "players"
SET "last_login_at" = "logins"."last_login_at"
FROM (
	SELECT "player_id", max("occurred_at") AS "last_login_at"
	FROM "auth_events"
	WHERE "kind" = 'loggedIn' AND "player_id" IS NOT NULL
	GROUP BY "player_id"
) AS "logins"
WHERE "players"."id" = "logins"."player_id";
