#!/bin/sh
# Creates the kiln database and its roles. The Postgres image runs this once, when the data volume is empty
#
# - kiln_migrator owns the database and everything drizzle-kit creates in it (tables, the drizzle
#   migrations schema). Only migrations connect as this role
# - kiln_app is the game server's role: it can read and write rows but can't create, alter or drop
#   tables, because it owns none of them
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
	-v migrator_password="$KILN_MIGRATOR_PASSWORD" \
	-v app_password="$KILN_APP_PASSWORD" <<-'EOSQL'
	CREATE ROLE kiln_migrator LOGIN PASSWORD :'migrator_password';
	CREATE ROLE kiln_app LOGIN PASSWORD :'app_password';

	-- The owner of the database also owns its public schema (pg_database_owner), so only the
	-- migrator can create objects there
	CREATE DATABASE kiln OWNER kiln_migrator;
	REVOKE ALL ON DATABASE kiln FROM PUBLIC;
	GRANT CONNECT ON DATABASE kiln TO kiln_app;
EOSQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname kiln <<-'EOSQL'
	GRANT USAGE ON SCHEMA public TO kiln_app;

	-- Tables and sequences the migrator creates from now on are readable and writable by the app
	ALTER DEFAULT PRIVILEGES FOR ROLE kiln_migrator IN SCHEMA public
		GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kiln_app;
	ALTER DEFAULT PRIVILEGES FOR ROLE kiln_migrator IN SCHEMA public
		GRANT USAGE, SELECT ON SEQUENCES TO kiln_app;
EOSQL
