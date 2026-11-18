import assert from 'assert';
import { currentItemTypes, DEFAULT_ITEM_DESCRIPTIONS, DEFAULT_ITEM_EQUIPS, DEFAULT_ITEM_KINDS, DEFAULT_ITEM_NAMES, isItemEquips, isItemKind, ITEM_KINDS, PF1E_DEFAULT_ITEM_DESCRIPTIONS, PF1E_DEFAULT_ITEM_EQUIPS, PF1E_DEFAULT_ITEM_KINDS, PF1E_DEFAULT_ITEM_NAMES, PF1E_ITEM_RULEBOOKS, PF1E_RULEBOOKS, singleItemTypeKind, type Pf1eDefaultItemKey } from '@multiverse-kiln/shared';

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
		assert.deepStrictEqual(singleItemTypeKind('pf1e', 'torch'), {
			category: 'gear',
			types: ['light_source']
		});
		assert.deepStrictEqual(singleItemTypeKind('sf1e', 'laser_pistol'), {
			category: 'weapon',
			types: ['small_arms']
		});
		assert.deepStrictEqual(singleItemTypeKind('sf1e', 'comm_unit'), {
			category: 'gear',
			types: []
		});
		assert.deepStrictEqual(singleItemTypeKind('sf1e', 'longarms'), {
			category: 'weapon',
			types: ['longarms']
		});
		assert.deepStrictEqual(singleItemTypeKind('sf1e', 'other_gear'), {
			category: 'gear',
			types: []
		});
	});

	it('gives every Pathfinder 1E default item a name, description, kind, book and place to equip', () =>
	{
		const keys = Object.keys(PF1E_DEFAULT_ITEM_NAMES);

		for (const table of [PF1E_DEFAULT_ITEM_DESCRIPTIONS, PF1E_DEFAULT_ITEM_KINDS, PF1E_ITEM_RULEBOOKS, PF1E_DEFAULT_ITEM_EQUIPS])
		{
			assert.deepStrictEqual(Object.keys(table).sort(), [...keys].sort());
		}

		for (const key of keys as Pf1eDefaultItemKey[])
		{
			const name = PF1E_DEFAULT_ITEM_NAMES[key];
			const description = PF1E_DEFAULT_ITEM_DESCRIPTIONS[key];

			assert.strictEqual(name.id, `item.pf1e.${key}`);
			assert.strictEqual(description.id, `itemDescription.pf1e.${key}`);
			assert.strictEqual(name.defaultMessage, name.defaultMessage.toLowerCase(), `${key}'s name isn't lowercase`);
			assert.ok(isItemKind('pf1e', PF1E_DEFAULT_ITEM_KINDS[key]), `${key} has an unknown category or type`);
			assert.ok(isItemEquips('pf1e', PF1E_DEFAULT_ITEM_EQUIPS[key]), `${key} equips somewhere Pathfinder has no place for`);
			assert.ok(PF1E_RULEBOOKS.includes(PF1E_ITEM_RULEBOOKS[key]), `${key} has an unknown book`);
		}
	});

	it('gives Pathfinder 1E ammunition and shields their types, and ammunition nowhere to equip', () =>
	{
		for (const [key, kind] of Object.entries(PF1E_DEFAULT_ITEM_KINDS) as [Pf1eDefaultItemKey, typeof PF1E_DEFAULT_ITEM_KINDS[Pf1eDefaultItemKey]][])
		{
			if (kind.types.includes('ammunition'))
			{
				assert.strictEqual(PF1E_DEFAULT_ITEM_EQUIPS[key], 'none', `${key} is ammunition that equips`);
			}

			if (kind.types.includes('shields'))
			{
				assert.ok(['oneHand', 'offArm'].includes(PF1E_DEFAULT_ITEM_EQUIPS[key]), `${key} is a shield that isn't held or strapped to the arm`);
			}
		}
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
			sf1e: ['survival_knife', 'tactical_baton', 'laser_pistol', 'semi_auto_pistol', 'laser_rifle', 'frag_grenade', 'battery', 'small_arm_rounds', 'second_skin', 'light_armor', 'heavy_armor', 'comm_unit', 'flashlight', 'other_gear', ...Object.keys(ITEM_KINDS.sf1e.types)]
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

	it('brings renamed types up to date, in the ruleset\'s order', () =>
	{
		assert.deepStrictEqual(currentItemTypes('pf1e', ['rope', 'torch']), ['light_source', 'rope']);
		assert.deepStrictEqual(currentItemTypes('pf1e', ['blades_light', 'thrown']), ['blades_light', 'thrown']);
		assert.deepStrictEqual(currentItemTypes('sf1e', ['laser_pistol', 'semi_auto_pistol']), ['small_arms']);
		assert.deepStrictEqual(currentItemTypes('sf1e', ['flashlight', 'comm_unit']), ['light_source']);
		assert.deepStrictEqual(currentItemTypes('sf1e', ['comm_unit']), []);
		assert.deepStrictEqual(currentItemTypes('sf1e', ['second_skin', 'heavy_armor']), ['light_armor', 'heavy_armor']);
	});

	it('keeps types the ruleset never had, for a save to refuse', () =>
	{
		assert.deepStrictEqual(currentItemTypes('sf1e', ['blades_light', 'battery']), ['ammunition', 'blades_light']);
		assert.ok(!isItemKind('sf1e', {
			category: 'weapon',
			types: currentItemTypes('sf1e', ['blades_light'])
		}));
	});

	it('gives every Starfinder default item a kind, a description and somewhere the ruleset has to equip', () =>
	{
		for (const key of Object.keys(DEFAULT_ITEM_NAMES.sf1e))
		{
			assert.ok(isItemKind('sf1e', DEFAULT_ITEM_KINDS.sf1e[key]), `${key} has an unknown category or type`);
			assert.ok(DEFAULT_ITEM_DESCRIPTIONS.sf1e[key], `${key} has no description`);
			assert.ok(isItemEquips('sf1e', DEFAULT_ITEM_EQUIPS.sf1e[key]), `${key} has nowhere to equip`);
		}

		assert.deepStrictEqual(DEFAULT_ITEM_KINDS.sf1e.tactical_longsword, {
			category: 'weapon',
			types: ['advanced_melee']
		});
		assert.strictEqual(DEFAULT_ITEM_EQUIPS.sf1e.azimuth_laser_rifle, 'twoHands');
		assert.strictEqual(DEFAULT_ITEM_EQUIPS.sf1e.frag_grenade_1, 'oneHand');
		assert.strictEqual(DEFAULT_ITEM_EQUIPS.sf1e.battery, 'none');
		assert.strictEqual(DEFAULT_ITEM_EQUIPS.sf1e.second_skin, 'armor');
		assert.strictEqual(DEFAULT_ITEM_DESCRIPTIONS.sf1e.tactical_longsword, DEFAULT_ITEM_DESCRIPTIONS.sf1e.zero_edge_longsword);
	});
});
