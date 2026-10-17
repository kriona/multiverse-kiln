import assert from 'assert';

import { chooseStartingZone, type StartingZoneClass, type StartingZoneRace } from '../../src/logic/startingZone.js';

const dwarf: StartingZoneRace = {
	id: 3,
	startingZoneId: 'mountain-hall'
};

const elf: StartingZoneRace = {
	id: 4,
	startingZoneId: null
};

const anyClass: StartingZoneClass = {
	startingZoneId: null,
	raceZones: []
};

describe('chooseStartingZone', () =>
{
	it('starts a character in the universe\'s zone when neither race nor class names one', () =>
	{
		assert.strictEqual(chooseStartingZone('town', elf, anyClass), 'town');
	});

	it('prefers the race\'s zone to the universe\'s', () =>
	{
		assert.strictEqual(chooseStartingZone('town', dwarf, anyClass), 'mountain-hall');
	});

	it('prefers the class\'s zone to the race\'s', () =>
	{
		assert.strictEqual(chooseStartingZone('town', dwarf, { ...anyClass, startingZoneId: 'barracks' }), 'barracks');
	});

	it('prefers the class\'s entry for the race to everything else', () =>
	{
		const wizard: StartingZoneClass = {
			startingZoneId: null,
			raceZones: [
				{
					raceId: elf.id,
					zoneId: 'elven-academy'
				},
				{
					raceId: dwarf.id,
					zoneId: 'rune-forge'
				}
			]
		};

		assert.strictEqual(chooseStartingZone('town', dwarf, wizard), 'rune-forge');
		assert.strictEqual(chooseStartingZone('town', elf, wizard), 'elven-academy');
	});

	it('falls back past a class whose entries are for other races', () =>
	{
		const ranger: StartingZoneClass = {
			startingZoneId: null,
			raceZones: [
				{
					raceId: elf.id,
					zoneId: 'forest-camp'
				}
			]
		};

		assert.strictEqual(chooseStartingZone('town', dwarf, ranger), 'mountain-hall');
	});

	it('has no zone only when the universe has none either', () =>
	{
		assert.strictEqual(chooseStartingZone(null, elf, anyClass), null);
	});
});
