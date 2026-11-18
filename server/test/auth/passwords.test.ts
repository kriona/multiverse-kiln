import assert from 'assert';
import argon2 from 'argon2';

import { checkLoginPassword, checkPasswordForMissingAccount, hashPassword, passwordNeedsRehash, verifyPassword } from '../../src/auth/passwords.js';

/**
 * The settings a new hash is made with, read by name: the order a hash writes them in depends on the
 * argon2 library's version
 */
const CURRENT_SETTINGS = {
	memoryCost: 19456,
	timeCost: 2,
	parallelism: 1
};

describe('passwords', () =>
{
	it('hashes with Argon2id at the current settings', async () =>
	{
		const hash = await hashPassword('correct horse battery staple');

		assert.ok(hash.startsWith('$argon2id$v=19$'), hash);
		assert.strictEqual(argon2.needsRehash(hash, CURRENT_SETTINGS), false, hash);
		assert.strictEqual(passwordNeedsRehash(hash), false);
	});

	it('checks and keeps a hash whatever order its settings are written in', async () =>
	{
		const parts = (await hashPassword('correct horse battery staple')).split('$');

		parts[3] = parts[3]
			.split(',')
			.reverse()
			.join(',');

		const reordered = parts.join('$');

		assert.strictEqual(await verifyPassword(reordered, 'correct horse battery staple'), true);
		assert.strictEqual(await verifyPassword(reordered, 'Correct horse battery staple'), false);
		assert.strictEqual(passwordNeedsRehash(reordered), false);
	});

	it('verifies the right password and rejects others', async () =>
	{
		const hash = await hashPassword('correct horse battery staple');

		assert.strictEqual(await verifyPassword(hash, 'correct horse battery staple'), true);
		assert.strictEqual(await verifyPassword(hash, 'Correct horse battery staple'), false);
	});

	it('gives the same password a different hash each time', async () =>
	{
		assert.notStrictEqual(await hashPassword('same password'), await hashPassword('same password'));
	});

	it('rejects hashes from algorithms it doesn\'t know', async () =>
	{
		assert.strictEqual(await verifyPassword('$2b$10$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz01234', 'password'), false);
		assert.strictEqual(await verifyPassword('$argon2id$garbage', 'password'), false);
		assert.strictEqual(passwordNeedsRehash('$2b$10$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz01234'), true);
	});

	describe('checkLoginPassword', () =>
	{
		it('keeps a current hash', async () =>
		{
			const hash = await hashPassword('correct horse battery staple');

			assert.deepStrictEqual(await checkLoginPassword(hash, 'correct horse battery staple'), {
				correct: true,
				newHash: undefined
			});
		});

		it('replaces a hash made with older settings, which still verifies', async () =>
		{
			const oldHash = await argon2.hash('correct horse battery staple', {
				type: argon2.argon2id,
				memoryCost: 8192,
				timeCost: 1,
				parallelism: 1
			});

			assert.strictEqual(passwordNeedsRehash(oldHash), true);

			const check = await checkLoginPassword(oldHash, 'correct horse battery staple');

			assert.ok(check.correct);
			assert.ok(check.newHash);
			assert.strictEqual(passwordNeedsRehash(check.newHash), false);
			assert.strictEqual(await verifyPassword(check.newHash, 'correct horse battery staple'), true);
		});

		it('doesn\'t replace a hash when the password is wrong', async () =>
		{
			const oldHash = await argon2.hash('correct horse battery staple', {
				type: argon2.argon2id,
				memoryCost: 8192,
				timeCost: 1,
				parallelism: 1
			});

			assert.deepStrictEqual(await checkLoginPassword(oldHash, 'wrong'), { correct: false });
		});
	});

	it('spends the time of a check for an account that doesn\'t exist', async () =>
	{
		await checkPasswordForMissingAccount('anything');
	});
});
