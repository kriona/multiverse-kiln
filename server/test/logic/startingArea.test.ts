import assert from 'assert';

import { chooseStartingArea, type StartingAreaClass, type StartingAreaRace } from '../../src/logic/startingArea.js';

const dwarf: StartingAreaRace = {
	id: 3,
	startingAreaId: 'mountain-hall'
};

const elf: StartingAreaRace = {
	id: 4,
	startingAreaId: null
};

const anyClass: StartingAreaClass = {
	startingAreaId: null,
	raceAreas: []
};

describe('chooseStartingArea', () =>
{
	it('starts a character in the universe\'s area when neither race nor class names one', () =>
	{
		assert.strictEqual(chooseStartingArea('town', elf, anyClass), 'town');
	});

	it('prefers the race\'s area to the universe\'s', () =>
	{
		assert.strictEqual(chooseStartingArea('town', dwarf, anyClass), 'mountain-hall');
	});

	it('prefers the class\'s area to the race\'s', () =>
	{
		assert.strictEqual(chooseStartingArea('town', dwarf, { ...anyClass, startingAreaId: 'barracks' }), 'barracks');
	});

	it('prefers the class\'s entry for the race to everything else', () =>
	{
		const wizard: StartingAreaClass = {
			startingAreaId: null,
			raceAreas: [
				{
					raceId: elf.id,
					areaId: 'elven-academy'
				},
				{
					raceId: dwarf.id,
					areaId: 'rune-forge'
				}
			]
		};

		assert.strictEqual(chooseStartingArea('town', dwarf, wizard), 'rune-forge');
		assert.strictEqual(chooseStartingArea('town', elf, wizard), 'elven-academy');
	});

	it('falls back past a class whose entries are for other races', () =>
	{
		const ranger: StartingAreaClass = {
			startingAreaId: null,
			raceAreas: [
				{
					raceId: elf.id,
					areaId: 'forest-camp'
				}
			]
		};

		assert.strictEqual(chooseStartingArea('town', dwarf, ranger), 'mountain-hall');
	});

	it('has no area only when the universe has none either', () =>
	{
		assert.strictEqual(chooseStartingArea(null, elf, anyClass), null);
	});
});
