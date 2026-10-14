/**
 * drizzle-kit configuration for `npm run db:generate -w server` and `npm run db:migrate -w server`
 *
 * Migrations connect as the migration role (MIGRATION_DATABASE_URL), which owns the tables; the
 * server's own role (DATABASE_URL) can't alter them
 */
import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit doesn't read .env itself. Variables already set in the environment take precedence,
// so a deploy step can pass MIGRATION_DATABASE_URL directly
if (existsSync('.env'))
{
	process.loadEnvFile('.env');
}

export default defineConfig({
	dialect: 'postgresql',
	schema: './src/db/schema.ts',
	out: './drizzle',
	dbCredentials: {
		url: process.env.MIGRATION_DATABASE_URL ?? ''
	},
	// Fail instead of guessing when a change could be a rename
	strict: true,
	verbose: true
});
