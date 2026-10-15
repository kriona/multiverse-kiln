import assert from 'assert';

import { PlayerSessions } from '../src/rooms/playerSessions.js';

/**
 * Creates a PlayerSessions whose player IDs are player-1, player-2, ...
 *
 * @return The PlayerSessions
 */
function createSessions(): PlayerSessions
{
	let next = 0;

	return(new PlayerSessions(() => `player-${++next}`));
}

describe('PlayerSessions', () =>
{
	it('gives clients with the same browser ID the same player', () =>
	{
		const sessions = createSessions();

		assert.deepStrictEqual(sessions.add('s1', 'browser-a'), { playerId: 'player-1', isNewPlayer: true });
		assert.deepStrictEqual(sessions.add('s2', 'browser-a'), { playerId: 'player-1', isNewPlayer: false });
		assert.strictEqual(sessions.getPlayerId('s2'), 'player-1');
	});

	it('gives clients with different browser IDs different players', () =>
	{
		const sessions = createSessions();

		assert.strictEqual(sessions.add('s1', 'browser-a').playerId, 'player-1');
		assert.strictEqual(sessions.add('s2', 'browser-b').playerId, 'player-2');
	});

	it('gives each client without a browser ID its own player', () =>
	{
		const sessions = createSessions();

		assert.deepStrictEqual(sessions.add('s1', undefined), { playerId: 'player-1', isNewPlayer: true });
		assert.deepStrictEqual(sessions.add('s2', undefined), { playerId: 'player-2', isNewPlayer: true });
	});

	it('keeps the player until its last client leaves', () =>
	{
		const sessions = createSessions();

		sessions.add('s1', 'browser-a');
		sessions.add('s2', 'browser-a');

		assert.deepStrictEqual(sessions.remove('s1'), { playerId: 'player-1', wasLastClient: false });
		assert.deepStrictEqual(sessions.remove('s2'), { playerId: 'player-1', wasLastClient: true });
		assert.strictEqual(sessions.getPlayerId('s1'), undefined);
	});

	it('gives a browser a new player after its old one was removed', () =>
	{
		const sessions = createSessions();

		sessions.add('s1', 'browser-a');
		sessions.remove('s1');

		assert.deepStrictEqual(sessions.add('s2', 'browser-a'), { playerId: 'player-2', isNewPlayer: true });
	});

	it('ignores an unknown session', () =>
	{
		const sessions = createSessions();

		assert.strictEqual(sessions.remove('unknown'), undefined);
		assert.strictEqual(sessions.getPlayerId('unknown'), undefined);
	});
});
