import assert from 'assert';
import { randomBytes } from 'crypto';

import { decryptTotpSecret, encryptTotpSecret } from '../../src/auth/totpSecrets.js';

const ADA = '00000000-0000-4000-8000-000000000001';
const GRACE = '00000000-0000-4000-8000-000000000002';

describe('totpSecrets', () =>
{
	it('decrypts what it encrypted, for the same account', () =>
	{
		const secret = randomBytes(20);

		assert.deepStrictEqual(decryptTotpSecret(encryptTotpSecret(secret, ADA), ADA), secret);
	});

	it('never stores the secret as it is, and encrypts it differently each time', () =>
	{
		const secret = randomBytes(20);
		const first = encryptTotpSecret(secret, ADA);

		assert.strictEqual(first.includes(secret), false);
		assert.notDeepStrictEqual(encryptTotpSecret(secret, ADA), first);
	});

	it('refuses a secret moved to another account, or changed', () =>
	{
		const stored = encryptTotpSecret(randomBytes(20), ADA);

		assert.throws(() => decryptTotpSecret(stored, GRACE));

		stored[stored.length - 1] ^= 1;
		assert.throws(() => decryptTotpSecret(stored, ADA));
	});
});
