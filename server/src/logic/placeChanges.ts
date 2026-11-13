/**
 * What a save's changes to regions and areas would do to which areas are enabled, worked out in memory
 * without saving anything, so the editor can warn about the areas they disable with characters in them
 * (see Disabling things players are using in STRUCTURE-OVERVIEW.md)
 */
import { samePlace, type AreaNode, type EditorChange, type PlaceGraph, type PlaceNode, type PlaceRef, type PlaceSettings } from '@multiverse-kiln/shared';

import type { PlaceModel } from './placeModel.js';

/**
 * The areas enabled once everything above them is: an area is enabled only while it and everything above
 * it are, along every path
 *
 * @param graph The regions and areas
 * @return The enabled areas' IDs
 */
export function enabledAreaIds(graph: PlaceGraph): Set<string>
{
	const enabled = new Set<string>();

	for (const area of graph.areas.values())
	{
		const place: PlaceRef = { kind: 'area', id: area.id };

		if ((area.enabled !== false) && graph.ancestorsOf(place).every((ancestor) => (graph.node(ancestor)?.enabled !== false)))
		{
			enabled.add(area.id);
		}
	}

	return(enabled);
}

/**
 * The settings a change gives a region or area, over those it has, leaving out what doesn't decide
 * whether areas are enabled. A default tile made in the save is left as it was
 *
 * @param node The region or area
 * @param update The settings the change sends
 * @return The node with them
 */
function withUpdate<Node extends PlaceNode>(node: Node, update: Partial<Omit<PlaceSettings, 'defaultTileId'>> & { name?: string; parents?: PlaceRef[]; defaultTileId?: number | string | null }): Node
{
	const { defaultTileId, ...rest } = update;

	return({
		...node,
		...rest,
		...(((defaultTileId === undefined) || (typeof defaultTileId === 'string')) ? {} : { defaultTileId })
	});
}

/**
 * Applies one change to regions and areas to a model, naming what the save makes by its ref. Other
 * changes leave it as it is
 *
 * @param model The regions and areas as the changes before it left them, which it changes
 * @param change The change
 */
export function applyPlaceChange(model: PlaceModel, change: EditorChange): void
{
	switch (change.kind)
	{
		case 'createRegion':
			model.setRegion(withUpdate({ ...blankNode(change.ref), name: change.region.name, parents: [] }, change.region));
			break;

		case 'updateRegion':
		{
			const region = model.region(change.regionId);

			if (region)
			{
				model.setRegion(withUpdate(region, change.update));
			}

			break;
		}

		case 'deleteRegion':
			model.deleteRegion(change.regionId);
			break;

		case 'createArea':
			model.setArea(withUpdate({ ...blankNode(change.ref), name: change.area.name, parents: [], loopsEastWest: false, loopsNorthSouth: false }, change.area));
			break;

		case 'updateArea':
		{
			const area = model.area(change.areaId);

			if (area)
			{
				model.setArea(withUpdate(area, change.update));
			}

			break;
		}

		case 'deleteArea':
			model.deleteArea(change.areaId);
			break;

		default:
			break;
	}
}

/**
 * A region or area with every setting inheriting
 *
 * @param id Its ID
 * @return The node, without a name or parents
 */
function blankNode(id: string): Omit<AreaNode, 'name' | 'parents' | 'loopsEastWest' | 'loopsNorthSouth'>
{
	return({
		id,
		enabled: null,
		indoors: null,
		lightLevel: null,
		defaultTileId: null,
		passageOfTime: null,
		faerieMorning: null,
		fogOfWar: null
	});
}

/**
 * Whether a change can change which areas are enabled
 *
 * @param change The change
 * @return True when it can
 */
function canChangeEnabling(change: EditorChange): boolean
{
	switch (change.kind)
	{
		case 'updateRegion':
		case 'updateArea':
			return((change.update.enabled !== undefined) || (change.update.parents !== undefined));
		case 'deleteRegion':
		case 'deleteArea':
			return(true);
		default:
			return(false);
	}
}

/**
 * The region or area a change turns off, or moves under other parents
 *
 * @param change The change
 * @return It, or undefined for a change that does neither
 */
function disablingTarget(change: EditorChange): PlaceRef | undefined
{
	if ((change.kind === 'updateRegion') && ((change.update.enabled === false) || (change.update.parents !== undefined)))
	{
		return({ kind: 'region', id: change.regionId });
	}

	if ((change.kind === 'updateArea') && ((change.update.enabled === false) || (change.update.parents !== undefined)))
	{
		return({ kind: 'area', id: change.areaId });
	}

	return(undefined);
}

/**
 * The areas enabled before a save that its changes leave disabled, each with the last change that
 * disabled it, whose choice of where its characters go is the one used
 *
 * @param model The regions and areas as saved, which it changes as the changes would
 * @param changes The save's changes
 * @return The change disabling each area, by area ID
 */
export function findDisabledAreas(model: PlaceModel, changes: readonly EditorChange[]): Map<string, number>
{
	const enabledBefore = enabledAreaIds(model.graph());
	let enabled = enabledBefore;
	const disabledAt = new Map<string, number>();

	for (const [changeIndex, change] of changes.entries())
	{
		applyPlaceChange(model, change);

		if (!canChangeEnabling(change))
		{
			continue;
		}

		const graph = model.graph();
		const now = enabledAreaIds(graph);
		const target = disablingTarget(change);

		for (const area of graph.areas.values())
		{
			// An area disabled again is found at the last change disabling it
			const disabledAgain = ((target !== undefined) && (samePlace(target, { kind: 'area', id: area.id }) || graph.isBelow({ kind: 'area', id: area.id }, target)));

			if (!now.has(area.id) && (enabled.has(area.id) || disabledAgain))
			{
				disabledAt.set(area.id, changeIndex);
			}
		}

		enabled = now;
	}

	return(new Map([...disabledAt].filter(([areaId]) => (enabledBefore.has(areaId) && !enabled.has(areaId) && (model.area(areaId) !== undefined)))));
}
