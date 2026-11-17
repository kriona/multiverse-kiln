import assert from 'assert';
import { isItemKind, ITEM_KINDS, singleItemTypeKind } from '@multiverse-kiln/shared';

describe('items', () =>
{
	it('gives an item\'s one type its category and types', () =>
	{
		assert.deepStrictEqual(singleItemTypeKind('pf1e', 'dagger'), {
			category: 'weapon',
			types: ['blades_light', 'thrown']
		});
		assert.deepStrictEqual(singleItemTypeKind('pf1e', 'arrows'), {
			category: 'weapon',
			types: []
		});
		assert.deepStrictEqual(singleItemTypeKind('sf1e', 'laser_pistol'), {
			category: 'weapon',
			types: ['laser_pistol']
		});
		assert.deepStrictEqual(singleItemTypeKind('sf1e', 'other_gear'), {
			category: 'gear',
			types: []
		});
	});

	it('gives no category and types for a type the ruleset never had', () =>
	{
		assert.strictEqual(singleItemTypeKind('pf1e', 'laser_pistol'), undefined);
		assert.strictEqual(singleItemTypeKind('pf1e', 'constructor'), undefined);
		assert.strictEqual(singleItemTypeKind('sf1e', 'toString'), undefined);
	});

	it('gives every old type a category and types the ruleset has', () =>
	{
		const oldTypes = {
			pf1e: ['dagger', 'club', 'quarterstaff', 'spear', 'short_sword', 'longsword', 'shortbow', 'longbow', 'light_crossbow', 'arrows', 'crossbow_bolts', 'cestus', 'sword_cane', 'kobold_long_lash', 'kobold_spiked_tail', 'ratfolk_tailblade', 'padded_armor', 'leather_armor', 'chain_shirt', 'wooden_armor', 'quilted_cloth', 'light_shield', 'heavy_shield', 'rope', 'torch', 'other_gear'],
			sf1e: [...Object.keys(ITEM_KINDS.sf1e.types), 'other_gear']
		};

		for (const [ruleset, types] of Object.entries(oldTypes) as [keyof typeof oldTypes, string[]][])
		{
			for (const type of types)
			{
				const kind = singleItemTypeKind(ruleset, type);

				assert.ok((kind !== undefined) && isItemKind(ruleset, kind), `${ruleset} ${type}`);
			}
		}
	});
});
