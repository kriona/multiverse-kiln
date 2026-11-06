import assert from 'assert';
import type { UniverseEditDetail } from '@multiverse-kiln/shared';

import { noticeDetails } from '../../src/logic/saveNotices.js';

/**
 * A save that touches both what each version holds and what the universe holds once
 */
const DETAILS: UniverseEditDetail[] = [
	{ subject: 'race', action: 'changed', target: { key: null, name: 'Dwarf' }, fields: [{ field: 'name', value: 'Dwarf' }], count: 1 },
	{ subject: 'settings', action: 'changed', target: null, fields: [{ field: 'groupSize', value: 4 }, { field: 'stage', value: 'prologue' }], count: 1 },
	{ subject: 'cells', action: 'changed', target: { key: null, name: 'Cave' }, fields: [], count: 40 },
	{ subject: 'editor', action: 'added', target: { key: null, name: 'bea' }, fields: [{ field: 'role', value: 'builder' }], count: 1 },
	{ subject: 'draft', action: 'added', target: null, fields: [], count: 1 }
];

describe('saveNotices', () =>
{
	describe('noticeDetails', () =>
	{
		it('tells a window with the version saved open everything', () =>
		{
			assert.deepStrictEqual(noticeDetails(DETAILS, 'live', 'live'), DETAILS);
			assert.deepStrictEqual(noticeDetails(DETAILS, 'draft', 'draft'), DETAILS);
		});

		it('tells a window with the other version open only of the editors, the stage and the draft', () =>
		{
			assert.deepStrictEqual(noticeDetails(DETAILS, 'draft', 'live'), [
				{ subject: 'settings', action: 'changed', target: null, fields: [{ field: 'stage', value: 'prologue' }], count: 1 },
				DETAILS[3],
				DETAILS[4]
			]);
		});

		it('tells a window with the other version open nothing of a save that changed only that version', () =>
		{
			assert.deepStrictEqual(noticeDetails(DETAILS.slice(0, 1), 'live', 'draft'), []);
			assert.deepStrictEqual(noticeDetails([{ subject: 'settings', action: 'changed', target: null, fields: [{ field: 'groupSize', value: 4 }], count: 1 }], 'live', 'draft'), []);
		});

		it('leaves the save\'s details as they were', () =>
		{
			noticeDetails(DETAILS, 'draft', 'live');
			assert.strictEqual(DETAILS[1].fields.length, 2);
		});
	});
});
