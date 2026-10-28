import assert from 'assert';
import { compareNumbers, sortRows, type RowComparers } from '@multiverse-kiln/shared';

interface Row
{
	name: string;
	size: number;
}

const comparers: RowComparers<Row, 'name' | 'size'> = {
	name: (first, second) => first.name.localeCompare(second.name),
	size: (first, second) => compareNumbers(first.size, second.size)
};

const rows: Row[] = [
	{ name: 'b', size: 2 },
	{ name: 'a', size: 2 },
	{ name: 'c', size: 1 }
];

describe('sorting (shared)', () =>
{
	describe('sortRows', () =>
	{
		it('sorts by a column either way, keeping the order of rows that tie', () =>
		{
			assert.deepStrictEqual(sortRows(rows, comparers, { column: 'name', direction: 'ascending' }).map((row) => row.name), ['a', 'b', 'c']);
			assert.deepStrictEqual(sortRows(rows, comparers, { column: 'name', direction: 'descending' }).map((row) => row.name), ['c', 'b', 'a']);
			assert.deepStrictEqual(sortRows(rows, comparers, { column: 'size', direction: 'ascending' }).map((row) => row.name), ['c', 'b', 'a']);
			assert.deepStrictEqual(sortRows(rows, comparers, { column: 'size', direction: 'descending' }).map((row) => row.name), ['b', 'a', 'c']);
		});

		it('leaves the rows it was given as they were', () =>
		{
			sortRows(rows, comparers, { column: 'name', direction: 'ascending' });

			assert.deepStrictEqual(rows.map((row) => row.name), ['b', 'a', 'c']);
		});
	});
});
