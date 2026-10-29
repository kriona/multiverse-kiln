/**
 * The rules of 2FA (see Login in STRUCTURE-OVERVIEW.md): authenticator codes (TOTP, RFC 6238, as every
 * authenticator app makes them: HMAC-SHA1, 6 digits, a new code every 30 seconds) and recovery codes,
 * which work once each in place of an authenticator code
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { EMAIL_CODE_ALPHABET, RECOVERY_CODE_LENGTH, TWO_FACTOR_CODE_LENGTH } from '@multiverse-kiln/shared';

import { normalizeAlphabetCode } from './emailCodes.js';

export { RECOVERY_CODE_LENGTH };

/**
 * How many random bytes an authenticator secret has: 160 bits, as RFC 4226 recommends
 */
export const TOTP_SECRET_BYTES = 20;

/**
 * How many seconds each authenticator code lasts
 */
export const TOTP_STEP_SECONDS = 30;

/**
 * How many steps either side of now a code is accepted from, for clocks that are a little out
 */
const TOTP_ALLOWED_DRIFT_STEPS = 1;

/**
 * How long a player has to scan the secret and enter a code before setting up 2FA must start again
 */
export const TWO_FACTOR_SETUP_LIFETIME_MS = (15 * 60 * 1000);

/**
 * How many wrong codes end a login waiting on 2FA, which must then start again with the password
 */
export const MAX_WRONG_TWO_FACTOR_CODES_PER_LOGIN = 5;

/**
 * How many authenticator or recovery codes one account may try in an hour, wherever they are typed
 */
export const MAX_TWO_FACTOR_ATTEMPTS_PER_ACCOUNT_HOUR = 10;

/**
 * The letters of RFC 4648's base32, which authenticator apps read secrets in
 */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * A code as the player typed it, once read: from an authenticator app, or a recovery code
 */
export type TwoFactorCode = { kind: 'totp'; code: string } | { kind: 'recovery'; code: string };

/**
 * Writes bytes in RFC 4648's base32, without padding, as authenticator apps take secrets
 *
 * @param bytes The bytes
 * @return The text
 */
export function encodeBase32(bytes: Uint8Array): string
{
	let text = '';
	let buffer = 0;
	let bits = 0;

	for (const byte of bytes)
	{
		buffer = ((buffer << 8) | byte);
		bits += 8;

		while (bits >= 5)
		{
			text += BASE32_ALPHABET[(buffer >> (bits - 5)) & 31];
			bits -= 5;
		}
	}

	if (bits > 0)
	{
		text += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
	}

	return(text);
}

/**
 * The time step a moment falls in
 *
 * @param now The moment
 * @return The number of whole steps since 1970
 */
export function totpStep(now: Date): number
{
	return(Math.floor(now.getTime() / 1000 / TOTP_STEP_SECONDS));
}

/**
 * The authenticator code for a time step (RFC 4226's HOTP, with the step as its counter)
 *
 * @param secret The secret the app was given
 * @param step The time step
 * @return The code: TWO_FACTOR_CODE_LENGTH digits
 */
export function totpCode(secret: Uint8Array, step: number): string
{
	const counter = Buffer.alloc(8);

	counter.writeBigUInt64BE(BigInt(step));

	const digest = createHmac('sha1', secret)
		.update(counter)
		.digest();
	const offset = (digest[digest.length - 1] & 15);
	const value = (digest.readUInt32BE(offset) & 0x7fffffff);

	return(String(value % (10 ** TWO_FACTOR_CODE_LENGTH)).padStart(TWO_FACTOR_CODE_LENGTH, '0'));
}

/**
 * Finds the time step an authenticator code was made for, near now. A step no later than the last one
 * used doesn't count, so a code works once, even within its 30 seconds
 *
 * @param secret The secret
 * @param code The code, as readTwoFactorCode() read it
 * @param now The time now
 * @param lastUsedStep The step of the last code the account used, or null when it hasn't used one
 * @return The code's step, or undefined when it isn't right
 */
export function matchTotpCode(secret: Uint8Array, code: string, now: Date, lastUsedStep: number | null): number | undefined
{
	const current = totpStep(now);
	const typed = Buffer.from(code);
	let matched: number | undefined;

	// Every step is checked, so the time taken doesn't tell which one matched
	for (let step = (current - TOTP_ALLOWED_DRIFT_STEPS); step <= (current + TOTP_ALLOWED_DRIFT_STEPS); step++)
	{
		const expected = Buffer.from(totpCode(secret, step));

		if (timingSafeEqual(expected, typed) && ((lastUsedStep === null) || (step > lastUsedStep)))
		{
			matched = step;
		}
	}

	return(matched);
}

/**
 * Makes a recovery code from random bytes, each byte giving one character from its low 5 bits
 *
 * @param randomBytes At least RECOVERY_CODE_LENGTH bytes from a cryptographically secure random number generator
 * @return The code, as stored and checked
 */
export function recoveryCodeFromBytes(randomBytes: Uint8Array): string
{
	if (randomBytes.length < RECOVERY_CODE_LENGTH)
	{
		throw new Error(`A recovery code needs ${RECOVERY_CODE_LENGTH} random bytes, not ${randomBytes.length}`);
	}

	let code = '';

	for (let i = 0; i < RECOVERY_CODE_LENGTH; i++)
	{
		code += EMAIL_CODE_ALPHABET[randomBytes[i] & 31];
	}

	return(code);
}

/**
 * A recovery code as shown to the player: in two halves, which are easier to copy by hand
 *
 * @param code The code
 * @return The code with a dash in the middle
 */
export function formatRecoveryCode(code: string): string
{
	const half = (code.length / 2);

	return(`${code.slice(0, half)}-${code.slice(half)}`);
}

/**
 * Reads a code as the player typed it: TWO_FACTOR_CODE_LENGTH digits from an authenticator app, or a
 * recovery code, read as forgivingly as an email code (case, spaces and dashes don't matter, and O, I
 * and L count as 0, 1 and 1)
 *
 * @param typed What the player typed
 * @return The code, or undefined when what was typed can't be either
 */
export function readTwoFactorCode(typed: string): TwoFactorCode | undefined
{
	const digits = typed.replace(/[\s-]/g, '');

	if (new RegExp(`^[0-9]{${TWO_FACTOR_CODE_LENGTH}}$`).test(digits))
	{
		return({
			kind: 'totp',
			code: digits
		});
	}

	const recovery = normalizeAlphabetCode(typed, RECOVERY_CODE_LENGTH);

	return(((recovery === undefined) ? undefined : {
		kind: 'recovery',
		code: recovery
	}));
}

/**
 * The otpauth:// URI an authenticator app scans to add an account (Google Authenticator's Key Uri
 * Format). It holds the secret, so it is only drawn as a QR code, never linked to
 *
 * @param secretBase32 The secret, in base32
 * @param issuer The site's name, which the app shows the account under
 * @param accountName How the app tells this account apart from others on the site, such as the username
 * @return The URI
 */
export function totpUri(secretBase32: string, issuer: string, accountName: string): string
{
	const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}`;
	const parameters = new URLSearchParams({
		secret: secretBase32,
		issuer,
		algorithm: 'SHA1',
		digits: String(TWO_FACTOR_CODE_LENGTH),
		period: String(TOTP_STEP_SECONDS)
	});

	return(`otpauth://totp/${label}?${parameters.toString()}`);
}
