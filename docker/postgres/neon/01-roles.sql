-- Creates the kiln database and its roles on a Neon branch, matching docker/postgres/init/01-roles.sh
--
-- Run once per branch, as the branch's default owner role (neondb_owner), connected to neondb:
--   psql "<neondb_owner direct connection string>" -v ON_ERROR_STOP=1 -v migrator_password=... -v app_password=... -f 01-roles.sql
-- Then run 02-grants.sql as kiln_migrator
--
-- The roles are created here rather than in the Neon console or API, because Neon makes those
-- roles members of neon_superuser, which can create roles and databases. Neon requires strong
-- passwords for roles created in SQL (at least 12 characters, about 60 bits of entropy)

CREATE ROLE kiln_migrator LOGIN PASSWORD :'migrator_password';
CREATE ROLE kiln_app LOGIN PASSWORD :'app_password';

-- CREATE DATABASE ... OWNER needs membership in the new owner role. Creating a role only grants
-- its creator ADMIN OPTION, so grant the membership for this statement and revoke it after
GRANT kiln_migrator TO CURRENT_USER;
CREATE DATABASE kiln OWNER kiln_migrator;
REVOKE kiln_migrator FROM CURRENT_USER;
