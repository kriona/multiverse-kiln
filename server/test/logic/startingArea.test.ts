import assert from 'assert';

import { chooseStartingArea, startingCellOn, type StartingAreaClass, type StartingAreaRace, type StartingPlace } from '../../src/logic/startingArea.js';

const town: StartingPlace = {
	areaId: 'town',
	column: 0,
	row: 0
};

const dwarf: StartingAreaRace = {
	id: 3,
	startingAreaId: 'mountain-hall',
	startingColumn: 4,
	startingRow: -2
};

const elf: StartingAreaRace = {
	id: 4,
	startingAreaId: null,
	startingColumn: 0,
	startingRow: 0
};

const anyClass: StartingAreaClass = {
	startingAreaId: null,
	startingColumn: 0,
	startingRow: 0,
	raceAreas: []
};

describe('chooseStartingArea', () =>
{
	it('starts a character in the universe\'s area when neither race nor class names one', () =>
	{
		assert.deepStrictEqual(chooseStartingArea({ ...town, column: 7, row: 3 }, elf, anyClass), { areaId: 'town', column: 7, row: 3 });
	});

	it('prefers the race\'s area to the universe\'s, with the race\'s cell', () =>
	{
		assert.deepStrictEqual(chooseStartingArea(town, dwarf, anyClass), { areaId: 'mountain-hall', column: 4, row: -2 });
	});

	it('prefers the class\'s area to the race\'s, with the class\'s cell', () =>
	{
		assert.deepStrictEqual(chooseStartingArea(town, dwarf, { ...anyClass, startingAreaId: 'barracks', startingColumn: -5, startingRow: 1 }), { areaId: 'barracks', column: -5, row: 1 });
	});

	it('prefers the class\'s entry for the race to everything else', () =>
	{
		const wizard: StartingAreaClass = {
			...anyClass,
			raceAreas: [
				{
					raceId: elf.id,
					areaId: 'elven-academy',
					column: 2,
					row: 2
				},
				{
					raceId: dwarf.id,
					areaId: 'rune-forge',
					column: -1,
					row: 6
				}
			]
		};

		assert.deepStrictEqual(chooseStartingArea(town, dwarf, wizard), { areaId: 'rune-forge', column: -1, row: 6 });
		assert.deepStrictEqual(chooseStartingArea(town, elf, wizard), { areaId: 'elven-academy', column: 2, row: 2 });
	});

	it('falls back past a class whose entries are for other races', () =>
	{
		const ranger: StartingAreaClass = {
			...anyClass,
			raceAreas: [
				{
					raceId: elf.id,
					areaId: 'forest-camp',
					column: 0,
					row: 0
				}
			]
		};

		assert.deepStrictEqual(chooseStartingArea(town, dwarf, ranger), { areaId: 'mountain-hall', column: 4, row: -2 });
	});

	it('has no area only when the universe has none either', () =>
	{
		assert.strictEqual(chooseStartingArea(null, elf, anyClass), null);
	});
});

describe('startingCellOn', () =>
{
	const bounds = {
		minColumn: -10,
		minRow: -5,
		maxColumn: 10,
		maxRow: 5
	};

	it('keeps a cell on the map', () =>
	{
		assert.deepStrictEqual(startingCellOn(bounds, { column: 3, row: -4 }), { column: 3, row: -4 });
	});

	it('moves a cell the map no longer holds to the nearest edge', () =>
	{
		assert.deepStrictEqual(startingCellOn(bounds, { column: 25, row: -9 }), { column: 10, row: -5 });
		assert.deepStrictEqual(startingCellOn(bounds, { column: -40, row: 2 }), { column: -10, row: 2 });
	});
});
