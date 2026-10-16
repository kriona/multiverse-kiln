/**
 * How a universe's zones nest inside each other, as the Zones tab and the zone editor show them
 *
 * Each function stops at a zone it has already visited, so a parent loop in the data can't make it run forever
 */

/**
 * A zone and the zone it is inside
 */
export interface ZoneTreeNode
{
	id: string;

	/**
	 * null for a top-level zone
	 */
	parentZoneId: string | null;
}

/**
 * What the Zones tab lists
 */
export interface ZonesTabListing<T extends ZoneTreeNode>
{
	/**
	 * Zones the listing passed through because each was the only one at its level, outermost first
	 */
	path: T[];

	/**
	 * The zones at the level the listing stopped at
	 */
	zones: T[];
}

/**
 * The zones the Zones tab lists: the top-level zones apart from the lobby, except that while there is
 * only one zone at a level and it has zones inside it, those are listed instead
 *
 * @param zones Every zone of the universe, in the order to list them
 * @param lobbyZoneId The lobby's zone, which the tab leaves out
 * @return The zones passed through and the zones listed
 */
export function zonesTabListing<T extends ZoneTreeNode>(zones: readonly T[], lobbyZoneId: string | null): ZonesTabListing<T>
{
	const path: T[] = [];
	const visited = new Set<string>();
	let level = zones.filter((zone) => ((zone.parentZoneId === null) && (zone.id !== lobbyZoneId)));

	while ((level.length === 1) && !visited.has(level[0].id))
	{
		const only = level[0];
		const children = childZones(zones, only.id);

		if (children.length === 0)
		{
			break;
		}

		visited.add(only.id);
		path.push(only);
		level = children;
	}

	return({ path, zones: level });
}

/**
 * The zones directly inside a zone
 *
 * @param zones Every zone of the universe, in the order to list them
 * @param zoneId The zone
 * @return Its children, in the same order
 */
export function childZones<T extends ZoneTreeNode>(zones: readonly T[], zoneId: string): T[]
{
	return(zones.filter((zone) => (zone.parentZoneId === zoneId)));
}

/**
 * The zones a zone is inside
 *
 * @param zones Every zone of the universe
 * @param zoneId The zone
 * @return Its parent, its parent's parent and so on, nearest first
 */
export function ancestorZones<T extends ZoneTreeNode>(zones: readonly T[], zoneId: string): T[]
{
	const byId = new Map(zones.map((zone) => [zone.id, zone]));
	const ancestors: T[] = [];
	const visited = new Set<string>([zoneId]);
	let parentId = (byId.get(zoneId)?.parentZoneId ?? null);

	while ((parentId !== null) && !visited.has(parentId))
	{
		const parent = byId.get(parentId);

		if (!parent)
		{
			break;
		}

		visited.add(parentId);
		ancestors.push(parent);
		parentId = parent.parentZoneId;
	}

	return(ancestors);
}

/**
 * Every zone inside a zone, however deep
 *
 * @param zones Every zone of the universe
 * @param zoneId The zone
 * @return The IDs of the zones inside it, not including itself
 */
export function descendantZoneIds(zones: readonly ZoneTreeNode[], zoneId: string): Set<string>
{
	const descendants = new Set<string>();
	const waiting = [zoneId];

	while (waiting.length > 0)
	{
		const current = waiting.pop() as string;

		for (const child of childZones(zones, current))
		{
			if ((child.id !== zoneId) && !descendants.has(child.id))
			{
				descendants.add(child.id);
				waiting.push(child.id);
			}
		}
	}

	return(descendants);
}
