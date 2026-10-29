import assert from 'assert';

import { keyedHash } from '../../src/auth/keyedHashes.js';
import { deleteAuthEventsBefore, findPlayerAuthEvents, recordAuthEvent } from '../../src/db/authEventRepo.js';
import { loadOrCreatePlayerByName } from '../../src/db/playerRepo.js';

const NOW = new Date('2026-10-29T12:00:00Z');
const DAY_MS = (24 * 60 * 60 * 1000);

describe('authEventRepo', () =>
{
	it('records an account\'s events, oldest first', async () =>
	{
		const player = await loadOrCreatePlayerByName('Ada');
		const networkHash = keyedHash('network', '192.0.2.1');
		const later = new Date(NOW.getTime() + 1000);

		await recordAuthEvent({
			playerId: player.id,
			kind: 'loggedOut',
			networkHash: null,
			occurredAt: later
		});
		await recordAuthEvent({
			playerId: player.id,
			kind: 'loggedIn',
			networkHash,
			occurredAt: NOW
		});
		await recordAuthEvent({
			playerId: null,
			kind: 'loginFailed',
			networkHash,
			occurredAt: NOW
		});

		const events = await findPlayerAuthEvents(player.id);

		assert.deepStrictEqual(events.map((event) => event.kind), ['loggedIn', 'loggedOut']);
		assert.deepStrictEqual(Buffer.from(events[0].networkHash ?? []), networkHash);
		assert.strictEqual(events[1].networkHash, null);
	});

	it('deletes events older than a time', async () =>
	{
		const player = await loadOrCreatePlayerByName('Ada');

		await recordAuthEvent({
			playerId: player.id,
			kind: 'loggedIn',
			networkHash: null,
			occurredAt: new Date(NOW.getTime() - (91 * DAY_MS))
		});
		await recordAuthEvent({
			playerId: player.id,
			kind: 'loggedIn',
			networkHash: null,
			occurredAt: NOW
		});

		assert.strictEqual(await deleteAuthEventsBefore(new Date(NOW.getTime() - (90 * DAY_MS))), 1);
		assert.strictEqual((await findPlayerAuthEvents(player.id)).length, 1);
	});

	it('refuses a network hash of the wrong length', async () =>
	{
		await assert.rejects(recordAuthEvent({
			playerId: null,
			kind: 'loginFailed',
			networkHash: new Uint8Array(16),
			occurredAt: NOW
		}));
	});
});
