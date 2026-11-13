import assert from 'assert';
import { parentAreas, type AreaTreeNode } from '@multiverse-kiln/shared';

/**
 * An area in a region, and inside another area when one is given
 *
 * @param id The area's ID
 * @param parentAreaId Its parent area's ID, if any
 * @return The area
 */
function area(id: string, parentAreaId: string | null = null): AreaTreeNode
{
	return({ id, parents: [{ kind: 'region', id: 'world' }, ...((parentAreaId === null) ? [] : [{ kind: 'area' as const, id: parentAreaId }])] });
}

describe('The area tree (shared)', () =>
{
	it('finds the area each area is inside, past its regions', () =>
	{
		const areas = [area('continent'), area('city', 'continent'), area('inn', 'city')];
		const parents = parentAreas([...areas, area('cave', 'missing'), area('self', 'self')]);

		assert.deepStrictEqual([...parents].map(([id, parent]) => [id, parent.id]), [['city', 'continent'], ['inn', 'city']]);
	});
});
