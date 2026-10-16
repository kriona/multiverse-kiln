/**
 * Drizzle schema: the source of truth for the database tables
 *
 * After changing it, run `npm run db:generate -w server` to create a migration, then
 * `npm run db:migrate -w server` to apply it. Never change the database by hand
 */
import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/**
 * One row per player account
 *
 * Until there are real logins, a player is found by name, so no two players may have the same name
 * in any mix of capitals
 */
export const players = pgTable('players', {
	id: uuid('id').primaryKey().defaultRandom(),
	displayName: text('display_name').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
	uniqueIndex('players_display_name_lower_unique').on(sql`lower(${table.displayName})`)
]);
