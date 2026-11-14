/**
 * What a save's changes to regions and areas would do to which areas are enabled and which are below the
 * lobby region, worked out in memory without saving anything, so the editor can warn about the areas
 * they disable or put in the lobby with characters in them (see Disabling things players are using and
 * Lobby in STRUCTURE-OVERVIEW.md)
 */
import { lobbyAreaIds, type AreaNode, type EditorChange, type PlaceGraph, type PlaceKind, type PlaceNode, type PlaceRef, type PlaceSettings } from '@multiverse-kiln/shared';

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
 * Which areas are in a set as a save's changes are made, and which were in it at the last change checked
 */
class TrackedAreas
{
	private readonly current: Set<string>;
	private readonly atCheck = new Map<string, boolean>();

	/**
	 * @param areaIds The areas in the set before the changes
	 */
	constructor(areaIds: Iterable<string>)
	{
		this.current = new Set(areaIds);
	}

	/**
	 * Whether an area is in the set now
	 *
	 * @param areaId The area's ID
	 * @return True when it is
	 */
	has(areaId: string): boolean
	{
		return(this.current.has(areaId));
	}

	/**
	 * Whether an area was in the set at the last change checked
	 *
	 * @param areaId The area's ID
	 * @return True when it was
	 */
	hadAtCheck(areaId: string): boolean
	{
		return(this.atCheck.get(areaId) ?? this.current.has(areaId));
	}

	/**
	 * Puts an area in the set or takes it out
	 *
	 * @param areaId The area's ID
	 * @param inSet Whether it is in the set
	 */
	set(areaId: string, inSet: boolean): void
	{
		const was = this.current.has(areaId);

		if (was === inSet)
		{
			return;
		}

		if (!this.atCheck.has(areaId))
		{
			this.atCheck.set(areaId, was);
		}

		if (inSet)
		{
			this.current.add(areaId);
		}
		else
		{
			this.current.delete(areaId);
		}
	}

	/**
	 * The areas put in the set or taken out since the last change checked
	 *
	 * @return Their IDs
	 */
	changedSinceCheck(): string[]
	{
		return([...this.atCheck.keys()]);
	}

	/**
	 * Marks the set as it is now as checked
	 */
	check(): void
	{
		this.atCheck.clear();
	}
}

/**
 * The region or area a change makes, deletes, or gives some settings
 *
 * @param change The change
 * @param settings The settings of an update that count
 * @return It, or undefined for a change that does none of these
 */
function changedPlace(change: EditorChange, settings: readonly ('enabled' | 'parents')[]): PlaceRef | undefined
{
	switch (change.kind)
	{
		case 'createRegion':
			return({ kind: 'region', id: change.ref });
		case 'deleteRegion':
			return({ kind: 'region', id: change.regionId });
		case 'updateRegion':
			return((settings.some((setting) => (change.update[setting] !== undefined)) ? { kind: 'region', id: change.regionId } : undefined));
		case 'createArea':
			return({ kind: 'area', id: change.ref });
		case 'deleteArea':
			return({ kind: 'area', id: change.areaId });
		case 'updateArea':
			return((settings.some((setting) => (change.update[setting] !== undefined)) ? { kind: 'area', id: change.areaId } : undefined));
		default:
			return(undefined);
	}
}

/**
 * Applies one change to regions and areas to a model, as applyPlaceChange() does, finding the places
 * whose place in the graph it can change: the region or area it makes, deletes or gives some settings,
 * with everything below it. Which areas are enabled, or below the lobby region, can change only there
 *
 * @param model The regions and areas as the changes before it left them, which it changes
 * @param change The change
 * @param settings The settings of an update that count
 * @return The places, as it left them, or as they were for one it deletes, or none
 */
function applyFindingTouched(model: PlaceModel, change: EditorChange, settings: readonly ('enabled' | 'parents')[]): PlaceRef[]
{
	const graph = model.graph();
	const place = changedPlace(change, settings);

	if (!place)
	{
		applyPlaceChange(model, change);

		return([]);
	}

	if ((change.kind === 'deleteRegion') || (change.kind === 'deleteArea'))
	{
		const touched = withBelow(graph, place);

		applyPlaceChange(model, change);

		return(touched);
	}

	applyPlaceChange(model, change);

	return(withBelow(graph, place));
}

/**
 * A place with everything below it, as PlaceGraph.descendantsOf() finds them
 *
 * @param graph The regions and areas
 * @param place The place
 * @return The place, then everything below it, nearest first
 */
function withBelow(graph: PlaceGraph, place: PlaceRef): PlaceRef[]
{
	const visited: Record<PlaceKind, Set<string>> = {
		region: new Set(),
		area: new Set()
	};
	const found = [place];

	visited[place.kind].add(place.id);

	for (let index = 0; index < found.length; index++)
	{
		for (const child of graph.childrenOf(found[index]))
		{
			if (!visited[child.kind].has(child.id))
			{
				visited[child.kind].add(child.id);
				found.push(child);
			}
		}
	}

	return(found);
}

/**
 * Which areas of some places are, or are below, a place passing a test, along any path
 *
 * @param graph The regions and areas
 * @param places The places, which include everything below each of them
 * @param test The test
 * @return The areas' IDs
 */
function areasReachedFrom(graph: PlaceGraph, places: readonly PlaceRef[], test: (place: PlaceRef) => boolean): Set<string>
{
	const within: Record<PlaceKind, Set<string>> = {
		region: new Set(),
		area: new Set()
	};
	const reached: Record<PlaceKind, Set<string>> = {
		region: new Set(),
		area: new Set()
	};
	const outside: Record<PlaceKind, Map<string, boolean>> = {
		region: new Map(),
		area: new Map()
	};
	const queue: PlaceRef[] = [];
	const reachedOutside = (parent: PlaceRef): boolean =>
	{
		let known = outside[parent.kind].get(parent.id);

		if (known === undefined)
		{
			known = (test(parent) || graph.ancestorsOf(parent).some(test));
			outside[parent.kind].set(parent.id, known);
		}

		return(known);
	};
	const reach = (place: PlaceRef): void =>
	{
		reached[place.kind].add(place.id);
		queue.push(place);
	};

	for (const place of places)
	{
		within[place.kind].add(place.id);
	}

	for (const place of places)
	{
		const node = graph.node(place);

		if (node && !reached[place.kind].has(place.id) && (test(place) || node.parents.some((parent) => (!within[parent.kind].has(parent.id) && (graph.node(parent) !== undefined) && reachedOutside(parent)))))
		{
			reach(place);
		}
	}

	for (let index = 0; index < queue.length; index++)
	{
		for (const child of graph.childrenOf(queue[index]))
		{
			if (within[child.kind].has(child.id) && !reached[child.kind].has(child.id))
			{
				reach(child);
			}
		}
	}

	return(reached.area);
}

/**
 * Notes the change at which each of some areas is found. The areas keep the order each was first found
 * in, and those first found at the same change take the order given
 *
 * @param found The change each area was last found at, by area ID, which it adds to
 * @param areaIds The areas found at this change
 * @param changeIndex The change
 * @param order Every area found at this change and more, in the order to note them
 */
function noteFound(found: Map<string, number>, areaIds: readonly string[], changeIndex: number, order: () => Iterable<string>): void
{
	const fresh = new Set(areaIds.filter((areaId) => !found.has(areaId)));

	for (const areaId of areaIds)
	{
		if (!fresh.has(areaId))
		{
			found.set(areaId, changeIndex);
		}
	}

	const inOrder = ((fresh.size < 2) ? [...fresh] : [...order()].filter((areaId) => fresh.has(areaId)));

	for (const areaId of inOrder)
	{
		found.set(areaId, changeIndex);
	}
}

/**
 * The areas enabled before a save that its changes leave disabled, each with the last change that
 * disabled it, whose choice of where its characters go is the one used. Each change looks again only at
 * the places it touches (applyFindingTouched())
 *
 * @param model The regions and areas as saved, which it changes as the changes would
 * @param changes The save's changes
 * @return The change disabling each area, by area ID, in the order they were first disabled
 */
export function findDisabledAreas(model: PlaceModel, changes: readonly EditorChange[]): Map<string, number>
{
	const graph = model.graph();
	const enabledBefore = enabledAreaIds(graph);
	const enabled = new TrackedAreas(enabledBefore);
	const disabledAt = new Map<string, number>();
	const isOff = (place: PlaceRef): boolean => (graph.node(place)?.enabled === false);

	for (const [changeIndex, change] of changes.entries())
	{
		const touched = applyFindingTouched(model, change, ['enabled', 'parents']);
		const disabled = areasReachedFrom(graph, touched, isOff);

		for (const place of touched)
		{
			if (place.kind === 'area')
			{
				enabled.set(place.id, (graph.areas.has(place.id) && !disabled.has(place.id)));
			}
		}

		if (!canChangeEnabling(change))
		{
			continue;
		}

		// An area disabled again is found at the last change disabling it: the target and what is below it
		const target = disablingTarget(change);
		const disabledAgain = new Set<string>();

		if ((target !== undefined) && (graph.node(target) !== undefined))
		{
			for (const place of touched)
			{
				if (place.kind === 'area')
				{
					disabledAgain.add(place.id);
				}
			}
		}

		const found = [...disabledAgain].filter((areaId) => !enabled.has(areaId));

		for (const areaId of enabled.changedSinceCheck())
		{
			if (!disabledAgain.has(areaId) && graph.areas.has(areaId) && !enabled.has(areaId) && enabled.hadAtCheck(areaId))
			{
				found.push(areaId);
			}
		}

		noteFound(disabledAt, found, changeIndex, () => graph.areas.keys());
		enabled.check();
	}

	return(new Map([...disabledAt].filter(([areaId]) => (enabledBefore.has(areaId) && !enabled.hadAtCheck(areaId) && (model.area(areaId) !== undefined)))));
}

/**
 * Whether a change can change which areas are below the lobby region
 *
 * @param change The change
 * @return True when it can
 */
function canChangeLobby(change: EditorChange): boolean
{
	switch (change.kind)
	{
		case 'updateRegion':
		case 'updateArea':
			return(change.update.parents !== undefined);
		case 'createArea':
		case 'deleteRegion':
		case 'deleteArea':
			return(true);
		case 'universe':
			return(change.update.lobbyRegionId !== undefined);
		default:
			return(false);
	}
}

/**
 * The areas outside the lobby region before a save that its changes put below it, each with the last
 * change that put it there. Their group characters go back to where their groups start
 *
 * @param model The regions and areas as saved, with the lobby region, which it changes as the changes would
 * @param changes The save's changes
 * @return The change putting each area below the lobby region, by area ID, in the order they were first
 * put there
 */
export function findLobbyEntries(model: PlaceModel, changes: readonly EditorChange[]): Map<string, number>
{
	const graph = model.graph();
	const lobbyBefore = lobbyAreaIds(graph, model.lobbyRegion());
	let inLobby = new TrackedAreas(lobbyBefore);
	const enteredAt = new Map<string, number>();
	const isLobby = (place: PlaceRef): boolean => ((place.kind === 'region') && (place.id === model.lobbyRegion()));

	for (const [changeIndex, change] of changes.entries())
	{
		if ((change.kind === 'universe') && (change.update.lobbyRegionId !== undefined) && (change.update.lobbyRegionId !== model.lobbyRegion()))
		{
			model.setLobbyRegion(change.update.lobbyRegionId);

			const now = lobbyAreaIds(graph, model.lobbyRegion());

			noteFound(enteredAt, [...now].filter((areaId) => !inLobby.hadAtCheck(areaId)), changeIndex, () => now);
			inLobby = new TrackedAreas(now);
			continue;
		}

		const touched = applyFindingTouched(model, change, ['parents']);
		const below = areasReachedFrom(graph, touched, isLobby);

		for (const place of touched)
		{
			if (place.kind === 'area')
			{
				inLobby.set(place.id, (graph.areas.has(place.id) && below.has(place.id)));
			}
		}

		if (!canChangeLobby(change))
		{
			continue;
		}

		const found = inLobby.changedSinceCheck().filter((areaId) => (inLobby.has(areaId) && !inLobby.hadAtCheck(areaId)));

		noteFound(enteredAt, found, changeIndex, () => lobbyAreaIds(graph, model.lobbyRegion()));
		inLobby.check();
	}

	return(new Map([...enteredAt].filter(([areaId]) => (!lobbyBefore.has(areaId) && inLobby.hadAtCheck(areaId) && (model.area(areaId) !== undefined)))));
}
