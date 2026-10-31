/**
 * Authenticator secrets, stored encrypted (AES-256-GCM) with TOTP_ENCRYPTION_KEY, a server setting kept
 * apart from the database, so a copy of the database alone can't make an account's codes
 *
 * Each secret is encrypted with its account's ID as associated data, so a secret copied onto another
 * account's row doesn't decrypt. Changing the key leaves every stored secret unreadable, which turns
 * 2FA off in practice for every account that has it, so the key must be kept as long as the database
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * The bytes AES-256 takes as its key
 */
const KEY_BYTES = 32;

/**
 * GCM's nonce, random for each encryption
 */
const IV_BYTES = 12;

/**
 * GCM's authentication tag
 */
const TAG_BYTES = 16;

/**
 * The first byte of every stored secret, naming how it was encrypted, so another scheme can be told apart later
 */
const FORMAT_VERSION = 1;

let key: Buffer | undefined;

/**
 * Reads TOTP_ENCRYPTION_KEY the first time it is needed
 *
 * @return The key
 */
function getKey(): Buffer
{
	if (!key)
	{
		const value = process.env.TOTP_ENCRYPTION_KEY;

		if (!value)
		{
			throw new Error('TOTP_ENCRYPTION_KEY is not set. See server/.env.example');
		}

		const decoded = Buffer.from(value, 'base64');

		if (decoded.length !== KEY_BYTES)
		{
			throw new Error(`TOTP_ENCRYPTION_KEY must be ${KEY_BYTES} bytes, written in base64`);
		}

		key = decoded;
	}

	return(key);
}

/**
 * Encrypts an authenticator secret for storing
 *
 * @param secret The secret
 * @param playerId The account it belongs to
 * @return The format version, nonce, tag and ciphertext, in that order
 */
export function encryptTotpSecret(secret: Uint8Array, playerId: string): Buffer
{
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv('aes-256-gcm', getKey(), iv);

	cipher.setAAD(Buffer.from(playerId));

	const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);

	return(Buffer.concat([Buffer.from([FORMAT_VERSION]), iv, cipher.getAuthTag(), ciphertext]));
}

/**
 * Decrypts a stored authenticator secret
 *
 * @param stored What encryptTotpSecret() made
 * @param playerId The account it belongs to
 * @return The secret
 * @throws Error when it wasn't encrypted for that account with the current key
 */
export function decryptTotpSecret(stored: Uint8Array, playerId: string): Buffer
{
	const bytes = Buffer.from(stored);

	if ((bytes.length <= (1 + IV_BYTES + TAG_BYTES)) || (bytes[0] !== FORMAT_VERSION))
	{
		throw new Error('An authenticator secret is stored in a form this server can\'t read');
	}

	const iv = bytes.subarray(1, 1 + IV_BYTES);
	const tag = bytes.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
	const decipher = createDecipheriv('aes-256-gcm', getKey(), iv);

	decipher.setAAD(Buffer.from(playerId));
	decipher.setAuthTag(tag);

	return(Buffer.concat([decipher.update(bytes.subarray(1 + IV_BYTES + TAG_BYTES)), decipher.final()]));
}
