/**
 * The area each area is inside, for the dialogs that choose an area to show beside its name. How regions
 * and areas nest as a whole is in regions.ts
 */
import type { PlaceRef } from './regions.js';

/**
 * An area and its parents
 */
export interface AreaTreeNode
{
	id: string;

	/**
	 * The regions it is in and at most one area it is inside
	 */
	parents: readonly PlaceRef[];
}

/**
 * The area each area is directly inside, for showing beside every area of a list without searching the
 * areas once per area
 *
 * @param areas Every area of the universe
 * @return Each area's parent area by the area's ID, leaving out areas inside no area and areas whose
 * parent isn't among the areas or is the area itself
 */
export function parentAreas<T extends AreaTreeNode>(areas: readonly T[]): Map<string, T>
{
	const byId = new Map(areas.map((area) => [area.id, area]));
	const parents = new Map<string, T>();

	for (const area of areas)
	{
		const parentId = area.parents.find((parent) => (parent.kind === 'area'))?.id;
		const parent = ((parentId === undefined) ? undefined : byId.get(parentId));

		if ((parent !== undefined) && (parent.id !== area.id))
		{
			parents.set(area.id, parent);
		}
	}

	return(parents);
}
