import assert from 'assert';

import { createToken, hashToken } from '../../src/auth/tokens.js';
import { addProviderLogin, deleteExpiredPendingProviderLogins, deletePendingProviderLogin, findProviderLoginPlayer, lockPendingProviderLogin, ProviderLoginTakenError, savePendingProviderLogin } from '../../src/db/providerLoginRepo.js';
import { inTransaction } from '../../src/db/transactions.js';
import { addPlayer } from '../players.js';

const NOW = new Date('2026-10-29T12:00:00Z');

/**
 * Keeps a pending Google login for a new account
 *
 * @param token The token in the browser's cookie
 * @param expiresAt When its time is up
 */
async function savePending(token: string, expiresAt: Date): Promise<void>
{
	await savePendingProviderLogin({
		continuationHash: hashToken(token),
		provider: 'google',
		providerUserId: 'google-ada',
		email: 'ada@example.com',
		displayName: 'Ada',
		playerId: null,
		rememberMe: true,
		expiresAt
	});
}

describe('providerLoginRepo', () =>
{
	it('finds the account a provider login belongs to', async () =>
	{
		const ada = await addPlayer('Ada');

		await addProviderLogin('google', 'google-ada', ada.id);

		assert.strictEqual(await findProviderLoginPlayer('google', 'google-ada'), ada.id);
		assert.strictEqual(await findProviderLoginPlayer('discord', 'google-ada'), undefined);
		assert.strictEqual(await findProviderLoginPlayer('google', 'google-grace'), undefined);
	});

	it('refuses a provider login another account has, and a second login with one provider', async () =>
	{
		const ada = await addPlayer('Ada');
		const grace = await addPlayer('Grace');

		await addProviderLogin('google', 'google-ada', ada.id);

		await assert.rejects(addProviderLogin('google', 'google-ada', grace.id), (error) => ((error instanceof ProviderLoginTakenError) && (error.by === 'otherAccount')));
		await assert.rejects(addProviderLogin('google', 'google-ada-2', ada.id), (error) => ((error instanceof ProviderLoginTakenError) && (error.by === 'otherLogin')));

		await addProviderLogin('discord', 'discord-ada', ada.id);
		assert.strictEqual(await findProviderLoginPlayer('discord', 'discord-ada'), ada.id);
	});

	it('gives a pending login to the token it was saved with, until its time is up', async () =>
	{
		const token = createToken();

		await savePending(token, new Date(NOW.getTime() + 60000));

		const pending = await inTransaction((executor) => lockPendingProviderLogin(hashToken(token), NOW, executor));

		assert.ok(pending);
		assert.deepStrictEqual({ ...pending, id: '' }, {
			id: '',
			provider: 'google',
			providerUserId: 'google-ada',
			email: 'ada@example.com',
			displayName: 'Ada',
			playerId: null,
			rememberMe: true
		});
		assert.strictEqual(await inTransaction((executor) => lockPendingProviderLogin(hashToken(createToken()), NOW, executor)), undefined);
		assert.strictEqual(await inTransaction((executor) => lockPendingProviderLogin(hashToken(token), new Date(NOW.getTime() + 60000), executor)), undefined);

		await deletePendingProviderLogin(pending.id);
		assert.strictEqual(await inTransaction((executor) => lockPendingProviderLogin(hashToken(token), NOW, executor)), undefined);
	});

	it('deletes the pending logins whose time is up', async () =>
	{
		const waiting = createToken();

		await savePending(createToken(), NOW);
		await savePending(waiting, new Date(NOW.getTime() + 1));

		assert.strictEqual(await deleteExpiredPendingProviderLogins(NOW), 1);
		assert.ok(await inTransaction((executor) => lockPendingProviderLogin(hashToken(waiting), NOW, executor)));
	});
});
