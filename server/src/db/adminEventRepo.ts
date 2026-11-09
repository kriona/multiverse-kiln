/**
 * The record of what server admins do as admins: the only module that reads or writes the admin_events
 * table
 */
import { asc, eq, or, sql } from 'drizzle-orm';

import { db, type Executor } from './client.js';
import { adminEvents, universes, type ADMIN_EVENT_KINDS } from './schema.js';

/**
 * An event's universe's name: the one the record keeps of a universe deleted, or the universe's own
 */
const universeNameColumn = sql<string | null>`coalesce(${adminEvents.universeName}, ${universes.name})`;

/**
 * What a server admin did
 */
export type AdminEventKind = (typeof ADMIN_EVENT_KINDS)[number];

/**
 * An admin event
 */
export type AdminEvent =
	| { kind: 'adminAdded' | 'adminRemoved'; adminId: string | null; playerId: string | null; occurredAt: Date }
	| { kind: 'universeDisabled'; adminId: string | null; universeId: string | null; reason: string; preventsDeletion: boolean; occurredAt: Date }
	| { kind: 'universeEnabled'; adminId: string | null; universeId: string | null; occurredAt: Date }
	| { kind: 'universeDeleted'; adminId: string | null; universeId: string | null; universeName: string; occurredAt: Date };

/**
 * Records what a server admin did
 *
 * @param event What happened
 * @param executor The change's own transaction, so the record is kept exactly when the change is: one of the
 * admin role's (inAdminTransaction()), since the server's own role can't write admin_events
 */
export async function recordAdminEvent(event: AdminEvent, executor: Executor): Promise<void>
{
	await executor
		.insert(adminEvents)
		.values(event);
}

/**
 * A stored admin event, with every column
 */
export interface AdminEventRecord
{
	adminId: string | null;
	kind: AdminEventKind;
	playerId: string | null;
	universeId: string | null;

	/**
	 * The universe's name, or null when the event names none: an event about a universe since deleted
	 * names it only when it is the record of deleting it
	 */
	universeName: string | null;

	reason: string | null;

	/**
	 * Whether disabling a universe kept its creators from deleting it, or null for other kinds
	 */
	preventsDeletion: boolean | null;

	occurredAt: Date;
}

/**
 * The admin events a player did or was the subject of
 *
 * @param playerId The player
 * @param executor The database, or a transaction
 * @return The events, oldest first
 */
export async function findPlayerAdminEvents(playerId: string, executor: Executor = db): Promise<AdminEventRecord[]>
{
	return(executor
		.select({
			adminId: adminEvents.adminId,
			kind: adminEvents.kind,
			playerId: adminEvents.playerId,
			universeId: adminEvents.universeId,
			universeName: universeNameColumn,
			reason: adminEvents.reason,
			preventsDeletion: adminEvents.preventsDeletion,
			occurredAt: adminEvents.occurredAt
		})
		.from(adminEvents)
		.leftJoin(universes, eq(universes.id, adminEvents.universeId))
		.where(or(
			eq(adminEvents.adminId, playerId),
			eq(adminEvents.playerId, playerId)
		))
		.orderBy(asc(adminEvents.occurredAt), asc(adminEvents.id)));
}

/**
 * The admin events about a universe
 *
 * @param universeId The universe
 * @param executor The database, or a transaction
 * @return The events, oldest first
 */
export async function findUniverseAdminEvents(universeId: string, executor: Executor = db): Promise<AdminEventRecord[]>
{
	return(executor
		.select({
			adminId: adminEvents.adminId,
			kind: adminEvents.kind,
			playerId: adminEvents.playerId,
			universeId: adminEvents.universeId,
			universeName: universeNameColumn,
			reason: adminEvents.reason,
			preventsDeletion: adminEvents.preventsDeletion,
			occurredAt: adminEvents.occurredAt
		})
		.from(adminEvents)
		.leftJoin(universes, eq(universes.id, adminEvents.universeId))
		.where(eq(adminEvents.universeId, universeId))
		.orderBy(asc(adminEvents.occurredAt), asc(adminEvents.id)));
}
