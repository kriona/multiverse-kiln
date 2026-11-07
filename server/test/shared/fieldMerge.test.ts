import assert from 'assert';
import { flattenSettings, mergeSettings, sameValue, settleConflict, unflattenSettings, type EditorChange } from '@multiverse-kiln/shared';

/**
 * Groups a starting area's area, column and row as one setting, as the audit does, and every other
 * setting on its own
 *
 * @param key The setting's key
 * @return Its group
 */
function groupOf(key: string): string
{
	return((key.startsWith('starting') ? 'startingArea' : key));
}

describe('fieldMerge', () =>
{
	describe('sameValue', () =>
	{
		it('compares lists in order and objects whatever their order', () =>
		{
			assert.ok(sameValue({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 }));
			assert.ok(!sameValue([1, 2], [2, 1]));
			assert.ok(sameValue({ a: 1, b: undefined }, { a: 1 }));
			assert.ok(!sameValue(null, {}));
		});
	});

	describe('mergeSettings', () =>
	{
		it('saves what the change changed and keeps what another editor saved for the rest', () =>
		{
			const loaded = { name: 'Dwarf', speed: 20, size: 'medium' };
			const saved = { name: 'Stout', speed: 20, size: 'medium' };
			const sent = { name: 'Dwarf', speed: 30, size: 'medium' };

			assert.deepStrictEqual(mergeSettings(saved, loaded, sent, groupOf), {
				merged: { name: 'Stout', speed: 30, size: 'medium' },
				conflicts: []
			});
		});

		it('conflicts on a setting both changed to different values, but not to the same one', () =>
		{
			const loaded = { name: 'Dwarf', speed: 20 };
			const saved = { name: 'Stout', speed: 25 };

			assert.deepStrictEqual(mergeSettings(saved, loaded, { name: 'Hardy', speed: 25 }, groupOf).conflicts, [['name']]);
		});

		it('merges a setting made of several as one', () =>
		{
			const loaded = { startingAreaId: 'a', startingColumn: 0, startingRow: 0 };
			const saved = { startingAreaId: 'a', startingColumn: 5, startingRow: 0 };
			const sent = { startingAreaId: 'a', startingColumn: 0, startingRow: 3 };

			assert.deepStrictEqual(mergeSettings(saved, loaded, sent, groupOf).conflicts, [['startingAreaId', 'startingColumn', 'startingRow']]);
		});

		it('saves a setting the loaded settings leave out as sent', () =>
		{
			assert.deepStrictEqual(mergeSettings({ name: 'Stout' }, {}, { name: 'Hardy' }, groupOf), {
				merged: { name: 'Hardy' },
				conflicts: []
			});
		});
	});

	describe('flattenSettings and unflattenSettings', () =>
	{
		it('puts rules beside the other settings, and back under rules', () =>
		{
			const settings = { name: 'Dwarf', rules: { size: 'medium', darkvision: 'normal' } };
			const flat = flattenSettings(settings);

			assert.deepStrictEqual(flat, { name: 'Dwarf', size: 'medium', darkvision: 'normal' });
			assert.deepStrictEqual(unflattenSettings({ ...flat, size: 'small' }, settings), { name: 'Dwarf', rules: { size: 'small', darkvision: 'normal' } });
		});
	});

	describe('settleConflict', () =>
	{
		const change = { kind: 'saveRace', id: 1, settings: { name: 'Hardy', rules: { size: 'small' } }, loaded: { name: 'Dwarf', size: 'medium' } } as unknown as EditorChange & { kind: 'saveRace' };

		it('keeps the change\'s value by counting the saved value as loaded', () =>
		{
			const settled = settleConflict(change, { size: 'large' }, true);

			assert.deepStrictEqual([settled.settings, settled.loaded], [change.settings, { name: 'Dwarf', size: 'large' }]);
		});

		it('takes the saved value into the change', () =>
		{
			const settled = settleConflict(change, { size: 'large' }, false);

			assert.deepStrictEqual([settled.settings, settled.loaded], [{ name: 'Hardy', rules: { size: 'large' } }, { name: 'Dwarf', size: 'large' }]);
		});
	});
});
