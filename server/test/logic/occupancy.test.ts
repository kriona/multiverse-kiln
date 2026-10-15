import assert from 'assert';

import { CellOccupancy } from '../../src/logic/occupancy.js';

const cellA = { column: 1, row: 1 };
const cellB = { column: 2, row: 1 };

describe('CellOccupancy', () =>
{
	it('treats cells no one holds as free', () =>
	{
		assert.strictEqual(new CellOccupancy().isFreeFor('p1')(cellA), true);
	});

	it('treats another player\'s cells as held and a player\'s own cells as free', () =>
	{
		const occupancy = new CellOccupancy();

		occupancy.hold('p1', [cellA]);

		assert.strictEqual(occupancy.isFreeFor('p2')(cellA), false);
		assert.strictEqual(occupancy.isFreeFor('p1')(cellA), true);
	});

	it('frees a player\'s old cells when it holds new ones', () =>
	{
		const occupancy = new CellOccupancy();

		occupancy.hold('p1', [cellA, cellB]);
		occupancy.hold('p1', [cellB]);

		assert.strictEqual(occupancy.isFreeFor('p2')(cellA), true);
		assert.strictEqual(occupancy.isFreeFor('p2')(cellB), false);
	});

	it('frees every cell of a released player', () =>
	{
		const occupancy = new CellOccupancy();

		occupancy.hold('p1', [cellA, cellB]);
		occupancy.release('p1');

		assert.strictEqual(occupancy.isFreeFor('p2')(cellA), true);
		assert.strictEqual(occupancy.isFreeFor('p2')(cellB), true);
	});

	it('sees changes made after the check was created', () =>
	{
		const occupancy = new CellOccupancy();
		const isFree = occupancy.isFreeFor('p2');

		occupancy.hold('p1', [cellA]);

		assert.strictEqual(isFree(cellA), false);
	});
});
