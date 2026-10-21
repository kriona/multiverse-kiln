/**
 * How a universe's areas nest inside each other, as the Areas tab and the area editor show them
 *
 * Each function stops at an area it has already visited, so a parent loop in the data can't make it run forever
 */

/**
 * An area and the area it is inside
 */
export interface AreaTreeNode
{
	id: string;

	/**
	 * null for a top-level area
	 */
	parentAreaId: string | null;
}

/**
 * What the Areas tab lists
 */
export interface AreasTabListing<T extends AreaTreeNode>
{
	/**
	 * Areas the listing passed through because each was the only one at its level, outermost first
	 */
	path: T[];

	/**
	 * The areas at the level the listing stopped at
	 */
	areas: T[];
}

/**
 * The areas the Areas tab lists: the top-level areas apart from the lobby, except that while there is
 * only one area at a level and it has areas inside it, those are listed instead
 *
 * @param areas Every area of the universe, in the order to list them
 * @param lobbyAreaId The lobby's area, which the tab leaves out
 * @return The areas passed through and the areas listed
 */
export function areasTabListing<T extends AreaTreeNode>(areas: readonly T[], lobbyAreaId: string | null): AreasTabListing<T>
{
	const path: T[] = [];
	const visited = new Set<string>();
	let level = areas.filter((area) => ((area.parentAreaId === null) && (area.id !== lobbyAreaId)));

	while ((level.length === 1) && !visited.has(level[0].id))
	{
		const only = level[0];
		const children = childAreas(areas, only.id);

		if (children.length === 0)
		{
			break;
		}

		visited.add(only.id);
		path.push(only);
		level = children;
	}

	return({ path, areas: level });
}

/**
 * The areas directly inside an area
 *
 * @param areas Every area of the universe, in the order to list them
 * @param areaId The area
 * @return Its children, in the same order
 */
export function childAreas<T extends AreaTreeNode>(areas: readonly T[], areaId: string): T[]
{
	return(areas.filter((area) => (area.parentAreaId === areaId)));
}

/**
 * The areas an area is inside
 *
 * @param areas Every area of the universe
 * @param areaId The area
 * @return Its parent, its parent's parent and so on, nearest first
 */
export function ancestorAreas<T extends AreaTreeNode>(areas: readonly T[], areaId: string): T[]
{
	const byId = new Map(areas.map((area) => [area.id, area]));
	const ancestors: T[] = [];
	const visited = new Set<string>([areaId]);
	let parentId = (byId.get(areaId)?.parentAreaId ?? null);

	while ((parentId !== null) && !visited.has(parentId))
	{
		const parent = byId.get(parentId);

		if (!parent)
		{
			break;
		}

		visited.add(parentId);
		ancestors.push(parent);
		parentId = parent.parentAreaId;
	}

	return(ancestors);
}

/**
 * Every area inside an area, however deep
 *
 * @param areas Every area of the universe
 * @param areaId The area
 * @return The IDs of the areas inside it, not including itself
 */
export function descendantAreaIds(areas: readonly AreaTreeNode[], areaId: string): Set<string>
{
	const descendants = new Set<string>();
	const waiting = [areaId];

	while (waiting.length > 0)
	{
		const current = waiting.pop() as string;

		for (const child of childAreas(areas, current))
		{
			if ((child.id !== areaId) && !descendants.has(child.id))
			{
				descendants.add(child.id);
				waiting.push(child.id);
			}
		}
	}

	return(descendants);
}
