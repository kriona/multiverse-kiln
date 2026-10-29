/**
 * Keyed hashes (HMAC-SHA256) of what the server must recognize again but not keep: email addresses
 * waiting on a code, the codes themselves, and networks (see Email codes in STRUCTURE-OVERVIEW.md)
 *
 * The key is AUTH_HMAC_KEY, so someone with a copy of the database but not the key can't test guesses
 * against the hashes. Changing the key makes every code waiting to be entered stop working and resets
 * the rate limits, which is harmless since both last a day at most
 */
import { createHmac, timingSafeEqual } from 'crypto';

/**
 * The fewest bytes AUTH_HMAC_KEY may have: as many as the hash's output
 */
const MIN_KEY_BYTES = 32;

/**
 * What a keyed hash is of. Each kind is hashed with its own label, so the same text hashed as two kinds
 * gives two unrelated hashes
 */
export type KeyedHashKind = 'address' | 'emailCode' | 'network';

let key: Buffer | undefined;

/**
 * Reads AUTH_HMAC_KEY the first time it is needed
 *
 * @return The key
 */
function getKey(): Buffer
{
	if (!key)
	{
		const value = process.env.AUTH_HMAC_KEY;

		if (!value)
		{
			throw new Error('AUTH_HMAC_KEY is not set. See server/.env.example');
		}

		const decoded = Buffer.from(value, 'base64');

		if (decoded.length < MIN_KEY_BYTES)
		{
			throw new Error(`AUTH_HMAC_KEY must be at least ${MIN_KEY_BYTES} bytes, written in base64`);
		}

		key = decoded;
	}

	return(key);
}

/**
 * Hashes text with the server's key
 *
 * @param kind What the text is
 * @param text The text, already normalized (an address in lowercase, a code as normalizeEmailCode() reads it)
 * @return The 32-byte hash
 */
export function keyedHash(kind: KeyedHashKind, text: string): Buffer
{
	return(createHmac('sha256', getKey())
		.update(`${kind}\0${text}`)
		.digest());
}

/**
 * The keyed hash of an email address, the same whatever capitals and surrounding spaces it was typed with
 *
 * @param address The address
 * @return The hash
 */
export function hashAddress(address: string): Buffer
{
	return(keyedHash('address', address.trim().toLowerCase()));
}

/**
 * Compares two hashes in time that doesn't depend on where they differ
 *
 * @param a A hash
 * @param b Another hash
 * @return Whether they are the same
 */
export function hashesMatch(a: Uint8Array, b: Uint8Array): boolean
{
	return((a.length === b.length) && timingSafeEqual(a, b));
}
