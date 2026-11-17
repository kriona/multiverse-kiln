import assert from 'assert';
import { isRulebookBarred, isRulebookOn, isUsable, normalizedRulebooks, optionalRulebooks, PF1E_CLASS_RULEBOOKS, PF1E_CLASSES, PF1E_RACE_RULEBOOKS, PF1E_RACES, PF1E_RULEBOOKS } from '@multiverse-kiln/shared';

describe('rulebooks', () =>
{
	it('lists every book but the core rulebook as optional', () =>
	{
		assert.deepStrictEqual(optionalRulebooks('pf1e'), ['apg', 'arg', 'acg']);
		assert.deepStrictEqual(optionalRulebooks('sf1e'), []);
	});

	it('shows the core rulebook, the books on, and what the universe added', () =>
	{
		assert.strictEqual(isRulebookOn([], 'core'), true);
		assert.strictEqual(isRulebookOn([], null), true);
		assert.strictEqual(isRulebookOn([], 'apg'), false);
		assert.strictEqual(isRulebookOn(['apg'], 'apg'), true);
	});

	it('makes usable only what is enabled with its book on', () =>
	{
		assert.strictEqual(isUsable({ enabled: true, rulebook: 'arg' }, ['arg']), true);
		assert.strictEqual(isUsable({ enabled: false, rulebook: 'arg' }, ['arg']), false);
		assert.strictEqual(isUsable({ enabled: true, rulebook: 'arg' }, []), false);
		assert.strictEqual(isUsable({ enabled: true, rulebook: null }, []), true);
	});

	it('bars only books that are off and were turned off that way', () =>
	{
		assert.strictEqual(isRulebookBarred({ rulebooks: [], barredRulebooks: ['apg'] }, 'apg'), true);
		assert.strictEqual(isRulebookBarred({ rulebooks: ['apg'], barredRulebooks: ['apg'] }, 'apg'), false);
		assert.strictEqual(isRulebookBarred({ rulebooks: [], barredRulebooks: [] }, 'apg'), false);
		assert.strictEqual(isRulebookBarred({ rulebooks: [], barredRulebooks: ['apg'] }, null), false);
	});

	it('saves books in the Ruleset tab\'s order, each once, leaving out unknown and barred books that are on', () =>
	{
		assert.deepStrictEqual(normalizedRulebooks('pf1e', {
			rulebooks: ['acg', 'core', 'apg', 'acg', 'unknown'],
			barredRulebooks: ['arg', 'apg']
		}), {
			rulebooks: ['apg', 'acg'],
			barredRulebooks: ['arg']
		});
	});

	it('gives every default race and class a book of its ruleset', () =>
	{
		for (const key of Object.keys(PF1E_RACES) as (keyof typeof PF1E_RACES)[])
		{
			assert.ok(PF1E_RULEBOOKS.includes(PF1E_RACE_RULEBOOKS[key]), key);
		}

		for (const key of Object.keys(PF1E_CLASSES) as (keyof typeof PF1E_CLASSES)[])
		{
			assert.ok(PF1E_RULEBOOKS.includes(PF1E_CLASS_RULEBOOKS[key]), key);
		}
	});
});
