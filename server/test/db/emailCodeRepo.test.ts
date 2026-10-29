import assert from 'assert';

import { hashAddress, keyedHash } from '../../src/auth/keyedHashes.js';
import { createToken, hashToken } from '../../src/auth/tokens.js';
import { deleteEmailCode, deleteStaleEmailCodes, lockContinuation, lockEmailCode, recordWrongEmailCodeGuess, replaceEmailCode, useEmailCode } from '../../src/db/emailCodeRepo.js';
import { loadOrCreatePlayerByName } from '../../src/db/playerRepo.js';
import { inTransaction } from '../../src/db/transactions.js';
import { EMAIL_CODE_LIFETIME_MS } from '../../src/logic/emailCodes.js';

const NOW = new Date('2026-10-29T12:00:00Z');
const ADDRESS = hashAddress('ada@example.com');

/**
 * Stores a registration code for ADDRESS
 *
 * @param code The code
 * @param now When it was sent
 */
async function sendRegisterCode(code: string, now: Date = NOW): Promise<void>
{
	await replaceEmailCode({
		purpose: 'register',
		addressHash: ADDRESS,
		playerId: null,
		codeHash: keyedHash('emailCode', code)
	}, now);
}

describe('emailCodeRepo', () =>
{
	it('stores a code by purpose and address', async () =>
	{
		await sendRegisterCode('AB12CD');

		const code = await inTransaction((executor) => lockEmailCode('register', ADDRESS, executor));

		assert.ok(code);
		assert.deepStrictEqual(Buffer.from(code.codeHash), keyedHash('emailCode', 'AB12CD'));
		assert.deepStrictEqual(code.sentAt, NOW);
		assert.strictEqual(code.wrongGuesses, 0);
		assert.strictEqual(code.usedAt, null);
		assert.strictEqual(await inTransaction((executor) => lockEmailCode('resetPassword', ADDRESS, executor)), undefined);
	});

	it('replaces the old code, clearing its guesses', async () =>
	{
		await sendRegisterCode('AB12CD');

		const first = await inTransaction((executor) => lockEmailCode('register', ADDRESS, executor));

		assert.ok(first);
		await recordWrongEmailCodeGuess(first.id);

		const later = new Date(NOW.getTime() + 60000);

		await sendRegisterCode('EF34GH', later);

		const second = await inTransaction((executor) => lockEmailCode('register', ADDRESS, executor));

		assert.ok(second);
		assert.deepStrictEqual(Buffer.from(second.codeHash), keyedHash('emailCode', 'EF34GH'));
		assert.deepStrictEqual(second.sentAt, later);
		assert.strictEqual(second.wrongGuesses, 0);
	});

	it('counts wrong guesses', async () =>
	{
		await sendRegisterCode('AB12CD');

		const code = await inTransaction((executor) => lockEmailCode('register', ADDRESS, executor));

		assert.ok(code);
		await Promise.all([recordWrongEmailCodeGuess(code.id), recordWrongEmailCodeGuess(code.id)]);
		assert.strictEqual((await inTransaction((executor) => lockEmailCode('register', ADDRESS, executor)))?.wrongGuesses, 2);
	});

	it('requires an account for a password reset, and none for registering', async () =>
	{
		const player = await loadOrCreatePlayerByName('Ada');

		await assert.rejects(replaceEmailCode({
			purpose: 'resetPassword',
			addressHash: ADDRESS,
			playerId: null,
			codeHash: keyedHash('emailCode', 'AB12CD')
		}, NOW));
		await assert.rejects(replaceEmailCode({
			purpose: 'register',
			addressHash: ADDRESS,
			playerId: player.id,
			codeHash: keyedHash('emailCode', 'AB12CD')
		}, NOW));
	});

	it('gives the next step only to the continuation token, until it expires', async () =>
	{
		await sendRegisterCode('AB12CD');

		const code = await inTransaction((executor) => lockEmailCode('register', ADDRESS, executor));
		const continuation = hashToken(createToken());
		const usedAt = new Date(NOW.getTime() + 60000);
		const expiresAt = new Date(usedAt.getTime() + (10 * 60000));

		assert.ok(code);
		await useEmailCode(code.id, continuation, usedAt, expiresAt);

		const found = await inTransaction((executor) => lockContinuation('register', continuation, usedAt, executor));

		assert.strictEqual(found?.id, code.id);
		assert.deepStrictEqual(found.usedAt, usedAt);
		assert.strictEqual(await inTransaction((executor) => lockContinuation('register', hashToken(createToken()), usedAt, executor)), undefined);
		assert.strictEqual(await inTransaction((executor) => lockContinuation('resetPassword', continuation, usedAt, executor)), undefined);
		assert.strictEqual(await inTransaction((executor) => lockContinuation('register', continuation, expiresAt, executor)), undefined);

		await deleteEmailCode(code.id);
		assert.strictEqual(await inTransaction((executor) => lockContinuation('register', continuation, usedAt, executor)), undefined);
	});

	it('deletes codes that can no longer be entered, keeping ones whose next step is open', async () =>
	{
		const player = await loadOrCreatePlayerByName('Ada');

		await sendRegisterCode('AB12CD');
		await replaceEmailCode({
			purpose: 'resetPassword',
			addressHash: ADDRESS,
			playerId: player.id,
			codeHash: keyedHash('emailCode', 'EF34GH')
		}, NOW);

		const reset = await inTransaction((executor) => lockEmailCode('resetPassword', ADDRESS, executor));
		const expired = new Date(NOW.getTime() + EMAIL_CODE_LIFETIME_MS);

		assert.ok(reset);
		await useEmailCode(reset.id, hashToken(createToken()), NOW, new Date(expired.getTime() + 60000));

		assert.strictEqual(await deleteStaleEmailCodes(new Date(expired.getTime() - 1)), 0);
		assert.strictEqual(await deleteStaleEmailCodes(expired), 1);
		assert.strictEqual(await inTransaction((executor) => lockEmailCode('register', ADDRESS, executor)), undefined);
		assert.strictEqual(await deleteStaleEmailCodes(new Date(expired.getTime() + 60000)), 1);
	});
});
