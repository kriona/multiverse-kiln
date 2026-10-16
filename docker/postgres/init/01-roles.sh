#!/bin/sh
# Creates the roles the databases use. The Postgres image runs this once, when the data volume is empty
#
# - kiln_migrator owns the databases and everything drizzle-kit creates in them (tables, the drizzle
#   migrations schema). Only migrations connect as this role
# - kiln_app is the game server's role: it can read and write rows but can't create, alter or drop
#   tables, because it owns none of them
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
	-v migrator_password="$KILN_MIGRATOR_PASSWORD" \
	-v app_password="$KILN_APP_PASSWORD" <<-'EOSQL'
	CREATE ROLE kiln_migrator LOGIN PASSWORD :'migrator_password';
	CREATE ROLE kiln_app LOGIN PASSWORD :'app_password';
EOSQL
