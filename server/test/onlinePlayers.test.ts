import assert from 'assert';

import { OnlinePlayers, type OnlinePlayerChange } from '../src/players/onlinePlayers.js';

/**
 * Creates an OnlinePlayers whose player IDs are player-1, player-2, ..., recording every change
 *
 * @return The OnlinePlayers and the changes it has reported
 */
function createPlayers(): { players: OnlinePlayers; changes: OnlinePlayerChange[] }
{
	let next = 0;
	const players = new OnlinePlayers(() => `player-${++next}`);
	const changes: OnlinePlayerChange[] = [];

	players.onChange((change) =>
	{
		changes.push(change);
	});

	return({ players, changes });
}

describe('OnlinePlayers', () =>
{
	it('logs a browser in with a new player in the lobby', () =>
	{
		const { players, changes } = createPlayers();
		const player = players.logIn('browser-a', 'Ada');

		assert.deepStrictEqual(player, { playerId: 'player-1', name: 'Ada', groupId: undefined });
		assert.strictEqual(players.get('browser-a'), player);
		assert.deepStrictEqual(changes, [{ browserId: 'browser-a', before: undefined, after: player }]);
	});

	it('keeps the existing player when a logged-in browser logs in again', () =>
	{
		const { players, changes } = createPlayers();
		const first = players.logIn('browser-a', 'Ada');

		assert.strictEqual(players.logIn('browser-a', 'Grace'), first);
		assert.strictEqual(changes.length, 1);
	});

	it('logs a browser out', () =>
	{
		const { players, changes } = createPlayers();
		const player = players.logIn('browser-a', 'Ada');

		players.logOut('browser-a');
		players.logOut('browser-a');

		assert.strictEqual(players.get('browser-a'), undefined);
		assert.deepStrictEqual(changes[1], { browserId: 'browser-a', before: player, after: undefined });
		assert.strictEqual(changes.length, 2);
	});

	it('moves a player between groups', () =>
	{
		const { players } = createPlayers();

		players.logIn('browser-a', 'Ada');

		assert.strictEqual(players.setGroup('browser-a', 'group-1'), true);
		assert.strictEqual(players.get('browser-a')?.groupId, 'group-1');

		players.setGroup('browser-a', 'group-2');

		assert.strictEqual(players.countInGroup('group-1'), 0);
		assert.strictEqual(players.countInGroup('group-2'), 1);

		players.setGroup('browser-a', undefined);

		assert.strictEqual(players.get('browser-a')?.groupId, undefined);
	});

	it('does not put a logged-out browser in a group', () =>
	{
		const { players, changes } = createPlayers();

		assert.strictEqual(players.setGroup('browser-a', 'group-1'), false);
		assert.strictEqual(changes.length, 0);
	});

	it('reports a group change with the player before and after', () =>
	{
		const { players, changes } = createPlayers();
		const before = players.logIn('browser-a', 'Ada');

		players.setGroup('browser-a', 'group-1');

		assert.deepStrictEqual(changes[1], { browserId: 'browser-a', before, after: { ...before, groupId: 'group-1' } });
	});

	it('reports nothing when a player is moved to the group they are in', () =>
	{
		const { players, changes } = createPlayers();

		players.logIn('browser-a', 'Ada');
		players.setGroup('browser-a', 'group-1');
		players.setGroup('browser-a', 'group-1');

		assert.strictEqual(changes.length, 2);
	});

	it('moves everyone in a disbanded group back to the lobby', () =>
	{
		const { players } = createPlayers();

		players.logIn('browser-a', 'Ada');
		players.logIn('browser-b', 'Grace');
		players.logIn('browser-c', 'Alan');
		players.setGroup('browser-a', 'group-1');
		players.setGroup('browser-b', 'group-1');
		players.setGroup('browser-c', 'group-2');

		players.disbandGroup('group-1');

		assert.strictEqual(players.get('browser-a')?.groupId, undefined);
		assert.strictEqual(players.get('browser-b')?.groupId, undefined);
		assert.strictEqual(players.get('browser-c')?.groupId, 'group-2');
	});

	it('stops telling a listener about changes once it stops listening', () =>
	{
		const players = new OnlinePlayers(() => 'player-1');
		let calls = 0;
		const stopListening = players.onChange(() =>
		{
			calls++;
		});

		players.logIn('browser-a', 'Ada');
		stopListening();
		players.logOut('browser-a');

		assert.strictEqual(calls, 1);
	});
});
