-- Only kiln_admin, the admin pages' role, can disable a universe, enable it again or change whether its
-- creators may delete it (disabled_at, disabled_reason and deletion_prevented), and only kiln_admin can
-- delete a universe whose deletion is prevented. kiln_app, the server's own role, can still add, change
-- and delete universes otherwise, so a bug anywhere else in the server can't undo what an admin decided.
-- Triggers rather than column privileges hold kiln_app back, so a column added to universes later is
-- writable without a grant of its own
--
-- Roles that aren't kiln_app, such as kiln_migrator, which owns the table and so could drop the triggers
-- anyway, aren't held back. kiln_admin is a member of kiln_app, so it is checked for first

-- Refuses the change that fired the trigger when the role making it is kiln_app rather than kiln_admin
CREATE FUNCTION public.refuse_universe_disabling_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
	IF pg_has_role(current_user, 'kiln_app', 'MEMBER') AND NOT pg_has_role(current_user, 'kiln_admin', 'MEMBER') THEN
		IF TG_OP = 'DELETE' THEN
			RAISE EXCEPTION 'Only kiln_admin can delete a universe whose deletion is prevented'
				USING ERRCODE = 'insufficient_privilege';
		END IF;

		RAISE EXCEPTION 'Only kiln_admin can disable a universe, enable it or change whether its creators may delete it'
			USING ERRCODE = 'insufficient_privilege';
	END IF;

	RETURN COALESCE(NEW, OLD);
END
$$;
--> statement-breakpoint
CREATE TRIGGER universes_disabling_insert
BEFORE INSERT ON public.universes
FOR EACH ROW
WHEN ((NEW.disabled_at IS NOT NULL) OR (NEW.disabled_reason IS NOT NULL) OR NEW.deletion_prevented)
EXECUTE FUNCTION public.refuse_universe_disabling_change();
--> statement-breakpoint
CREATE TRIGGER universes_disabling_update
BEFORE UPDATE OF disabled_at, disabled_reason, deletion_prevented ON public.universes
FOR EACH ROW
WHEN ((NEW.disabled_at, NEW.disabled_reason, NEW.deletion_prevented) IS DISTINCT FROM (OLD.disabled_at, OLD.disabled_reason, OLD.deletion_prevented))
EXECUTE FUNCTION public.refuse_universe_disabling_change();
--> statement-breakpoint
CREATE TRIGGER universes_prevented_deletion
BEFORE DELETE ON public.universes
FOR EACH ROW
WHEN (OLD.deletion_prevented)
EXECUTE FUNCTION public.refuse_universe_disabling_change();
