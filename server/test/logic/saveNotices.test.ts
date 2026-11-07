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

/**
 * A save to what translators see apart from the settings: translations, and the things whose names the
 * Translations tab lists, renamed or changed otherwise
 */
const TRANSLATOR_DETAILS: UniverseEditDetail[] = [
	{ subject: 'translations', action: 'changed', target: { key: null, name: 'de' }, fields: [], count: 3 },
	{ subject: 'item', action: 'added', target: { key: null, name: 'Shiv' }, fields: [], count: 1 },
	{ subject: 'race', action: 'changed', target: { key: null, name: 'Elf' }, fields: [{ field: 'name', value: 'Elf' }, { field: 'enabled', value: false }], count: 1 },
	{ subject: 'class', action: 'changed', target: { key: null, name: 'Rogue' }, fields: [{ field: 'enabled', value: false }], count: 1 },
	{ subject: 'area', action: 'deleted', target: { key: null, name: 'Cave' }, fields: [], count: 1 },
	{ subject: 'area', action: 'resized', target: { key: null, name: 'Meadow' }, fields: [], count: 1 },
	{ subject: 'links', action: 'changed', target: { key: null, name: 'Meadow' }, fields: [], count: 2 },
	{ subject: 'ruleset', action: 'changed', target: null, fields: [{ field: 'tracksAmmo', value: true }], count: 1 }
];

describe('saveNotices', () =>
{
	describe('noticeDetails', () =>
	{
		it('tells a window with the version saved open everything', () =>
		{
			assert.deepStrictEqual(noticeDetails(DETAILS, 'live', 'live', 'creator'), DETAILS);
			assert.deepStrictEqual(noticeDetails(DETAILS, 'draft', 'draft', 'creator'), DETAILS);
		});

		it('tells a window with the other version open only of the editors, the stage and the draft', () =>
		{
			assert.deepStrictEqual(noticeDetails(DETAILS, 'draft', 'live', 'creator'), [
				{ subject: 'settings', action: 'changed', target: null, fields: [{ field: 'stage', value: 'prologue' }], count: 1 },
				DETAILS[3],
				DETAILS[4]
			]);
		});

		it('tells a window with the other version open nothing of a save that changed only that version', () =>
		{
			assert.deepStrictEqual(noticeDetails(DETAILS.slice(0, 1), 'live', 'draft', 'creator'), []);
			assert.deepStrictEqual(noticeDetails([{ subject: 'settings', action: 'changed', target: null, fields: [{ field: 'groupSize', value: 4 }], count: 1 }], 'live', 'draft', 'creator'), []);
		});

		it('tells builders and site admins everything, as they see every tab the save changes', () =>
		{
			assert.deepStrictEqual(noticeDetails(DETAILS, 'live', 'live', 'builder'), DETAILS);
			assert.deepStrictEqual(noticeDetails(DETAILS, 'live', 'live', 'admin'), DETAILS);
		});

		it('tells beta testers only of the editors, the settings and the draft', () =>
		{
			assert.deepStrictEqual(noticeDetails(DETAILS, 'live', 'live', 'beta_tester'), [DETAILS[1], DETAILS[3], DETAILS[4]]);
			assert.deepStrictEqual(noticeDetails(TRANSLATOR_DETAILS, 'live', 'live', 'beta_tester'), []);
		});

		it('tells translators also of the translations and of the names the Translations tab lists', () =>
		{
			assert.deepStrictEqual(noticeDetails(DETAILS, 'live', 'live', 'translator'), [DETAILS[0], DETAILS[1], DETAILS[3], DETAILS[4]]);
			assert.deepStrictEqual(noticeDetails(TRANSLATOR_DETAILS, 'live', 'live', 'translator'), [
				TRANSLATOR_DETAILS[0],
				TRANSLATOR_DETAILS[1],
				{ subject: 'race', action: 'changed', target: { key: null, name: 'Elf' }, fields: [{ field: 'name', value: 'Elf' }], count: 1 },
				TRANSLATOR_DETAILS[4]
			]);
		});

		it('applies a role\'s limits to a window with the other version open too', () =>
		{
			assert.deepStrictEqual(noticeDetails(DETAILS, 'draft', 'live', 'beta_tester'), [
				{ subject: 'settings', action: 'changed', target: null, fields: [{ field: 'stage', value: 'prologue' }], count: 1 },
				DETAILS[3],
				DETAILS[4]
			]);
			assert.deepStrictEqual(noticeDetails(TRANSLATOR_DETAILS, 'draft', 'live', 'translator'), []);
		});

		it('leaves the save\'s details as they were', () =>
		{
			noticeDetails(DETAILS, 'draft', 'live', 'creator');
			noticeDetails(TRANSLATOR_DETAILS, 'live', 'live', 'translator');
			assert.strictEqual(DETAILS[1].fields.length, 2);
			assert.strictEqual(TRANSLATOR_DETAILS[2].fields.length, 2);
		});
	});
});
