/**
 * Random tokens given to browsers in cookies, such as session tokens, and the hashes the server stores
 * in their place
 */
import { createHash, randomBytes } from 'crypto';

/**
 * How many random bytes a token has
 */
const TOKEN_BYTES = 32;

/**
 * A token as it is written in a cookie: 43 characters of URL-safe base64
 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Makes a new token
 *
 * @return The token, as written in a cookie
 */
export function createToken(): string
{
	return(randomBytes(TOKEN_BYTES).toString('base64url'));
}

/**
 * Whether text is in the form createToken() makes, checked before hashing what a browser sent
 *
 * @param text The text
 * @return Whether it could be a token
 */
export function isTokenForm(text: string): boolean
{
	return(TOKEN_PATTERN.test(text));
}

/**
 * The hash stored for a token. A token is random and long enough that it needs no key or slow hash:
 * SHA-256 is enough to stop a copy of the database from being used to log in
 *
 * @param token The token
 * @return Its 32-byte SHA-256
 */
export function hashToken(token: string): Buffer
{
	return(createHash('sha256')
		.update(token)
		.digest());
}
