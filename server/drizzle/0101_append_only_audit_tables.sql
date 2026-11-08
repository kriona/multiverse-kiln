-- The audit records (admin_events, auth_events and universe_edits) are append-only for kiln_app, the
-- server's role: it can add rows and read them, but not change them. It can't delete admin events at all,
-- and deletes auth events and saves only through the functions below, which never delete a row younger
-- than the 90 days it is kept for, so a server that is compromised or has a bug can't erase recent records
--
-- Foreign keys still empty or cascade into these tables when a player or universe is deleted: Postgres
-- runs those actions as the tables' owner, kiln_migrator
REVOKE UPDATE, DELETE ON TABLE "admin_events", "auth_events", "universe_edits" FROM kiln_app;
--> statement-breakpoint

-- Deletes the auth events at or before a time, and never one from the last 90 days (AUTH_EVENT_DAYS,
-- server/src/authSweep.ts), returning how many were deleted. It runs as its owner, kiln_migrator
CREATE FUNCTION public.delete_auth_events_before(cutoff timestamptz)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
	WITH deleted AS (
		DELETE FROM public.auth_events
		WHERE occurred_at <= LEAST(cutoff, now() - interval '90 days')
		RETURNING 1
	)
	SELECT count(*)::integer FROM deleted
$$;
--> statement-breakpoint

-- Deletes up to a batch of the saves made before a time, and never one from the last 90 days
-- (UNIVERSE_EDIT_DAYS, server/src/universeEditSweep.ts), returning how many were deleted. It runs as its
-- owner, kiln_migrator
CREATE FUNCTION public.delete_universe_edits_before(cutoff timestamptz, batch_limit integer)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
	WITH deleted AS (
		DELETE FROM public.universe_edits
		WHERE id IN (
			SELECT id
			FROM public.universe_edits
			WHERE saved_at < LEAST(cutoff, now() - interval '90 days')
			LIMIT batch_limit
		)
		RETURNING 1
	)
	SELECT count(*)::integer FROM deleted
$$;
--> statement-breakpoint

-- Functions can be run by every role unless revoked
REVOKE ALL ON FUNCTION public.delete_auth_events_before(timestamptz), public.delete_universe_edits_before(timestamptz, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.delete_auth_events_before(timestamptz), public.delete_universe_edits_before(timestamptz, integer) TO kiln_app;
