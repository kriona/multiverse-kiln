/**
 * Password hashing: the one place that knows the current algorithm and its settings
 *
 * Hashes are stored as self-describing strings ($argon2id$v=19$m=19456,p=1,t=2$<salt>$<hash>), so a
 * stored hash says how to check it. When the settings here are raised, or the algorithm replaced, a
 * player's hash is replaced at their next login (checkLoginPassword()), and old hashes keep working
 * until then
 */
import argon2 from 'argon2';

/**
 * The current settings: OWASP's minimum for Argon2id (19 MiB of memory, 2 iterations, 1 thread)
 */
const ARGON2_OPTIONS = {
	type: argon2.argon2id,
	memoryCost: 19456,
	timeCost: 2,
	parallelism: 1
} as const;

/**
 * How a hash made with the current algorithm starts
 */
const CURRENT_PREFIX = '$argon2id$';

/**
 * Hashes a password with the current algorithm and settings
 *
 * @param password The password
 * @return The hash, as stored
 */
export async function hashPassword(password: string): Promise<string>
{
	return(await argon2.hash(password, ARGON2_OPTIONS));
}

/**
 * Checks a password against a stored hash, with whichever algorithm the hash names
 *
 * @param hash The stored hash
 * @param password The password typed
 * @return Whether the password is the one hashed
 */
export async function verifyPassword(hash: string, password: string): Promise<boolean>
{
	if (hash.startsWith(CURRENT_PREFIX))
	{
		try
		{
			return(await argon2.verify(hash, password));
		}
		catch (error)
		{
			console.error('A stored password hash could not be read:', error);
			return(false);
		}
	}

	console.error('A stored password hash names an algorithm the server doesn\'t know');

	return(false);
}

/**
 * Whether a stored hash was made with an older algorithm or older settings
 *
 * @param hash The stored hash
 * @return Whether it should be replaced
 */
export function passwordNeedsRehash(hash: string): boolean
{
	return(!hash.startsWith(CURRENT_PREFIX) || argon2.needsRehash(hash, ARGON2_OPTIONS));
}

/**
 * The result of checking a password at login
 */
export type LoginPasswordCheck = { correct: false } | { correct: true; newHash: string | undefined };

/**
 * Checks a password at login and, when it is correct and the stored hash is out of date, hashes it
 * again with the current settings. Login is the only time the server has the password, so it is the
 * only time a hash can be replaced
 *
 * @param hash The stored hash
 * @param password The password typed
 * @return Whether the password is correct, and the hash to store in place of the old one, if any
 */
export async function checkLoginPassword(hash: string, password: string): Promise<LoginPasswordCheck>
{
	if (!await verifyPassword(hash, password))
	{
		return({ correct: false });
	}

	return({
		correct: true,
		newHash: (passwordNeedsRehash(hash) ? await hashPassword(password) : undefined)
	});
}

let dummyHash: Promise<string> | undefined;

/**
 * Spends as long as checking a password takes, for a login to an address with no account, so how
 * long the answer takes doesn't tell whether the account exists
 *
 * @param password The password typed
 */
export async function checkPasswordForMissingAccount(password: string): Promise<void>
{
	dummyHash ??= hashPassword('a password no account has');

	await verifyPassword(await dummyHash, password);
}
