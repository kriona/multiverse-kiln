import assert from 'assert';

import { JoinChanges } from '../src/rooms/joinChanges.js';

describe('JoinChanges', () =>
{
	it('rechecks nothing when no change was noted while the window joined', async () =>
	{
		const changes = new JoinChanges<'session' | 'role', string>();
		const window = {};
		let lookups = 0;

		changes.note('session');
		changes.startLookup(window, () =>
		{
			lookups++;
			return(Promise.resolve('found'));
		});

		assert.strictEqual(await changes.recheck(window), undefined);
		assert.strictEqual(lookups, 0);
	});

	it('looks the window up again after a change, until a lookup sees none, with every kind it missed', async () =>
	{
		const changes = new JoinChanges<'session' | 'role' | 'stage', number>();
		const window = {};
		let lookups = 0;

		changes.startLookup(window, () =>
		{
			lookups++;

			// A change during the first lookup again needs a second
			if (lookups === 1)
			{
				changes.note('role');
			}

			return(Promise.resolve(lookups));
		});
		changes.note('session');

		assert.deepStrictEqual(await changes.recheck(window), {
			found: 2,
			missed: new Set(['session', 'role'])
		});
	});

	it('marks each window\'s lookup apart', async () =>
	{
		const changes = new JoinChanges<'session', string>();
		const early = {};
		const late = {};

		changes.startLookup(early, () => Promise.resolve('early'));
		changes.note('session');
		changes.startLookup(late, () => Promise.resolve('late'));

		assert.strictEqual((await changes.recheck(early))?.found, 'early');
		assert.strictEqual(await changes.recheck(late), undefined);
	});

	it('refuses a window whose lookup never started', async () =>
	{
		const changes = new JoinChanges<'session', string>();

		await assert.rejects(changes.recheck({}));
	});
});
