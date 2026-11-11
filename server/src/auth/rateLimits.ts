/**
 * Counting attempts against limits, such as logins from one network in an hour, so many requests sent
 * at once can't each slip under a limit
 */
import type { Executor } from '../db/client.js';
import { findRateLimitTimes, lockRateLimitSubject, recordRateLimitEvent, type RateLimitKind } from '../db/rateLimitRepo.js';
import { decideLimit, HOUR_MS, type SendDecision } from '../logic/emailCodes.js';

/**
 * How many times one address may be tried at login in an hour, whether or not the account exists
 */
export const MAX_LOGIN_ATTEMPTS_PER_ADDRESS_HOUR = 10;

/**
 * How many times a browser that has logged in to an account may try logging in to it again in an hour.
 * Its tries are counted in place of the address's, so others' guesses at the address can't lock it out
 */
export const MAX_LOGIN_ATTEMPTS_PER_BROWSER_HOUR = 10;

/**
 * How many usernames one network may check in an hour while creating accounts. Enough for a player
 * trying names as they type, too few to list who has an account
 */
export const MAX_USERNAME_CHECKS_PER_NETWORK_HOUR = 60;

/**
 * How many logins one network may try in an hour, whatever addresses they are for
 */
export const MAX_LOGIN_ATTEMPTS_PER_NETWORK_HOUR = 30;

/**
 * How many times one player may be emailed that they were given a role in one universe in a day, so a
 * creator can't flood them by adding, saving and removing them again and again
 */
export const MAX_ROLE_EMAILS_PER_UNIVERSE_PLAYER_DAY = 1;

/**
 * How many times one player may be emailed that they were given a role in a day, whatever universes
 * the roles are in, so creators of many universes can't flood them either
 */
export const MAX_ROLE_EMAILS_PER_PLAYER_DAY = 10;

/**
 * One limit an attempt counts against
 */
export interface AttemptLimit
{
	kind: RateLimitKind;

	/**
	 * Keyed hash of what is limited (such as an address or a network), or null when it isn't known, which
	 * skips the limit
	 */
	subjectHash: Uint8Array | null;

	/**
	 * How many attempts the window allows
	 */
	limit: number;

	/**
	 * How long the window counted is: an hour when left out. The auth sweep deletes each kind's attempts
	 * once they are older than its window (server/src/authSweep.ts)
	 */
	windowMs?: number;
}

/**
 * Locks rate limit subjects until the transaction ends, in order of their hashes. Every caller locking
 * more than one subject goes through here, so two transactions locking the same ones never wait on each other
 *
 * @param subjectHashes Keyed hashes of the subjects, or null for one that isn't known, which is skipped
 * @param executor A transaction
 */
export async function lockRateLimitSubjects(subjectHashes: readonly (Uint8Array | null)[], executor: Executor): Promise<void>
{
	const known = subjectHashes
		.filter((subjectHash): subjectHash is Uint8Array => (subjectHash !== null))
		.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));

	for (const subjectHash of known)
	{
		await lockRateLimitSubject(subjectHash, executor);
	}
}

/**
 * Takes an attempt against limits: when every limit allows it, records it against each. The subjects
 * stay locked until the transaction ends, so concurrent attempts are counted one after another
 *
 * @param limits The limits the attempt counts against
 * @param now The time now
 * @param executor A transaction
 * @return Whether the attempt may be made, and if not, when the first may
 */
export async function takeAttempt(limits: readonly AttemptLimit[], now: Date, executor: Executor): Promise<SendDecision>
{
	const known = limits.filter((limit): limit is AttemptLimit & { subjectHash: Uint8Array } => (limit.subjectHash !== null));

	await lockRateLimitSubjects(known.map((limit) => limit.subjectHash), executor);

	for (const { kind, subjectHash, limit, windowMs = HOUR_MS } of known)
	{
		const since = new Date(now.getTime() - windowMs);
		const decision = decideLimit(await findRateLimitTimes(kind, subjectHash, since, executor), limit, windowMs, now);

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
