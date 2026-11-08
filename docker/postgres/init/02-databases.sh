#!/bin/sh
# Creates the kiln database, the kiln_test database the test suite uses when it runs in one process,
# kiln_test_1 to kiln_test_8, one for each of the test suite's parallel workers (server/test/testWorker.ts),
# and kiln_review_1_test to kiln_review_4_test, one for each of the kiln-review skill's verifiers running repro
# tests at once (server/test/reviewSlot.ts). Each is owned by kiln_migrator with the same grants for
# kiln_app. Needs the roles from 01-roles.sh
#
# The Postgres image runs this once, when the data volume is empty. A database that already exists is
# left alone, so it can also be run by hand to add a missing one (see README "Start the database"):
#   docker compose exec postgres sh /docker-entrypoint-initdb.d/02-databases.sh
set -eu

superuser="${POSTGRES_USER:-postgres}"

for database in kiln kiln_test kiln_test_1 kiln_test_2 kiln_test_3 kiln_test_4 kiln_test_5 kiln_test_6 kiln_test_7 kiln_test_8 kiln_review_1_test kiln_review_2_test kiln_review_3_test kiln_review_4_test
do
	psql -v ON_ERROR_STOP=1 --username "$superuser" --dbname postgres -v database="$database" <<-'EOSQL'
		SELECT format('CREATE DATABASE %I OWNER kiln_migrator', :'database')
		WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'database')
		\gexec

		-- The owner of the database also owns its public schema (pg_database_owner), so only the
		-- migrator can create objects there
		REVOKE ALL ON DATABASE :"database" FROM PUBLIC;
		GRANT CONNECT ON DATABASE :"database" TO kiln_app;
	EOSQL

	psql -v ON_ERROR_STOP=1 --username "$superuser" --dbname "$database" <<-'EOSQL'
		GRANT USAGE ON SCHEMA public TO kiln_app;

		-- Tables and sequences the migrator creates from now on are readable and writable by the app
		ALTER DEFAULT PRIVILEGES FOR ROLE kiln_migrator IN SCHEMA public
			GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kiln_app;
		ALTER DEFAULT PRIVILEGES FOR ROLE kiln_migrator IN SCHEMA public
			GRANT USAGE, SELECT ON SEQUENCES TO kiln_app;
	EOSQL
done
