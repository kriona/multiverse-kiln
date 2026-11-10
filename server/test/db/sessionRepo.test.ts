import assert from 'assert';
import { randomUUID } from 'node:crypto';

import { createToken, hashToken } from '../../src/auth/tokens.js';
import { adminDb } from '../../src/db/adminClient.js';
import { addServerAdmin } from '../../src/db/serverAdminRepo.js';
import { createSession, deleteExpiredSessions, deletePlayerSessions, deleteSession, findSessionByTokenHash, findSessionWithPlayer, listActiveSessions, listSessionsOfPlayers, touchSession, touchSessions } from '../../src/db/sessionRepo.js';
import { addPlayer } from '../players.js';
import { turnOnTwoFactor } from '../twoFactorAccounts.js';

const HOUR_MS = (60 * 60 * 1000);
const DAY_MS = (24 * HOUR_MS);

describe('sessionRepo', () =>
{
	it('finds a session by its token\'s hash', async () =>
	{
		const player = await addPlayer('Ada');
		const token = createToken();
		const created = await createSession(player.id, hashToken(token), true);
		const found = await findSessionByTokenHash(hashToken(token));

		assert.deepStrictEqual(found, created);
		assert.strictEqual(found?.playerId, player.id);
		assert.strictEqual(found?.rememberMe, true);
	});

	it('finds a session with its player\'s names and language', async () =>
	{
		const player = await addPlayer('Ada Lovelace');
		const tokenHash = hashToken(createToken());
		const session = await createSession(player.id, tokenHash, false);

		assert.deepStrictEqual(await findSessionWithPlayer(tokenHash), {
			...session,
			username: 'Ada_Lovelace',
			displayName: 'Ada Lovelace',
			locale: null,
			needsTwoFactor: false
		});
		assert.strictEqual(await findSessionWithPlayer(hashToken(createToken())), undefined);
	});

	it('says whether a session\'s player is a server admin without 2FA', async () =>
	{
		const player = await addPlayer('Ada');
		const tokenHash = hashToken(createToken());

		await createSession(player.id, tokenHash, false);
		await addServerAdmin(player.id, adminDb);
		assert.strictEqual((await findSessionWithPlayer(tokenHash))?.needsTwoFactor, true);
		await turnOnTwoFactor(player.id);
		assert.strictEqual((await findSessionWithPlayer(tokenHash))?.needsTwoFactor, false);
	});

	it('records the use of several sessions at once', async () =>
	{
		const player = await addPlayer('Ada');
		const first = hashToken(createToken());
		const second = hashToken(createToken());
		const sessions = [await createSession(player.id, first, false), await createSession(player.id, second, false)];
		const later = new Date(sessions[0].lastUsedAt.getTime() + 60000);

		await touchSessions(sessions.map((session) => session.id), later);
		await touchSessions([], later);

		assert.deepStrictEqual((await findSessionByTokenHash(first))?.lastUsedAt, later);
		assert.deepStrictEqual((await findSessionByTokenHash(second))?.lastUsedAt, later);
	});

	it('takes more session IDs than Postgres takes query parameters', async () =>
	{
		const player = await addPlayer('Ada');
		const tokenHash = hashToken(createToken());
		const session = await createSession(player.id, tokenHash, false);
		const other = await createSession(player.id, hashToken(createToken()), false);
		const ids = [...Array.from({ length: 70000 }, () => randomUUID()), session.id];
		const later = new Date(session.lastUsedAt.getTime() + 60000);
		const page = { offset: 0, limit: 20 };

		await touchSessions(ids, later);

		assert.deepStrictEqual((await findSessionByTokenHash(tokenHash))?.lastUsedAt, later);
		assert.deepStrictEqual((await listActiveSessions({ connected: { ids, connected: true } }, page, later)).sessions.map((found) => found.id), [session.id]);
		assert.deepStrictEqual((await listActiveSessions({ connected: { ids, connected: false } }, page, later)).sessions.map((found) => found.id), [other.id]);
		assert.deepStrictEqual((await listActiveSessions({ connected: { ids: [], connected: false } }, page, later)).total, 2);
	});

	it('lists the sessions of some players', async () =>
	{
		const ada = await addPlayer('Ada');
		const grace = await addPlayer('Grace');
		const alan = await addPlayer('Alan');
		const adaSessions = [await createSession(ada.id, hashToken(createToken()), false), await createSession(ada.id, hashToken(createToken()), true)];
		const graceSession = await createSession(grace.id, hashToken(createToken()), false);

		await createSession(alan.id, hashToken(createToken()), false);

		const found = (await listSessionsOfPlayers([ada.id, grace.id]))
			.map((session) => [session.id, session.playerId])
			.sort(([a], [b]) => a.localeCompare(b));
		const expected = [...adaSessions, graceSession]
			.map((session) => [session.id, session.playerId])
			.sort(([a], [b]) => a.localeCompare(b));

		assert.deepStrictEqual(found, expected);
		assert.deepStrictEqual(await listSessionsOfPlayers([]), []);
	});

	it('finds nothing for an unknown token', async () =>
	{
		assert.strictEqual(await findSessionByTokenHash(hashToken(createToken())), undefined);
	});

	it('records a use', async () =>
	{
		const player = await addPlayer('Ada');
		const tokenHash = hashToken(createToken());
		const session = await createSession(player.id, tokenHash, false);
		const later = new Date(session.lastUsedAt.getTime() + 60000);

		await touchSession(session.id, later);

		assert.deepStrictEqual((await findSessionByTokenHash(tokenHash))?.lastUsedAt, later);
	});

	it('ends one session, leaving the account\'s others', async () =>
	{
		const player = await addPlayer('Ada');
		const first = hashToken(createToken());
		const second = hashToken(createToken());
		const session = await createSession(player.id, first, false);

		await createSession(player.id, second, false);
		await deleteSession(session.id);

		assert.strictEqual(await findSessionByTokenHash(first), undefined);
		assert.ok(await findSessionByTokenHash(second));
	});

	it('ends every session of an account, leaving other accounts\'', async () =>
	{
		const ada = await addPlayer('Ada');
		const grace = await addPlayer('Grace');
		const graceToken = hashToken(createToken());
		const adaSessions = [await createSession(ada.id, hashToken(createToken()), false), await createSession(ada.id, hashToken(createToken()), true)];

		await createSession(grace.id, graceToken, false);

		const ended = await deletePlayerSessions(ada.id);

		assert.deepStrictEqual(ended.sort(), adaSessions.map((session) => session.id).sort());
		assert.ok(await findSessionByTokenHash(graceToken));
	});

	it('deletes expired sessions by their idle and total limits', async () =>
	{
		const player = await addPlayer('Ada');
		const shortIdle = hashToken(createToken());
		const shortFresh = hashToken(createToken());
		const rememberedIdle = hashToken(createToken());
		const rememberedFresh = hashToken(createToken());

		for (const tokenHash of [shortIdle, shortFresh])
		{
			await createSession(player.id, tokenHash, false);
		}

		for (const tokenHash of [rememberedIdle, rememberedFresh])
		{
			await createSession(player.id, tokenHash, true);
		}

		const shortSession = await findSessionByTokenHash(shortFresh);
		const rememberedSession = await findSessionByTokenHash(rememberedFresh);

		assert.ok(shortSession && rememberedSession);

		// Two hours on, a short session used an hour ago lives; one unused since it began has ended
		const twoHoursOn = new Date(shortSession.createdAt.getTime() + (2 * HOUR_MS));

		await touchSession(shortSession.id, new Date(twoHoursOn.getTime() - HOUR_MS + 1000));
		assert.strictEqual((await deleteExpiredSessions(twoHoursOn)).length, 1);
		assert.strictEqual(await findSessionByTokenHash(shortIdle), undefined);
		assert.ok(await findSessionByTokenHash(shortFresh));

		// Thirty-one days on, the short session is past its 24 hours, and a remembered session used a day
		// ago lives while one unused for 31 days has ended
		const monthOn = new Date(rememberedSession.createdAt.getTime() + (31 * DAY_MS));

		await touchSession(rememberedSession.id, new Date(monthOn.getTime() - DAY_MS));
		assert.strictEqual((await deleteExpiredSessions(monthOn)).length, 2);
		assert.strictEqual(await findSessionByTokenHash(shortFresh), undefined);
		assert.strictEqual(await findSessionByTokenHash(rememberedIdle), undefined);
		assert.ok(await findSessionByTokenHash(rememberedFresh));

		// Ninety days on, even a remembered session used just now has ended. The database keeps
		// microseconds, which createdAt rounds down to milliseconds, so this is a millisecond past
		const ninetyDaysOn = new Date(rememberedSession.createdAt.getTime() + (90 * DAY_MS) + 1);

		await touchSession(rememberedSession.id, ninetyDaysOn);
		assert.deepStrictEqual(await deleteExpiredSessions(ninetyDaysOn), [rememberedSession.id]);
	});
});
