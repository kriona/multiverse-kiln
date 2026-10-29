import assert from 'assert';
import { randomBytes } from 'crypto';

import { inTransaction } from '../../src/db/transactions.js';
import { countRecoveryCodes, deleteExpiredPendingTwoFactorLogins, deleteExpiredTrustedBrowsers, deleteTwoFactor, enableAuthenticator, findTwoFactorState, hasTwoFactor, isBrowserTrusted, lockAuthenticator, lockPendingTwoFactorLogin, recordWrongTwoFactorGuess, replaceRecoveryCodes, saveAuthenticatorSetup, savePendingTwoFactorLogin, trustBrowser, useRecoveryCode } from '../../src/db/twoFactorRepo.js';
import { addPlayer } from '../players.js';

const NOW = new Date('2026-10-29T12:00:00Z');

/**
 * A time some minutes after NOW
 *
 * @param minutes The minutes, negative for before
 * @return The time
 */
function minutesLater(minutes: number): Date
{
	return(new Date(NOW.getTime() + (minutes * 60 * 1000)));
}

describe('twoFactorRepo', () =>
{
	it('replaces a setup until 2FA is on, then keeps the authenticator', async () =>
	{
		const { id } = await addPlayer('Ada');
		const [first, second, third] = [randomBytes(48), randomBytes(48), randomBytes(48)];

		assert.strictEqual(await saveAuthenticatorSetup(id, first, NOW), true);
		assert.strictEqual(await saveAuthenticatorSetup(id, second, minutesLater(1)), true);
		assert.strictEqual(await hasTwoFactor(id), false);

		await enableAuthenticator(id, 100, minutesLater(2));
		assert.strictEqual(await hasTwoFactor(id), true);
		assert.strictEqual(await saveAuthenticatorSetup(id, third, minutesLater(3)), false);

		const authenticator = await inTransaction((executor) => lockAuthenticator(id, executor));

		assert.deepStrictEqual(authenticator, {
			encryptedSecret: new Uint8Array(second),
			lastUsedStep: 100,
			createdAt: minutesLater(1),
			enabledAt: minutesLater(2)
		});
	});

	it('uses each recovery code once, and only for its account', async () =>
	{
		const ada = await addPlayer('Ada');
		const grace = await addPlayer('Grace');
		const [first, second] = [randomBytes(32), randomBytes(32)];

		await replaceRecoveryCodes(ada.id, [first, second]);
		assert.strictEqual(await useRecoveryCode(grace.id, first), false);
		assert.strictEqual(await useRecoveryCode(ada.id, first), true);
		assert.strictEqual(await useRecoveryCode(ada.id, first), false);
		assert.strictEqual(await countRecoveryCodes(ada.id), 1);

		await replaceRecoveryCodes(ada.id, [randomBytes(32)]);
		assert.strictEqual(await useRecoveryCode(ada.id, second), false);
	});

	it('gives a waiting login to its token until its time is up', async () =>
	{
		const { id } = await addPlayer('Ada');
		const continuationHash = randomBytes(32);

		await savePendingTwoFactorLogin({
			continuationHash,
			playerId: id,
			rememberMe: true,
			expiresAt: minutesLater(10)
		});

		const pending = await inTransaction((executor) => lockPendingTwoFactorLogin(continuationHash, NOW, executor));

		assert.ok(pending);
		await recordWrongTwoFactorGuess(pending.id);
		assert.deepStrictEqual(await inTransaction((executor) => lockPendingTwoFactorLogin(continuationHash, NOW, executor)), {
			id: pending.id,
			playerId: id,
			rememberMe: true,
			wrongGuesses: 1
		});
		assert.strictEqual(await inTransaction((executor) => lockPendingTwoFactorLogin(randomBytes(32), NOW, executor)), undefined);
		assert.strictEqual(await inTransaction((executor) => lockPendingTwoFactorLogin(continuationHash, minutesLater(10), executor)), undefined);
		assert.strictEqual(await deleteExpiredPendingTwoFactorLogins(minutesLater(10)), 1);
	});

	it('trusts a browser for one account until its time is up', async () =>
	{
		const ada = await addPlayer('Ada');
		const grace = await addPlayer('Grace');
		const token = randomBytes(32);

		await trustBrowser(token, ada.id, minutesLater(10));
		await trustBrowser(token, grace.id, minutesLater(5));
		assert.strictEqual(await isBrowserTrusted(token, ada.id, NOW), true);
		assert.strictEqual(await isBrowserTrusted(randomBytes(32), ada.id, NOW), false);
		assert.strictEqual(await isBrowserTrusted(token, grace.id, minutesLater(5)), false);

		// Trusting it again extends the trust
		await trustBrowser(token, grace.id, minutesLater(20));
		assert.strictEqual(await isBrowserTrusted(token, grace.id, minutesLater(15)), true);
		assert.strictEqual(await deleteExpiredTrustedBrowsers(minutesLater(15)), 1);
		assert.strictEqual(await isBrowserTrusted(token, grace.id, NOW), true);
	});

	it('turns 2FA off, with everything that goes with it', async () =>
	{
		const { id } = await addPlayer('Ada');

		await saveAuthenticatorSetup(id, randomBytes(48), NOW);
		await enableAuthenticator(id, 1, NOW);
		await replaceRecoveryCodes(id, [randomBytes(32), randomBytes(32)]);
		await trustBrowser(randomBytes(32), id, minutesLater(10));
		assert.deepStrictEqual(await findTwoFactorState(id, NOW), { recoveryCodesLeft: 2, trustedBrowsers: 1 });

		await deleteTwoFactor(id);
		assert.strictEqual(await findTwoFactorState(id, NOW), null);
		assert.strictEqual(await countRecoveryCodes(id), 0);
	});
});
