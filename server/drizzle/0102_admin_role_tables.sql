-- Only kiln_admin, the admin pages' role (ADMIN_DATABASE_URL), can change who is a server admin, change
-- the site's settings and record what admins do. kiln_app, the server's own role, can still read all
-- three, and kiln_admin is a member of kiln_app, so it can do everything else kiln_app can. Create
-- kiln_admin before migrating: docker/postgres/init/03-admin-role.sh locally, docker/postgres/neon/01-roles.sql on Neon
--
-- Deleting a player still deletes their server_admins row and empties admin_events' references to them:
-- Postgres runs foreign key actions as the tables' owner, kiln_migrator
REVOKE INSERT, UPDATE, DELETE ON TABLE "server_admins", "site_settings", "admin_events" FROM kiln_app;
--> statement-breakpoint
GRANT INSERT, DELETE ON TABLE "server_admins" TO kiln_admin;
--> statement-breakpoint
GRANT INSERT, UPDATE ON TABLE "site_settings" TO kiln_admin;
--> statement-breakpoint
GRANT INSERT ON TABLE "admin_events" TO kiln_admin;
