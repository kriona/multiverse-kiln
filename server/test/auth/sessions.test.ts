import assert from 'assert';
import type { Request, Response } from 'express';

import { giveSession, resolveSession, startSession } from '../../src/auth/sessions.js';
import { hashToken } from '../../src/auth/tokens.js';
import { findSessionByTokenHash } from '../../src/db/sessionRepo.js';
import { inTransaction } from '../../src/db/transactions.js';
import { SESSION_COOKIE } from '../../src/http/cookies.js';
import { connectedSessions } from '../../src/players/connectedSessions.js';
import { addPlayer, logInBrowser } from '../players.js';

describe('starting a session', () =>
{
	/**
	 * A login's request from a browser
	 *
	 * @param cookie The Cookie header the browser sends
	 * @return The request
	 */
	function requestWith(cookie: string): Request
	{
		return({ headers: { cookie } } as unknown as Request);
	}

	/**
	 * A response that keeps the cookies set on it
	 *
	 * @param cookies Where to keep them, by name
	 * @return The response
	 */
	function responseKeeping(cookies: Map<string, string>): Response
	{
		const response = {
			cookie: (name: string, value: string) =>
			{
				cookies.set(name, value);
				return(response);
			}
		} as unknown as Response;

		return(response);
	}

	/**
	 * Runs work while noting the sessions whose windows are told they ended
	 *
	 * @param work The work
	 * @return The sessions told they ended
	 */
	async function noteEndedSessions(work: () => Promise<void>): Promise<string[]>
	{
		const ended: string[] = [];
		const stopListening = connectedSessions.onEnd((sessionIds) =>
		{
			ended.push(...sessionIds);
		});

		try
		{
			await work();
		}
		finally
		{
			stopListening();
		}

		return(ended);
	}

	it('leaves the browser\'s session and its windows as they were when the login\'s transaction rolls back', async () =>
	{
		const player = await addPlayer('Ada');
		const old = await logInBrowser(player.id);
		const ended = await noteEndedSessions(async () =>
		{
			await assert.rejects(inTransaction(async (executor) =>
			{
				await startSession(requestWith(old.cookie), player.id, false, executor);

				// As a failure of what follows startSession() in a login's transaction would
				throw new Error('rolled back');
			}), /rolled back/);
		});

		assert.deepStrictEqual(ended, []);
		assert.strictEqual((await resolveSession(old.cookie))?.sessionId, old.sessionId);
	});

	it('gives the browser the new session once it is saved, turning away the windows of the one it replaces', async () =>
	{
		const player = await addPlayer('Ada');
		const old = await logInBrowser(player.id);
		const cookies = new Map<string, string>();
		const ended = await noteEndedSessions(async () =>
		{
			const session = await inTransaction((executor) => startSession(requestWith(old.cookie), player.id, false, executor));

			giveSession(responseKeeping(cookies), session);
		});

		assert.deepStrictEqual(ended, [old.sessionId]);
		assert.strictEqual(await resolveSession(old.cookie), undefined);
		assert.strictEqual((await findSessionByTokenHash(hashToken(cookies.get(SESSION_COOKIE) ?? '')))?.playerId, player.id);
	});
});
