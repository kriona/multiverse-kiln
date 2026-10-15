import assert from 'assert';

import { PlayerSessions } from '../src/rooms/playerSessions.js';

describe('PlayerSessions', () =>
{
	it('reports a player as new only for its first client', () =>
	{
		const sessions = new PlayerSessions();

		assert.strictEqual(sessions.add('s1', 'player-1'), true);
		assert.strictEqual(sessions.add('s2', 'player-1'), false);
		assert.strictEqual(sessions.getPlayerId('s2'), 'player-1');
	});

	it('lists the clients controlling a player', () =>
	{
		const sessions = new PlayerSessions();

		sessions.add('s1', 'player-1');
		sessions.add('s2', 'player-1');
		sessions.add('s3', 'player-2');

		assert.deepStrictEqual(sessions.getSessionIds('player-1'), ['s1', 's2']);
		assert.deepStrictEqual(sessions.getSessionIds('unknown'), []);
	});

	it('keeps the player until its last client leaves', () =>
	{
		const sessions = new PlayerSessions();

		sessions.add('s1', 'player-1');
		sessions.add('s2', 'player-1');

		assert.deepStrictEqual(sessions.remove('s1'), { playerId: 'player-1', wasLastClient: false });
		assert.deepStrictEqual(sessions.remove('s2'), { playerId: 'player-1', wasLastClient: true });
		assert.strictEqual(sessions.getPlayerId('s1'), undefined);
	});

	it('treats a player as new again after its last client left', () =>
	{
		const sessions = new PlayerSessions();

		sessions.add('s1', 'player-1');
		sessions.remove('s1');

		assert.strictEqual(sessions.add('s2', 'player-1'), true);
	});

	it('ignores an unknown session', () =>
	{
		const sessions = new PlayerSessions();

		assert.strictEqual(sessions.remove('unknown'), undefined);
		assert.strictEqual(sessions.getPlayerId('unknown'), undefined);
	});
});
