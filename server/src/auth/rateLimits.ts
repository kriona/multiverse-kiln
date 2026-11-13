/**
 * Counting attempts against limits, such as logins from one network in an hour, so many requests sent
 * at once can't each slip under a limit
 */
import type { Executor } from '../db/client.js';
import { findRateLimitTimes, lockRateLimitSubject, recordRateLimitEvent, type RateLimitKind } from '../db/rateLimitRepo.js';
import { decideCodeSend, decidePasswordAttempt, type BotCheckDecision, type BotCheckState, type CodeSendDecision, type PasswordSource } from '../logic/botChecks.js';
import { DAY_MS, decideLimit, HOUR_MS, MAX_EMAIL_CODES_PER_NETWORK_HOUR, type SendDecision } from '../logic/emailCodes.js';

// The login limits, decided with the bot checks that extend them
export { MAX_LOGIN_ATTEMPTS_PER_ADDRESS_HOUR, MAX_LOGIN_ATTEMPTS_PER_BROWSER_HOUR, MAX_LOGIN_ATTEMPTS_PER_NETWORK_HOUR } from '../logic/botChecks.js';

/**
 * How many usernames one network may check in an hour while creating accounts. Enough for a player
 * trying names as they type, too few to list who has an account
 */
export const MAX_USERNAME_CHECKS_PER_NETWORK_HOUR = 60;

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

/**
 * Who a password is given for, and from where
 */
export interface PasswordAttemptSubjects
{
	source: PasswordSource;

	/**
	 * Keyed hash of the network, or null when it isn't known
	 */
	networkHash: Uint8Array | null;

	/**
	 * Keyed hash of the address, or null when the account has none: for every source but 'knownBrowser'
	 */
	addressHash: Uint8Array | null;

	/**
	 * Keyed hash of the browser that has logged in to the account (knownBrowserHash()), for 'knownBrowser'
	 */
	browserHash?: Uint8Array;
}

/**
 * The times of a subject's attempts of a kind in a window before now, or none when the subject isn't known
 *
 * @param kind What is counted
 * @param subjectHash The subject, or null
 * @param windowMs The window
 * @param now The time now
 * @param executor A transaction, or undefined for the database
 * @return The times
 */
async function timesOf(kind: RateLimitKind, subjectHash: Uint8Array | null | undefined, windowMs: number, now: Date, executor: Executor | undefined): Promise<Date[]>
{
	return((subjectHash ? await findRateLimitTimes(kind, subjectHash, new Date(now.getTime() - windowMs), executor) : []));
}

/**
 * Takes a login try, or a logged-in account's password given again, against the network's and the
 * address's limits (or the known browser's), asking for a bot check past their soft limits and letting a
 * passed one through past the address's hard limit (decidePasswordAttempt()). A request that needs a
 * check counts against the network only; one refused counts against nothing
 *
 * @param subjects Who the password is for, and from where
 * @param check Whether checks are on and the request passed one
 * @param now The time now
 * @param executor A transaction, which must be committed even when the try is refused, so it counts; or
 * undefined to only decide, without locking or counting anything, before the transaction (confirmBotChecks())
 * @return What to do
 */
export async function takePasswordAttempt(subjects: PasswordAttemptSubjects, check: BotCheckState, now: Date, executor: Executor | undefined): Promise<BotCheckDecision>
{
	const { source, networkHash } = subjects;
	const ownHash = ((source === 'knownBrowser') ? (subjects.browserHash ?? null) : subjects.addressHash);
	const ownKind: RateLimitKind = ((source === 'knownBrowser') ? 'browserLoginAttempt' : 'addressLoginAttempt');

	if (executor)
	{
		await lockRateLimitSubjects([networkHash, ownHash], executor);
	}

	const decision = decidePasswordAttempt(source, {
		network: await timesOf('networkLoginAttempt', networkHash, HOUR_MS, now, executor),
		address: ((ownHash === null) ? null : await timesOf(ownKind, ownHash, HOUR_MS, now, executor)),
		checked: ((source === 'knownBrowser') ? [] : await timesOf('addressCheckedLoginAttempt', ownHash, HOUR_MS, now, executor))
	}, check, now);

	if (!executor || (decision.kind === 'refused'))
	{
		return(decision);
	}

	if (networkHash)
	{
		await recordRateLimitEvent('networkLoginAttempt', networkHash, now, executor);
	}

	if (ownHash && (decision.kind !== 'checkNeeded'))
	{
		await recordRateLimitEvent(((decision.kind === 'allowChecked') ? 'addressCheckedLoginAttempt' : ownKind), ownHash, now, executor);
	}

	return(decision);
}

/**
 * Takes a request to send an email code against the network's limit and the address's
 * (decideCodeSend()), asking for a bot check past their soft limits and letting a passed one through past
 * the address's limits. Every request the network's limit lets through counts against it; the address's
 * counts are kept whether or not it has an account, so the limits don't tell whether it does
 *
 * @param networkHash Keyed hash of the network asking, or null when it isn't known
 * @param addressHash Keyed hash of the address the code goes to
 * @param check Whether checks are on and the request passed one
 * @param now The time now
 * @param executor A transaction, which must be committed even when the code can't be sent, so the request
 * counts; or undefined to only decide, without locking or counting anything, before the transaction
 * @return What to do
 */
export async function takeCodeSend(networkHash: Uint8Array | null, addressHash: Uint8Array, check: BotCheckState, now: Date, executor: Executor | undefined): Promise<CodeSendDecision>
{
	if (executor)
	{
		// Both at once, in the order logins lock the same network and address
		await lockRateLimitSubjects([networkHash, addressHash], executor);
	}

	const network = await timesOf('networkCodeRequest', networkHash, HOUR_MS, now, executor);
	const decision = decideCodeSend({
		network,
		sent: await timesOf('addressCodeSent', addressHash, HOUR_MS, now, executor),
		wrongGuesses: await timesOf('addressWrongGuess', addressHash, DAY_MS, now, executor),
		checkedSent: await timesOf('addressCheckedCodeSent', addressHash, HOUR_MS, now, executor),
		checkedWhileBlocked: await timesOf('addressCheckedCodeWhileBlocked', addressHash, DAY_MS, now, executor)
	}, check, now);

	if (!executor)
	{
		return(decision);
	}

	// Every request the network's own limit lets through counts against it, even one the address's refuses
	if (networkHash && decideLimit(network, MAX_EMAIL_CODES_PER_NETWORK_HOUR, HOUR_MS, now).allowed)
	{
		await recordRateLimitEvent('networkCodeRequest', networkHash, now, executor);
	}

	if (decision.kind === 'allow')
	{
		await recordRateLimitEvent('addressCodeSent', addressHash, now, executor);
	}
	else if (decision.kind === 'allowChecked')
	{
		if (decision.pastHourly)
		{
			await recordRateLimitEvent('addressCheckedCodeSent', addressHash, now, executor);
		}

		if (decision.whileBlocked)
		{
			await recordRateLimitEvent('addressCheckedCodeWhileBlocked', addressHash, now, executor);
		}
	}

	return(decision);
}
