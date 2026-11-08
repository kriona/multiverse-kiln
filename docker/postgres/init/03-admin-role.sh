#!/bin/sh
# Creates kiln_admin, the role the admin pages and `npm run admin:add -w server` connect as
# (ADMIN_DATABASE_URL). It is a member of kiln_app, so it can do everything the game server can, and the
# migrations also let it write the tables only server admins change (server_admins, site_settings and
# admin_events), which kiln_app can only read. Needs the roles from 01-roles.sh
#
# The Postgres image runs this once, when the data volume is empty. A role that already exists is left
# alone, so it can also be run by hand to add it to an existing volume (see README "Start the database"):
#   docker compose exec postgres sh /docker-entrypoint-initdb.d/03-admin-role.sh
set -eu

superuser="${POSTGRES_USER:-postgres}"

psql -v ON_ERROR_STOP=1 --username "$superuser" --dbname postgres -v admin_password="$KILN_ADMIN_PASSWORD" <<-'EOSQL'
	SELECT format('CREATE ROLE kiln_admin LOGIN PASSWORD %L IN ROLE kiln_app', :'admin_password')
	WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'kiln_admin')
	\gexec
EOSQL
