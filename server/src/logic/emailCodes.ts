/**
 * The rules every email code follows (see Email codes in STRUCTURE-OVERVIEW.md): how a code is made
 * and read back, how long it lasts, and how often codes may be sent and guessed
 *
 * The callers keep the counts these functions decide from, updating them atomically, and supply the
 * random bytes and the time, so these stay pure
 */
import { EMAIL_CODE_ALPHABET, EMAIL_CODE_LENGTH, EMAIL_CODE_LIFETIME_MINUTES } from '@multiverse-kiln/shared';

export { EMAIL_CODE_ALPHABET, EMAIL_CODE_LENGTH };

/**
 * How long a code works after it is sent, in milliseconds
 */
export const EMAIL_CODE_LIFETIME_MS = (EMAIL_CODE_LIFETIME_MINUTES * 60 * 1000);

/**
 * How long the browser that entered a code has to take the next step, such as choosing a password, in milliseconds
 */
export const CONTINUATION_LIFETIME_MS = (10 * 60 * 1000);

/**
 * How long after sending a code another may be sent to the same address, in milliseconds
 */
export const EMAIL_CODE_RESEND_MS = (60 * 1000);

/**
 * How many codes may be sent to one address in an hour
 */
export const MAX_EMAIL_CODES_PER_ADDRESS_HOUR = 5;

/**
 * How many wrong guesses end a code
 */
export const MAX_WRONG_GUESSES_PER_CODE = 5;

/**
 * How many wrong guesses in a day, across every code for an address, stop codes being sent to it
 */
export const MAX_WRONG_GUESSES_PER_ADDRESS_DAY = 15;

/**
 * How many codes one network may ask for in an hour, whatever addresses they are for
 */
export const MAX_EMAIL_CODES_PER_NETWORK_HOUR = 10;

/**
 * How many guesses one network may make in an hour, whatever addresses they are for
 */
export const MAX_GUESSES_PER_NETWORK_HOUR = 30;

export const HOUR_MS = (60 * 60 * 1000);
export const DAY_MS = (24 * HOUR_MS);

/**
 * How typed characters that look like a code's characters are read
 */
const LOOKALIKES: Readonly<Record<string, string>> = {
	O: '0',
	I: '1',
	L: '1'
};

/**
 * Makes a code from random bytes
 *
 * Each byte gives one character from its low 5 bits. 256 is a multiple of 32, so every character is
 * equally likely
 *
 * @param randomBytes At least EMAIL_CODE_LENGTH bytes from a cryptographically secure random number generator
 * @return The code
 */
export function emailCodeFromBytes(randomBytes: Uint8Array): string
{
	if (randomBytes.length < EMAIL_CODE_LENGTH)
	{
		throw new Error(`An email code needs ${EMAIL_CODE_LENGTH} random bytes, not ${randomBytes.length}`);
	}

	let code = '';

	for (let i = 0; i < EMAIL_CODE_LENGTH; i++)
	{
		code += EMAIL_CODE_ALPHABET[randomBytes[i] & 31];
	}

	return(code);
}

/**
 * Reads a code as the player typed it: case is ignored, spaces and dashes are removed, and O, I and L
 * are read as 0, 1 and 1
 *
 * @param typed What the player typed
 * @return The code, or undefined when what was typed can't be a code
 */
export function normalizeEmailCode(typed: string): string | undefined
{
	return(normalizeAlphabetCode(typed, EMAIL_CODE_LENGTH));
}

/**
 * Reads a code of EMAIL_CODE_ALPHABET's characters as the player typed it, the way normalizeEmailCode()
 * does, for codes of any length (such as recovery codes)
 *
 * @param typed What the player typed
 * @param length How many characters the code has
 * @return The code, or undefined when what was typed can't be a code of that length
 */
export function normalizeAlphabetCode(typed: string, length: number): string | undefined
{
	const code = [...typed.toUpperCase().replace(/[\s-]/g, '')]
		.map((character) => (LOOKALIKES[character] ?? character))
		.join('');

	if (code.length !== length)
	{
		return(undefined);
	}

	for (const character of code)
	{
		if (!EMAIL_CODE_ALPHABET.includes(character))
		{
			return(undefined);
		}
	}

	return(code);
}

/**
 * What is known about the codes recently sent to and guessed for one address
 */
export interface AddressCodeHistory
{
	/**
	 * When each code was sent to the address in the past hour
	 */
	sentAt: readonly Date[];

	/**
	 * When each wrong guess for the address was made in the past day
	 */
	wrongGuessesAt: readonly Date[];
}

/**
 * Whether a code may be sent, and if not, when one may
 */
export type SendDecision = { allowed: true } | { allowed: false; retryAt: Date };

/**
 * The latest of some times
 *
 * @param times The times, at least one
 * @return The latest
 */
function latest(times: readonly Date[]): Date
{
	return(new Date(Math.max(...times.map((time) => time.getTime()))));
}

/**
 * Only the times within a window before now
 *
 * @param times The times
 * @param now The time now
 * @param windowMs How far back the window reaches, in milliseconds
 * @return The times after now - windowMs
 */
function within(times: readonly Date[], now: Date, windowMs: number): Date[]
{
	return(times.filter((time) => (time.getTime() > (now.getTime() - windowMs))));
}

/**
 * Decides whether a new code may be sent to an address
 *
 * A code may be sent once every EMAIL_CODE_RESEND_MS and MAX_EMAIL_CODES_PER_ADDRESS_HOUR times an
 * hour, and not at all while the address has MAX_WRONG_GUESSES_PER_ADDRESS_DAY wrong guesses in the
 * past day, until the oldest of them is a day old
 *
 * @param history The address's codes and wrong guesses
 * @param now The time now
 * @return Whether a code may be sent
 */
export function decideEmailCodeSend(history: AddressCodeHistory, now: Date): SendDecision
{
	const sent = within(history.sentAt, now, HOUR_MS);
	const wrongGuesses = within(history.wrongGuessesAt, now, DAY_MS);
	const waits: Date[] = [];

	if (sent.length > 0)
	{
		const lastSent = latest(sent);

		if ((now.getTime() - lastSent.getTime()) < EMAIL_CODE_RESEND_MS)
		{
			waits.push(new Date(lastSent.getTime() + EMAIL_CODE_RESEND_MS));
		}
	}

	if (sent.length >= MAX_EMAIL_CODES_PER_ADDRESS_HOUR)
	{
		// Once enough of the oldest sends are an hour old, the count drops below the limit
		const sorted = [...sent].sort((a, b) => (a.getTime() - b.getTime()));

		waits.push(new Date(sorted[sent.length - MAX_EMAIL_CODES_PER_ADDRESS_HOUR].getTime() + HOUR_MS));
	}

	if (wrongGuesses.length >= MAX_WRONG_GUESSES_PER_ADDRESS_DAY)
	{
		const sorted = [...wrongGuesses].sort((a, b) => (a.getTime() - b.getTime()));

		waits.push(new Date(sorted[wrongGuesses.length - MAX_WRONG_GUESSES_PER_ADDRESS_DAY].getTime() + DAY_MS));
	}

	if (waits.length === 0)
	{
		return({ allowed: true });
	}

	return({
		allowed: false,
		retryAt: latest(waits)
	});
}

/**
 * A code that was sent, as stored
 */
export interface SentEmailCode
{
	sentAt: Date;

	/**
	 * When it was used, or null while it hasn't been
	 */
	usedAt: Date | null;

	wrongGuesses: number;
}

/**
 * Whether a code can still be guessed: 'open' while it can, otherwise why not
 */
export type EmailCodeState = 'open' | 'expired' | 'used' | 'exhausted';

/**
 * Whether a code can still be guessed
 *
 * @param code The code
 * @param now The time now
 * @return 'open', or why the code no longer works
 */
export function emailCodeState(code: SentEmailCode, now: Date): EmailCodeState
{
	if (code.usedAt !== null)
	{
		return('used');
	}

	if (code.wrongGuesses >= MAX_WRONG_GUESSES_PER_CODE)
	{
		return('exhausted');
	}

	if ((now.getTime() - code.sentAt.getTime()) >= EMAIL_CODE_LIFETIME_MS)
	{
		return('expired');
	}

	return('open');
}

/**
 * Decides whether an hourly limit, such as one network's codes or guesses, lets another attempt through
 *
 * @param attemptsAt When each attempt was made in the past hour
 * @param limit How many attempts may be made in an hour
 * @param now The time now
 * @return Whether the attempt may be made
 */
export function decideHourlyLimit(attemptsAt: readonly Date[], limit: number, now: Date): SendDecision
{
	const recent = within(attemptsAt, now, HOUR_MS).sort((a, b) => (a.getTime() - b.getTime()));

	if (recent.length < limit)
	{
		return({ allowed: true });
	}

	return({
		allowed: false,
		retryAt: new Date(recent[recent.length - limit].getTime() + HOUR_MS)
	});
}
