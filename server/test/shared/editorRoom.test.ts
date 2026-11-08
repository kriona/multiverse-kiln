import assert from 'assert';
import { detailsForVersionOpen, type UniverseEditDetail } from '@multiverse-kiln/shared';

/**
 * A save that touches both what each version holds and what the universe holds once
 */
const DETAILS: UniverseEditDetail[] = [
	{ subject: 'race', action: 'changed', target: { key: null, name: 'Dwarf' }, fields: [{ field: 'name', value: 'Dwarf' }], count: 1 },
	{ subject: 'settings', action: 'changed', target: null, fields: [{ field: 'groupSize', value: 4 }, { field: 'stage', value: 'prologue' }, { field: 'requireTwoFactor', value: true }], count: 1 },
	{ subject: 'cells', action: 'changed', target: { key: null, name: 'Cave' }, fields: [], count: 40 },
	{ subject: 'editor', action: 'added', target: { key: null, name: 'bea' }, fields: [{ field: 'role', value: 'builder' }], count: 1 },
	{ subject: 'draft', action: 'added', target: null, fields: [], count: 1 }
];

describe('editorRoom', () =>
{
	describe('detailsForVersionOpen', () =>
	{
		it('follows everything a save to the version open changed', () =>
		{
			assert.deepStrictEqual(detailsForVersionOpen(DETAILS, 'live', 'live'), DETAILS);
			assert.deepStrictEqual(detailsForVersionOpen(DETAILS, 'draft', 'draft'), DETAILS);
		});

		it('follows only the editors, the stage, whether 2FA is required and the draft of a save to the other version', () =>
		{
			const universeWide = [
				{ subject: 'settings', action: 'changed', target: null, fields: [{ field: 'stage', value: 'prologue' }, { field: 'requireTwoFactor', value: true }], count: 1 },
				DETAILS[3],
				DETAILS[4]
			];

			assert.deepStrictEqual(detailsForVersionOpen(DETAILS, 'draft', 'live'), universeWide);
			assert.deepStrictEqual(detailsForVersionOpen(DETAILS, 'live', 'draft'), universeWide);
		});

		it('follows nothing of a save that changed only the other version', () =>
		{
			assert.deepStrictEqual(detailsForVersionOpen(DETAILS.slice(0, 1), 'live', 'draft'), []);
			assert.deepStrictEqual(detailsForVersionOpen([{ subject: 'settings', action: 'changed', target: null, fields: [{ field: 'groupSize', value: 4 }], count: 1 }], 'live', 'draft'), []);
		});

		it('leaves the save\'s details as they were', () =>
		{
			detailsForVersionOpen(DETAILS, 'draft', 'live');
			assert.strictEqual(DETAILS[1].fields.length, 3);
		});
	});
});
