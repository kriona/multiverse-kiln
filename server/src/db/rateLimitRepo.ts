/**
 * The attempts rate limits count: the only module that reads or writes the rate_limit_events table
 *
 * Which limits apply, and how many attempts each allows, is decided in server/src/logic/emailCodes.ts.
 * To keep requests sent at once from each slipping under a limit, a caller locks the subject, counts
 * its attempts and records the new one in one transaction
 */
import { and, eq, gt, inArray, lte, sql } from 'drizzle-orm';

import { db, type Executor } from './client.js';
import { rateLimitEvents, type RATE_LIMIT_KINDS } from './schema.js';

/**
 * What a rate limit counts
 */
export type RateLimitKind = (typeof RATE_LIMIT_KINDS)[number];

/**
 * Makes concurrent transactions that limit the same subject (an address or network) wait for each
 * other, until the transaction ends. Locks aren't taken on rows, since a subject's first attempt has
 * none yet
 *
 * @param subjectHash Keyed hash of the subject
 * @param executor A transaction
 */
export async function lockRateLimitSubject(subjectHash: Uint8Array, executor: Executor): Promise<void>
{
	// The hash is random, so its first 8 bytes make a lock key that is all but unique to the subject
	const lockKey = Buffer.from(subjectHash).readBigInt64BE(0);

	await executor.execute(sql`SELECT pg_advisory_xact_lock(${lockKey.toString()}::bigint)`);
}

/**
 * When a subject made each attempt of a kind since a time
 *
 * @param kind What is counted
 * @param subjectHash Keyed hash of the subject
 * @param since The start of the window counted
 * @param executor The database, or a transaction
 * @return The times, oldest first
 */
export async function findRateLimitTimes(kind: RateLimitKind, subjectHash: Uint8Array, since: Date, executor: Executor = db): Promise<Date[]>
{
	const rows = await executor
		.select({
			occurredAt: rateLimitEvents.occurredAt
		})
		.from(rateLimitEvents)
		.where(and(
			eq(rateLimitEvents.kind, kind),
			eq(rateLimitEvents.subjectHash, subjectHash),
			gt(rateLimitEvents.occurredAt, since)
		))
		.orderBy(rateLimitEvents.occurredAt);

	return(rows.map((row) => row.occurredAt));
}

/**
 * Records an attempt
 *
 * @param kind What is counted
 * @param subjectHash Keyed hash of the subject
 * @param now When the attempt was made
 * @param executor The database, or a transaction
 */
export async function recordRateLimitEvent(kind: RateLimitKind, subjectHash: Uint8Array, now: Date, executor: Executor = db): Promise<void>
{
	await executor
		.insert(rateLimitEvents)
		.values({
			kind,
			subjectHash,
			occurredAt: now
		});
}

/**
 * Deletes the attempts no limit counts any more
 *
 * @param kinds The kinds to delete
 * @param before Attempts made at or before this time are deleted
 * @param executor The database, or a transaction
 * @return How many were deleted
 */
export async function deleteRateLimitEventsBefore(kinds: readonly RateLimitKind[], before: Date, executor: Executor = db): Promise<number>
{
	const rows = await executor
		.delete(rateLimitEvents)
		.where(and(
			inArray(rateLimitEvents.kind, [...kinds]),
			lte(rateLimitEvents.occurredAt, before)
		))
		.returning({
			id: rateLimitEvents.id
		});

	return(rows.length);
}
