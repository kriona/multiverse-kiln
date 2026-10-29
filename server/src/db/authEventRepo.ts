/**
 * The record of logins and changes to how accounts log in: the only module that reads or writes the
 * auth_events table
 */
import { eq, lte } from 'drizzle-orm';

import { db, type Executor } from './client.js';
import { authEvents, type AUTH_EVENT_KINDS } from './schema.js';

/**
 * What happened in an auth event
 */
export type AuthEventKind = (typeof AUTH_EVENT_KINDS)[number];

/**
 * An auth event
 */
export interface AuthEvent
{
	/**
	 * The account, or null when it isn't known
	 */
	playerId: string | null;

	kind: AuthEventKind;

	/**
	 * Keyed hash of the network the request came from, or null when it isn't known
	 */
	networkHash: Uint8Array | null;

	occurredAt: Date;
}

/**
 * Records an auth event
 *
 * @param event What happened
 * @param executor The database, or a transaction
 */
export async function recordAuthEvent(event: AuthEvent, executor: Executor = db): Promise<void>
{
	await executor
		.insert(authEvents)
		.values(event);
}

/**
 * An account's auth events, for its data export
 *
 * @param playerId The account
 * @param executor The database, or a transaction
 * @return Its events, oldest first
 */
export async function findPlayerAuthEvents(playerId: string, executor: Executor = db): Promise<AuthEvent[]>
{
	return(await executor
		.select({
			playerId: authEvents.playerId,
			kind: authEvents.kind,
			networkHash: authEvents.networkHash,
			occurredAt: authEvents.occurredAt
		})
		.from(authEvents)
		.where(eq(authEvents.playerId, playerId))
		.orderBy(authEvents.occurredAt));
}

/**
 * Deletes the events old enough to stop keeping
 *
 * @param before Events at or before this time are deleted
 * @param executor The database, or a transaction
 * @return How many were deleted
 */
export async function deleteAuthEventsBefore(before: Date, executor: Executor = db): Promise<number>
{
	const rows = await executor
		.delete(authEvents)
		.where(lte(authEvents.occurredAt, before))
		.returning({
			id: authEvents.id
		});

	return(rows.length);
}
