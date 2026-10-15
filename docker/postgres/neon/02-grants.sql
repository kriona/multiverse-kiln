-- Gives kiln_app read and write access to the kiln database on a Neon branch, matching
-- docker/postgres/init/01-roles.sh
--
-- Run after 01-roles.sql, as kiln_migrator, connected to kiln:
--   psql "<kiln_migrator direct connection string to kiln>" -v ON_ERROR_STOP=1 -f 02-grants.sql
--
-- These statements run as the database's owner because only the owner (or a superuser, which
-- Neon doesn't provide) can grant on the database, its public schema and its future tables

REVOKE ALL ON DATABASE kiln FROM PUBLIC;
GRANT CONNECT ON DATABASE kiln TO kiln_app;

GRANT USAGE ON SCHEMA public TO kiln_app;

-- Tables and sequences kiln_migrator creates from now on are readable and writable by the app
ALTER DEFAULT PRIVILEGES IN SCHEMA public
	GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kiln_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
	GRANT USAGE, SELECT ON SEQUENCES TO kiln_app;
