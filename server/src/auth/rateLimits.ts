/**
 * Counting attempts against hourly limits, such as logins from one network, so many requests sent at
 * once can't each slip under a limit
 */
import type { Executor } from '../db/client.js';
import { findRateLimitTimes, lockRateLimitSubject, recordRateLimitEvent, type RateLimitKind } from '../db/rateLimitRepo.js';
import { decideHourlyLimit, HOUR_MS, type SendDecision } from '../logic/emailCodes.js';

/**
 * How many times one address may be tried at login in an hour, whether or not the account exists
 */
export const MAX_LOGIN_ATTEMPTS_PER_ADDRESS_HOUR = 10;

/**
 * How many logins one network may try in an hour, whatever addresses they are for
 */
export const MAX_LOGIN_ATTEMPTS_PER_NETWORK_HOUR = 30;

/**
 * One hourly limit an attempt counts against
 */
export interface HourlyLimit
{
	kind: RateLimitKind;

	/**
	 * Keyed hash of what is limited (an address or a network), or null when it isn't known, which skips the limit
	 */
	subjectHash: Uint8Array | null;

	limit: number;
}

/**
 * Takes an attempt against hourly limits: when every limit allows it, records it against each. The
 * subjects stay locked until the transaction ends, so concurrent attempts are counted one after another
 *
 * @param limits The limits the attempt counts against
 * @param now The time now
 * @param executor A transaction
 * @return Whether the attempt may be made, and if not, when the first may
 */
export async function takeAttempt(limits: readonly HourlyLimit[], now: Date, executor: Executor): Promise<SendDecision>
{
	// Locks are taken in one order, so two transactions taking the same two never wait on each other
	const known = limits
		.filter((limit): limit is HourlyLimit & { subjectHash: Uint8Array } => (limit.subjectHash !== null))
		.sort((a, b) => Buffer.compare(Buffer.from(a.subjectHash), Buffer.from(b.subjectHash)));
	const since = new Date(now.getTime() - HOUR_MS);

	for (const { subjectHash } of known)
	{
		await lockRateLimitSubject(subjectHash, executor);
	}

	for (const { kind, subjectHash, limit } of known)
	{
		const decision = decideHourlyLimit(await findRateLimitTimes(kind, subjectHash, since, executor), limit, now);

		if (!decision.allowed)
		{
			return(decision);
		}
	}

	for (const { kind, subjectHash } of known)
	{
		await recordRateLimitEvent(kind, subjectHash, now, executor);
	}

	return({ allowed: true });
}
