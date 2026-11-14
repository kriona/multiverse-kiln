/**
 * Regions and areas: how they nest, and the settings each area works out from its own and from what is
 * above it (see Regions in STRUCTURE-OVERVIEW.md)
 *
 * Regions group areas without cells of their own. A region's parents are regions; an area's are regions
 * and at most one area. Every area is in at least one region, directly or through the area it is inside,
 * nothing is ever inside itself, and nothing nests more than MAX_PLACE_DEPTH levels deep along its longest
 * path. The editor and every save that changes them run the same functions, so nothing is ever saved with
 * a conflict or a missing value
 */
import type { AreaLightLevel, FaerieMorning, PassageOfTime } from './universes.js';

/**
 * Most characters in a region's name
 */
export const MAX_REGION_NAME_LENGTH = 60;

/**
 * How many levels regions and areas nest at most along their longest path, a top-level region being the first
 */
export const MAX_PLACE_DEPTH = 10;

/**
 * Most parents one region or area can have
 */
export const MAX_PLACE_PARENTS = 50;

/**
 * Most builders one region can have assigned
 */
export const MAX_REGION_BUILDERS = 100;

export type PlaceKind = 'region' | 'area';

/**
 * A region or an area, by its ID
 */
export interface PlaceRef
{
	kind: PlaceKind;
	id: string;
}

/**
 * The settings regions and areas share, each null for inherit
 */
export interface PlaceSettings
{
	/**
	 * false disables the place and everything below it; true sets nothing, working as inherit does
	 */
	enabled: boolean | null;

	indoors: boolean | null;

	/**
	 * How light an indoor area is; kept while the place is outdoors, where it has no effect
	 */
	lightLevel: AreaLightLevel | null;

	defaultTileId: number | null;
	passageOfTime: PassageOfTime | null;

	/**
	 * Set exactly when passageOfTime is faerie
	 */
	faerieMorning: FaerieMorning | null;

	/**
	 * Whether what is out of the players' sight is hidden from them; without it they see everything near
	 * them and everyone in the area, and nothing is recorded as explored
	 */
	fogOfWar: boolean | null;
}

/**
 * Every setting inherit leaves to what is above, besides enabled, which works as a gate instead
 */
export const INHERITED_SETTINGS = ['indoors', 'lightLevel', 'defaultTileId', 'passageOfTime', 'fogOfWar'] as const;

export type InheritedSetting = typeof INHERITED_SETTINGS[number];

/**
 * A passage of time with where morning is, for faerie
 */
export interface PassageSetting
{
	passageOfTime: PassageOfTime;
	faerieMorning: FaerieMorning | null;
}

/**
 * The value of each inherited setting
 */
export interface InheritedValues
{
	indoors: boolean;
	lightLevel: AreaLightLevel;
	defaultTileId: number;
	passageOfTime: PassageSetting;
	fogOfWar: boolean;
}

/**
 * How one setting of a place was worked out
 *
 * - own: the place sets it itself
 * - inherited: the places at the nearest level above that set it, all to the same value
 * - conflict: places at the nearest level above that set it give different values, in the order found
 * - missing: nothing above sets it
 * - ignored: it means nothing here: the light level of an outdoor place, and the passage of time of the
 *   lobby region and everything below it, whose areas take the Lobby tab's
 */
export type SettingResolution<T> =
	| { kind: 'own'; value: T }
	| { kind: 'inherited'; value: T; from: PlaceRef[] }
	| { kind: 'conflict'; values: { place: PlaceRef; value: T }[] }
	| { kind: 'missing' }
	| { kind: 'ignored' };

/**
 * Whether a place is enabled: only while it and everything above it are, along every path
 */
export interface EnabledResolution
{
	enabled: boolean;

	/**
	 * The places that are off, the place itself first when it is, then those above it, nearest first
	 */
	disabledBy: PlaceRef[];
}

/**
 * Every setting of a place, worked out, and whether it is the lobby region or below it
 */
export type PlaceResolution = { enabled: EnabledResolution; lobby: boolean } & { [Setting in InheritedSetting]: SettingResolution<InheritedValues[Setting]> };

/**
 * An area's settings as worked out and stored on it, which the rooms and the game read
 */
export interface ResolvedAreaSettings
{
	enabled: boolean;
	indoors: boolean;

	/**
	 * null exactly when the area is outdoors
	 */
	lightLevel: AreaLightLevel | null;

	defaultTileId: number;

	/**
	 * null exactly for a lobby area, whose passage of time is the Lobby tab's
	 */
	passageOfTime: PassageOfTime | null;

	/**
	 * Set exactly when passageOfTime is faerie
	 */
	faerieMorning: FaerieMorning | null;

	fogOfWar: boolean;

	/**
	 * Whether the area is below the lobby region, at any depth: a lobby area, walked in the lobby and never
	 * connected to the rest of the world
	 */
	lobby: boolean;
}

/**
 * A region or area with its own settings and its parents, in the order they were added. A region's
 * parents are regions; an area's are regions and at most one area
 */
export interface PlaceNode extends PlaceSettings
{
	id: string;
	name: string;
	parents: readonly PlaceRef[];
}

/**
 * An area, which also has whether it loops
 */
export interface AreaNode extends PlaceNode
{
	loopsEastWest: boolean;
	loopsNorthSouth: boolean;
}

/**
 * Which kinds of area a tile is for
 */
export interface TileUsedFor
{
	indoors: boolean;
	outdoors: boolean;
}

/**
 * Everything working out areas' settings reads: a version's regions and areas, the kinds of the tiles
 * they can use, and its lobby region
 */
export interface PlaceWorld
{
	regions: readonly PlaceNode[];
	areas: readonly AreaNode[];

	/**
	 * The tiles the version can use, by ID. A default tile not listed is passed over, as one not for the
	 * area's kind is
	 */
	tileKinds: ReadonlyMap<number, TileUsedFor>;

	/**
	 * The region whose areas players walk in the lobby, whose passage of time is the Lobby tab's
	 */
	lobbyRegionId: string | null;
}

/**
 * Something that keeps an area's settings from being worked out, a region or area nested wrongly, or a
 * lobby area connected to the rest of the world
 *
 * - conflict: places at one level above it set a setting to different values
 * - missing: nothing it is inside sets a setting
 * - faerieLoops: its passage of time is faerie, and it loops
 * - noRegion: it is in no region, directly or through the area it is inside
 * - insideItself: the place is inside itself, however far down
 * - tooDeep: the place is nested more than MAX_PLACE_DEPTH levels deep
 * - lobbyLink: a link on the area leads across the lobby region's edge, into or out of the lobby
 * - lobbyStartingArea: characters start in the area (the universe's, a race's or a class's starting
 *   area), and it is a lobby area
 * - lobbySquareOutside: the lobby's starting square is in the area, which isn't a lobby area
 * - lobbyFaerieLoops: the area is a lobby area and loops, while the lobby's passage of time is faerie
 */
export type PlaceProblem =
	| { kind: 'conflict'; areaId: string; setting: InheritedSetting; values: { place: PlaceRef; value: InheritedValues[InheritedSetting] }[] }
	| { kind: 'missing'; areaId: string; setting: InheritedSetting }
	| { kind: 'faerieLoops'; areaId: string }
	| { kind: 'noRegion'; areaId: string }
	| { kind: 'insideItself'; place: PlaceRef }
	| { kind: 'tooDeep'; place: PlaceRef }
	| { kind: 'lobbyLink'; areaId: string; targetAreaId: string }
	| { kind: 'lobbyStartingArea'; areaId: string }
	| { kind: 'lobbySquareOutside'; areaId: string }
	| { kind: 'lobbyFaerieLoops'; areaId: string };

/**
 * A link between two areas, as far as the lobby region's edge goes: the area it is on and the area it
 * leads to
 */
export interface AreaLinkPair
{
	areaId: string;
	targetAreaId: string;
}

/**
 * The lobby's settings as far as its edge goes
 */
export interface LobbyEdge
{
	lobbyRegionId: string | null;

	/**
	 * The area of the lobby's starting square, which must be a lobby area
	 */
	lobbyAreaId: string | null;

	/**
	 * Whether the lobby's passage of time is faerie, which the lobby areas can't loop with
	 */
	faerie: boolean;
}

/**
 * The text form of a place, for sets and maps
 *
 * @param place The place
 * @return Its key
 */
export function placeKey(place: PlaceRef): string
{
	return(`${place.kind}:${place.id}`);
}

/**
 * Whether two places are the same
 *
 * @param first One place
 * @param second The other
 * @return True when they are
 */
export function samePlace(first: PlaceRef, second: PlaceRef): boolean
{
	return((first.kind === second.kind) && (first.id === second.id));
}

/**
 * A version's regions and areas, indexed for following parents up and children down
 */
export class PlaceGraph
{
	readonly regions: ReadonlyMap<string, PlaceNode>;
	readonly areas: ReadonlyMap<string, AreaNode>;
	private readonly children = new Map<string, PlaceRef[]>();

	/**
	 * @param regions The regions
	 * @param areas The areas
	 */
	constructor(regions: readonly PlaceNode[], areas: readonly AreaNode[])
	{
		this.regions = new Map(regions.map((region) => [region.id, region]));
		this.areas = new Map(areas.map((area) => [area.id, area]));

		for (const [kind, nodes] of [['region', regions], ['area', areas]] as const)
		{
			for (const node of nodes)
			{
				for (const parent of node.parents)
				{
					const key = placeKey(parent);
					const list = (this.children.get(key) ?? []);

					list.push({ kind, id: node.id });
					this.children.set(key, list);
				}
			}
		}
	}

	/**
	 * A region or area
	 *
	 * @param place The place
	 * @return It, or undefined when there is no such place
	 */
	node(place: PlaceRef): PlaceNode | undefined
	{
		return(((place.kind === 'region') ? this.regions.get(place.id) : this.areas.get(place.id)));
	}

	/**
	 * The parents of a place that exist, in the order they were added
	 *
	 * @param place The place
	 * @return Its parents
	 */
	parentsOf(place: PlaceRef): PlaceRef[]
	{
		return((this.node(place)?.parents ?? []).filter((parent) => (this.node(parent) !== undefined)));
	}

	/**
	 * The regions and areas directly inside a place
	 *
	 * @param place The place
	 * @return Its children, regions in the order given then areas
	 */
	childrenOf(place: PlaceRef): PlaceRef[]
	{
		return(this.children.get(placeKey(place)) ?? []);
	}

	/**
	 * Everything above a place, a level at a time, each counted once at the nearest level it is reached
	 *
	 * @param place The place
	 * @return The levels, its parents first
	 */
	levelsAbove(place: PlaceRef): PlaceRef[][]
	{
		const visited = new Set<string>([placeKey(place)]);
		const levels: PlaceRef[][] = [];
		let level = this.unvisited(this.parentsOf(place), visited);

		while (level.length > 0)
		{
			levels.push(level);
			level = this.unvisited(level.flatMap((each) => this.parentsOf(each)), visited);
		}

		return(levels);
	}

	/**
	 * Everything above a place, nearest first
	 *
	 * @param place The place
	 * @return The places
	 */
	ancestorsOf(place: PlaceRef): PlaceRef[]
	{
		return(this.levelsAbove(place).flat());
	}

	/**
	 * Everything below a place, however deep
	 *
	 * @param place The place
	 * @return The places, nearest first, not including the place itself
	 */
	descendantsOf(place: PlaceRef): PlaceRef[]
	{
		const visited = new Set<string>([placeKey(place)]);
		const found: PlaceRef[] = [];
		let level = this.unvisited(this.childrenOf(place), visited);

		while (level.length > 0)
		{
			found.push(...level);
			level = this.unvisited(level.flatMap((each) => this.childrenOf(each)), visited);
		}

		return(found);
	}

	/**
	 * Whether a place is below another, however deep
	 *
	 * @param place The place
	 * @param above The other place
	 * @return True when it is
	 */
	isBelow(place: PlaceRef, above: PlaceRef): boolean
	{
		const key = placeKey(above);

		return(this.ancestorsOf(place).some((ancestor) => (placeKey(ancestor) === key)));
	}

	/**
	 * Whether a place is inside itself, however far down
	 *
	 * @param place The place
	 * @return True when following its parents up reaches it again
	 */
	isInsideItself(place: PlaceRef): boolean
	{
		const key = placeKey(place);
		const visited = new Set<string>();
		let level = this.unvisited(this.parentsOf(place), visited);

		while (level.length > 0)
		{
			if (level.some((each) => (placeKey(each) === key)))
			{
				return(true);
			}

			level = this.unvisited(level.flatMap((each) => this.parentsOf(each)), visited);
		}

		return(false);
	}

	/**
	 * How deep each place is nested along its longest path, a place with no parents being 1. A place
	 * inside itself counts the path up to where it meets itself
	 *
	 * @return Each place's depth, by placeKey()
	 */
	depths(): Map<string, number>
	{
		const depths = new Map<string, number>();
		const visiting = new Set<string>();
		const depthOf = (place: PlaceRef): number =>
		{
			const key = placeKey(place);
			const known = depths.get(key);

			if (known !== undefined)
			{
				return(known);
			}

			if (visiting.has(key))
			{
				return(0);
			}

			visiting.add(key);

			const depth = (1 + Math.max(0, ...this.parentsOf(place).map(depthOf)));

			visiting.delete(key);
			depths.set(key, depth);

			return(depth);
		};

		for (const place of this.places())
		{
			depthOf(place);
		}

		return(depths);
	}

	/**
	 * How many levels lie below a place along its longest path down, 0 for a place with nothing in it
	 *
	 * @param place The place
	 * @return The height
	 */
	heightOf(place: PlaceRef): number
	{
		const heights = new Map<string, number>();
		const visiting = new Set<string>();
		const heightOf = (current: PlaceRef): number =>
		{
			const key = placeKey(current);
			const known = heights.get(key);

			if (known !== undefined)
			{
				return(known);
			}

			if (visiting.has(key))
			{
				return(0);
			}

			visiting.add(key);

			const children = this.childrenOf(current);
			const height = ((children.length === 0) ? 0 : (1 + Math.max(...children.map(heightOf))));

			visiting.delete(key);
			heights.set(key, height);

			return(height);
		};

		return(heightOf(place));
	}

	/**
	 * Every region and area
	 *
	 * @return The places, regions first
	 */
	places(): PlaceRef[]
	{
		return([
			...[...this.regions.keys()].map((id): PlaceRef => ({ kind: 'region', id })),
			...[...this.areas.keys()].map((id): PlaceRef => ({ kind: 'area', id }))
		]);
	}

	/**
	 * The places of a list not yet visited, each once, marking them visited
	 *
	 * @param places The places
	 * @param visited The keys of the places visited, which it adds to
	 * @return The places, in the order given
	 */
	private unvisited(places: readonly PlaceRef[], visited: Set<string>): PlaceRef[]
	{
		const found: PlaceRef[] = [];

		for (const place of places)
		{
			const key = placeKey(place);

			if (!visited.has(key))
			{
				visited.add(key);
				found.push(place);
			}
		}

		return(found);
	}
}

/**
 * Whether a tile can be a place's default tile
 *
 * @param tileKinds The tiles, by ID
 * @param tileId The tile
 * @param indoors Whether the place is indoors, or undefined when its kind isn't known, when any tile the
 * version can use will do
 * @return True when it can
 */
export function suitsKind(tileKinds: ReadonlyMap<number, TileUsedFor>, tileId: number, indoors: boolean | undefined): boolean
{
	const kind = tileKinds.get(tileId);

	if (!kind)
	{
		return(false);
	}

	return(((indoors === undefined) ? true : (indoors ? kind.indoors : kind.outdoors)));
}

/**
 * Works out every setting of a region or area from its own and what is above it
 *
 * @param graph The version's regions and areas
 * @param place The place
 * @param tileKinds The tiles the version can use, by ID
 * @param lobbyRegionId The lobby region, below which the passage of time is ignored
 * @return Each setting
 */
export function resolvePlace(graph: PlaceGraph, place: PlaceRef, tileKinds: ReadonlyMap<number, TileUsedFor>, lobbyRegionId: string | null): PlaceResolution
{
	const node = graph.node(place);

	if (!node)
	{
		throw new Error(`No ${place.kind} ${place.id}`);
	}

	const levels = graph.levelsAbove(place);
	const disabledBy = [place, ...levels.flat()].filter((each) => (graph.node(each)?.enabled === false));
	const indoors = resolveSetting(graph, node, levels, (each) => each.indoors, (first, second) => (first === second));
	const kind = (((indoors.kind === 'own') || (indoors.kind === 'inherited')) ? indoors.value : undefined);
	const tileOf = (each: PlaceSettings): number | null => ((each.defaultTileId !== null) && suitsKind(tileKinds, each.defaultTileId, kind) ? each.defaultTileId : null);
	const passageOf = (each: PlaceSettings): PassageSetting | null => ((each.passageOfTime === null)
		? null
		: {
			passageOfTime: each.passageOfTime,
			faerieMorning: each.faerieMorning
		});
	const lobby = ((lobbyRegionId !== null) && levelsInclude(place, levels, { kind: 'region', id: lobbyRegionId }));

	return({
		enabled: {
			enabled: (disabledBy.length === 0),
			disabledBy
		},
		lobby,
		indoors,
		lightLevel: ((kind === false)
			? { kind: 'ignored' }
			: resolveSetting(graph, node, levels, (each) => each.lightLevel, (first, second) => (first === second))),
		defaultTileId: resolveSetting(graph, node, levels, tileOf, (first, second) => (first === second)),
		passageOfTime: (lobby
			? { kind: 'ignored' }
			: resolveSetting(graph, node, levels, passageOf, samePassage)),
		fogOfWar: resolveSetting(graph, node, levels, (each) => each.fogOfWar, (first, second) => (first === second))
	});
}

/**
 * Whether a place is another, or is below it
 *
 * @param place The place
 * @param levels Everything above it (PlaceGraph.levelsAbove())
 * @param other The other place
 * @return True when it is
 */
function levelsInclude(place: PlaceRef, levels: readonly PlaceRef[][], other: PlaceRef): boolean
{
	return(samePlace(place, other) || levels.some((level) => level.some((each) => samePlace(each, other))));
}

/**
 * Whether a place is the lobby region or below it, at any depth. An area that is is a lobby area
 *
 * @param graph The version's regions and areas
 * @param place The place
 * @param lobbyRegionId The lobby region, or null when the universe has none
 * @return True when it is
 */
export function isInLobby(graph: PlaceGraph, place: PlaceRef, lobbyRegionId: string | null): boolean
{
	if (lobbyRegionId === null)
	{
		return(false);
	}

	const lobbyRegion: PlaceRef = { kind: 'region', id: lobbyRegionId };

	return(samePlace(place, lobbyRegion) || graph.isBelow(place, lobbyRegion));
}

/**
 * The lobby areas: every area below the lobby region, at any depth
 *
 * @param graph The version's regions and areas
 * @param lobbyRegionId The lobby region, or null when the universe has none
 * @return Their IDs
 */
export function lobbyAreaIds(graph: PlaceGraph, lobbyRegionId: string | null): Set<string>
{
	if ((lobbyRegionId === null) || !graph.regions.has(lobbyRegionId))
	{
		return(new Set());
	}

	return(new Set(graph.descendantsOf({ kind: 'region', id: lobbyRegionId })
		.filter((place) => (place.kind === 'area'))
		.map((place) => place.id)));
}

/**
 * What connects the lobby areas to the rest of the world, or keeps the lobby from working: links across
 * the lobby region's edge either way, starting areas below it, a starting square outside it, and lobby
 * areas that loop while the lobby's passage of time is faerie. The server refuses every save leaving any,
 * and the editor offers nothing that would make one
 *
 * @param graph The version's regions and areas
 * @param lobby The lobby region, its starting square's area and whether its time is faerie
 * @param links The links between areas; those with neither end a lobby area may be left out
 * @param startingAreaIds Every starting area: the universe's, its races' and its classes'
 * @return The problems: links in the order given, then starting areas, the starting square and looping areas
 */
export function lobbyProblems(graph: PlaceGraph, lobby: LobbyEdge, links: readonly AreaLinkPair[], startingAreaIds: readonly string[]): PlaceProblem[]
{
	const inLobby = lobbyAreaIds(graph, lobby.lobbyRegionId);
	const problems: PlaceProblem[] = [];
	const found = new Set<string>();

	for (const { areaId, targetAreaId } of links)
	{
		const key = `${areaId}>${targetAreaId}`;

		if (!found.has(key) && graph.areas.has(areaId) && graph.areas.has(targetAreaId) && (inLobby.has(areaId) !== inLobby.has(targetAreaId)))
		{
			found.add(key);
			problems.push({ kind: 'lobbyLink', areaId, targetAreaId });
		}
	}

	for (const areaId of new Set(startingAreaIds))
	{
		if (inLobby.has(areaId))
		{
			problems.push({ kind: 'lobbyStartingArea', areaId });
		}
	}

	if ((lobby.lobbyAreaId !== null) && graph.areas.has(lobby.lobbyAreaId) && !inLobby.has(lobby.lobbyAreaId))
	{
		problems.push({ kind: 'lobbySquareOutside', areaId: lobby.lobbyAreaId });
	}

	if (lobby.faerie)
	{
		for (const areaId of inLobby)
		{
			const area = graph.areas.get(areaId);

			if (area && (area.loopsEastWest || area.loopsNorthSouth))
			{
				problems.push({ kind: 'lobbyFaerieLoops', areaId });
			}
		}
	}

	return(problems);
}

/**
 * What giving a region or area other parents would carry across the lobby region's edge: the links that
 * would cross it and the starting areas that would be below it, that don't already. The editor offers no
 * parent that does either
 *
 * @param world The version's regions and areas, and its lobby region
 * @param place The region or area that would move
 * @param parents The parents it would have
 * @param links The links between areas
 * @param startingAreaIds Every starting area: the universe's, its races' and its classes'
 * @return The lobbyLink and lobbyStartingArea problems the move would make
 */
export function lobbyProblemsOfMove(world: PlaceWorld, place: PlaceRef, parents: readonly PlaceRef[], links: readonly AreaLinkPair[], startingAreaIds: readonly string[]): PlaceProblem[]
{
	if (world.lobbyRegionId === null)
	{
		return([]);
	}

	const lobby: LobbyEdge = {
		lobbyRegionId: world.lobbyRegionId,
		lobbyAreaId: null,
		faerie: false
	};
	const keyOf = (problem: PlaceProblem): string => JSON.stringify(problem);
	const before = new Set(lobbyProblems(new PlaceGraph(world.regions, world.areas), lobby, links, startingAreaIds).map(keyOf));
	const moved = new PlaceGraph(
		world.regions.map((region) => (((place.kind === 'region') && (region.id === place.id)) ? { ...region, parents } : region)),
		world.areas.map((area) => (((place.kind === 'area') && (area.id === place.id)) ? { ...area, parents } : area))
	);

	return(lobbyProblems(moved, lobby, links, startingAreaIds).filter((problem) => !before.has(keyOf(problem))));
}

/**
 * Whether two passages of time are the same, faerie mornings included
 *
 * @param first One passage of time
 * @param second The other
 * @return True when they are
 */
export function samePassage(first: PassageSetting, second: PassageSetting): boolean
{
	return((first.passageOfTime === second.passageOfTime) && (first.faerieMorning === second.faerieMorning));
}

/**
 * Works out one setting of a place: its own, unless it inherits, and then the values set at the nearest
 * level above that sets any
 *
 * @param graph The version's regions and areas
 * @param node The place
 * @param levels Everything above it, a level at a time (PlaceGraph.levelsAbove())
 * @param valueOf A place's own value for the setting, or null when it inherits or its value is passed over
 * @param same Whether two values are the same
 * @return The setting
 */
function resolveSetting<T>(graph: PlaceGraph, node: PlaceSettings, levels: readonly PlaceRef[][], valueOf: (settings: PlaceSettings) => T | null, same: (first: T, second: T) => boolean): SettingResolution<T>
{
	const own = valueOf(node);

	if (own !== null)
	{
		return({ kind: 'own', value: own });
	}

	for (const level of levels)
	{
		const values: { place: PlaceRef; value: T }[] = [];

		for (const place of level)
		{
			const settings = graph.node(place);
			const value = ((settings === undefined) ? null : valueOf(settings));

			if (value !== null)
			{
				values.push({ place, value });
			}
		}

		if (values.length > 0)
		{
			const first = values[0].value;

			if (values.every(({ value }) => same(value, first)))
			{
				return({ kind: 'inherited', value: first, from: values.map(({ place }) => place) });
			}

			return({ kind: 'conflict', values });
		}
	}

	return({ kind: 'missing' });
}

/**
 * A setting's value, when it was worked out
 *
 * @param resolution How it was worked out
 * @return The value, or undefined for a conflict, a missing value or a setting ignored
 */
export function resolvedValue<T>(resolution: SettingResolution<T>): T | undefined
{
	return((((resolution.kind === 'own') || (resolution.kind === 'inherited')) ? resolution.value : undefined));
}

/**
 * What keeps one area's settings from being worked out
 *
 * @param area The area
 * @param resolution Its settings, worked out
 * @return The conflicts and missing values, in the order of INHERITED_SETTINGS, then faerie time on an
 * area that loops
 */
export function areaSettingProblems(area: AreaNode, resolution: PlaceResolution): PlaceProblem[]
{
	const problems: PlaceProblem[] = [];
	const kindKnown = (resolvedValue(resolution.indoors) !== undefined);

	for (const setting of INHERITED_SETTINGS)
	{
		const found = resolution[setting];

		// Whether an area needs a light level waits on whether it is indoors
		if ((setting === 'lightLevel') && !kindKnown)
		{
			continue;
		}

		if (found.kind === 'conflict')
		{
			problems.push({
				kind: 'conflict',
				areaId: area.id,
				setting,
				values: found.values
			});
		}
		else if (found.kind === 'missing')
		{
			problems.push({
				kind: 'missing',
				areaId: area.id,
				setting
			});
		}
	}

	if ((resolvedValue(resolution.passageOfTime)?.passageOfTime === 'faerie') && (area.loopsEastWest || area.loopsNorthSouth))
	{
		problems.push({
			kind: 'faerieLoops',
			areaId: area.id
		});
	}

	return(problems);
}

/**
 * An area's stored settings from how they were worked out
 *
 * @param resolution Its settings, worked out
 * @return The settings, or undefined while any has a conflict or a missing value
 */
export function storedAreaSettings(resolution: PlaceResolution): ResolvedAreaSettings | undefined
{
	const indoors = resolvedValue(resolution.indoors);
	const lightLevel = resolvedValue(resolution.lightLevel);
	const defaultTileId = resolvedValue(resolution.defaultTileId);
	const passage = resolvedValue(resolution.passageOfTime);
	const fogOfWar = resolvedValue(resolution.fogOfWar);

	if ((indoors === undefined) || (defaultTileId === undefined) || (fogOfWar === undefined) || (indoors && (lightLevel === undefined)) || ((passage === undefined) && !resolution.lobby))
	{
		return(undefined);
	}

	return({
		enabled: resolution.enabled.enabled,
		indoors,
		lightLevel: (indoors ? (lightLevel ?? null) : null),
		defaultTileId,
		passageOfTime: (resolution.lobby ? null : (passage?.passageOfTime ?? null)),
		faerieMorning: (resolution.lobby ? null : (passage?.faerieMorning ?? null)),
		fogOfWar,
		lobby: resolution.lobby
	});
}

/**
 * The regions and areas nested wrongly: inside themselves, more than MAX_PLACE_DEPTH levels deep, or
 * areas in no region
 *
 * @param graph The version's regions and areas
 * @return The problems: places inside themselves, then each place one level past the deepest allowed,
 * then areas in no region
 */
export function nestingProblems(graph: PlaceGraph): PlaceProblem[]
{
	const problems: PlaceProblem[] = [];
	const places = graph.places();

	for (const place of places)
	{
		if (graph.isInsideItself(place))
		{
			problems.push({ kind: 'insideItself', place });
		}
	}

	const depths = graph.depths();

	for (const place of places)
	{
		if (depths.get(placeKey(place)) === (MAX_PLACE_DEPTH + 1))
		{
			problems.push({ kind: 'tooDeep', place });
		}
	}

	for (const area of graph.areas.values())
	{
		if (!isInRegion(graph, area.id))
		{
			problems.push({ kind: 'noRegion', areaId: area.id });
		}
	}

	return(problems);
}

/**
 * Whether an area is in a region, directly or through the areas it is inside
 *
 * @param graph The version's regions and areas
 * @param areaId The area
 * @return True when it is
 */
export function isInRegion(graph: PlaceGraph, areaId: string): boolean
{
	return(graph.ancestorsOf({ kind: 'area', id: areaId }).some((place) => (place.kind === 'region')));
}

/**
 * Every area's settings worked out, and what keeps any from being saved besides the lobby's edge
 * (lobbyProblems())
 */
export interface WorldResolution
{
	graph: PlaceGraph;

	/**
	 * Each area's settings, by area ID
	 */
	areas: Map<string, PlaceResolution>;

	/**
	 * The settings to store on each area, by area ID, for the areas without a problem
	 */
	stored: Map<string, ResolvedAreaSettings>;

	/**
	 * Everything that keeps the version from being saved: nesting problems first, then each area's in
	 * the order the areas were given
	 */
	problems: PlaceProblem[];
}

/**
 * Works out the settings of every area of a version, and finds what keeps any from being saved
 *
 * @param world The version's regions, areas, tiles and lobby
 * @return The settings and the problems
 */
export function resolveAreaSettings(world: PlaceWorld): WorldResolution
{
	const graph = new PlaceGraph(world.regions, world.areas);
	const problems = nestingProblems(graph);
	const areas = new Map<string, PlaceResolution>();
	const stored = new Map<string, ResolvedAreaSettings>();

	for (const area of world.areas)
	{
		const resolution = resolvePlace(graph, { kind: 'area', id: area.id }, world.tileKinds, world.lobbyRegionId);
		const settings = storedAreaSettings(resolution);
		const found = areaSettingProblems(area, resolution);

		areas.set(area.id, resolution);
		problems.push(...found);

		if ((settings !== undefined) && (found.length === 0))
		{
			stored.set(area.id, settings);
		}
	}

	return({ graph, areas, stored, problems });
}

/**
 * Whether a place could take a parent without being inside itself or nesting anything more than
 * MAX_PLACE_DEPTH levels deep. The editor offers only such parents
 *
 * @param graph The version's regions and areas
 * @param place The place
 * @param parent The parent it would take
 * @return True when it could
 */
export function canTakeParent(graph: PlaceGraph, place: PlaceRef, parent: PlaceRef): boolean
{
	if (samePlace(place, parent) || graph.isBelow(parent, place) || !graph.node(parent))
	{
		return(false);
	}

	if ((place.kind === 'region') && (parent.kind === 'area'))
	{
		return(false);
	}

	const depth = (graph.depths().get(placeKey(parent)) ?? 1);

	return((depth + 1 + graph.heightOf(place)) <= MAX_PLACE_DEPTH);
}

/**
 * Whether a place is within a builder's assignments: one of the regions assigned to them, or below one
 *
 * @param graph The version's regions and areas
 * @param place The place
 * @param assignedRegionIds The version's IDs of the regions assigned to them
 * @return True when it is
 */
export function isWithinAssignments(graph: PlaceGraph, place: PlaceRef, assignedRegionIds: ReadonlySet<string>): boolean
{
	if ((place.kind === 'region') && assignedRegionIds.has(place.id))
	{
		return(true);
	}

	return(graph.ancestorsOf(place).some((ancestor) => ((ancestor.kind === 'region') && assignedRegionIds.has(ancestor.id))));
}
