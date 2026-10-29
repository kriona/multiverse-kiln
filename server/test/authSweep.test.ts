import assert from 'assert';

import { keyedHash } from '../src/auth/keyedHashes.js';
import { sweepAuth } from '../src/authSweep.js';
import { recordAuthEvent } from '../src/db/authEventRepo.js';
import { pool } from '../src/db/client.js';
import { recordRateLimitEvent } from '../src/db/rateLimitRepo.js';
import { connectedSessions } from '../src/players/connectedSessions.js';
import { addPlayer, logInBrowser } from './players.js';

const HOUR_MS = (60 * 60 * 1000);
const DAY_MS = (24 * HOUR_MS);

/**
 * How many rows a table has
 *
 * @param table The table
 * @return The count
 */
async function countRows(table: string): Promise<number>
{
	return(Number((await pool.query<{ count: string }>(`SELECT count(*) FROM ${table}`)).rows[0].count));
}

describe('sweepAuth', () =>
{
	it('records the use of connected sessions, so they don\'t end for want of it', async () =>
	{
		const playerId = (await addPlayer('Ada')).id;
		const connected = await logInBrowser(playerId);
		const idle = await logInBrowser(playerId);
		const now = new Date(Date.now() + (2 * HOUR_MS));

		connectedSessions.connect(connected.sessionId);

		try
		{
			await sweepAuth(now);
		}
		finally
		{
			connectedSessions.disconnect(connected.sessionId);
		}

		const remaining = (await pool.query<{ id: string }>('SELECT id FROM sessions')).rows.map((row) => row.id);

		assert.deepStrictEqual(remaining, [connected.sessionId]);
		assert.ok(!remaining.includes(idle.sessionId));
	});

	it('turns away the windows of sessions it deletes', async () =>
	{
		const browser = await logInBrowser((await addPlayer('Ada')).id);
		const heard: string[] = [];
		const stop = connectedSessions.onEnd((ended) =>
		{
			heard.push(...ended);
		});

		try
		{
			await sweepAuth(new Date(Date.now() + DAY_MS));
		}
		finally
		{
			stop();
		}

		assert.deepStrictEqual(heard, [browser.sessionId]);
	});

	it('deletes rate limit records once no limit counts them, and auth events after 90 days', async () =>
	{
		const now = new Date();
		const subject = keyedHash('network', '192.0.2.1');

		await recordRateLimitEvent('networkGuess', subject, new Date(now.getTime() - (2 * HOUR_MS)));
		await recordRateLimitEvent('networkGuess', subject, now);
		await recordRateLimitEvent('addressWrongGuess', subject, new Date(now.getTime() - (2 * HOUR_MS)));
		await recordRateLimitEvent('addressWrongGuess', subject, new Date(now.getTime() - (2 * DAY_MS)));
		await recordAuthEvent({
			playerId: null,
			kind: 'loginFailed',
			networkHash: null,
			occurredAt: new Date(now.getTime() - (91 * DAY_MS))
		});
		await recordAuthEvent({
			playerId: null,
			kind: 'loginFailed',
			networkHash: null,
			occurredAt: now
		});

		await sweepAuth(now);

		assert.strictEqual(await countRows('rate_limit_events'), 2);
		assert.strictEqual(await countRows('auth_events'), 1);
	});
});
