import { UNIVERSE_EDIT_DAYS } from '@multiverse-kiln/shared';
import assert from 'assert';

import { listUniverseEdits, recordUniverseEdit } from '../src/db/universeEditRepo.js';
import { sweepUniverseEdits } from '../src/universeEditSweep.js';
import { addUniverse } from './db/fixtures.js';
import { addPlayer } from './players.js';

const DAY_MS = (24 * 60 * 60 * 1000);

describe('sweepUniverseEdits', () =>
{
	it('deletes every save older than the days saves are kept, a batch at a time, and keeps the rest', async () =>
	{
		const universeId = await addUniverse();
		const ada = await addPlayer('Ada');
		const now = new Date(Date.UTC(2026, 10, 3, 12, 0));
		const daysAgo = [(UNIVERSE_EDIT_DAYS + 30), (UNIVERSE_EDIT_DAYS + 2), (UNIVERSE_EDIT_DAYS + 1), (UNIVERSE_EDIT_DAYS + 1), (UNIVERSE_EDIT_DAYS + 1), (UNIVERSE_EDIT_DAYS - 1), 0];

		for (const days of daysAgo)
		{
			await recordUniverseEdit({
				universeId,
				playerId: ada.id,
				role: 'creator',
				changeDetails: [{ subject: 'difficultyLevel', action: 'changed', target: { key: 'hard', name: null }, fields: [{ field: 'mobScale', value: days }], count: 1 }],
				savedAt: new Date(now.getTime() - (days * DAY_MS))
			});
		}

		assert.strictEqual(await sweepUniverseEdits(now, 2), 5);

		const kept = await listUniverseEdits(universeId, { offset: 0, limit: 10 });

		assert.deepStrictEqual(kept.edits.map(({ changeDetails }) => changeDetails?.[0].fields[0].value), [0, (UNIVERSE_EDIT_DAYS - 1)]);
		assert.strictEqual(await sweepUniverseEdits(now, 2), 0);
	});
});
