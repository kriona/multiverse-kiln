import assert from 'assert';

import { hashAddress, hashesMatch, keyedHash } from '../../src/auth/keyedHashes.js';
import { createToken, hashToken, isTokenForm } from '../../src/auth/tokens.js';

describe('keyedHashes', () =>
{
	it('gives 32-byte hashes that are the same for the same text', () =>
	{
		const hash = keyedHash('emailCode', 'AB12CD');

		assert.strictEqual(hash.length, 32);
		assert.ok(hashesMatch(hash, keyedHash('emailCode', 'AB12CD')));
		assert.ok(!hashesMatch(hash, keyedHash('emailCode', 'AB12CE')));
	});

	it('hashes the same text differently for each kind', () =>
	{
		assert.ok(!hashesMatch(keyedHash('address', '192.0.2.1'), keyedHash('network', '192.0.2.1')));
	});

	it('hashes an address the same whatever its capitals and surrounding spaces', () =>
	{
		assert.ok(hashesMatch(hashAddress(' Ada@Example.com '), hashAddress('ada@example.com')));
	});

	it('doesn\'t match hashes of different lengths', () =>
	{
		assert.ok(!hashesMatch(new Uint8Array(32), new Uint8Array(31)));
	});
});

describe('tokens', () =>
{
	it('makes a different token each time, in the form it accepts', () =>
	{
		const token = createToken();

		assert.ok(isTokenForm(token));
		assert.notStrictEqual(token, createToken());
	});

	it('refuses text that isn\'t a token', () =>
	{
		assert.ok(!isTokenForm(''));
		assert.ok(!isTokenForm(`${createToken()}a`));
		assert.ok(!isTokenForm('!'.repeat(43)));
	});

	it('hashes a token to 32 bytes', () =>
	{
		const token = createToken();

		assert.strictEqual(hashToken(token).length, 32);
		assert.ok(hashesMatch(hashToken(token), hashToken(token)));
	});
});
