/**
 * Replacing a tile that regions and areas take as their default tile, when it is deleted or a kind it
 * is for is unchecked (see Replacing a default tile in STRUCTURE-OVERVIEW.md): which places lose it, what
 * each could take instead, and what the choices leave
 */
import { placeKey, resolveAreaSettings, resolvedValue, suitsKind, type PlaceProblem, type PlaceRef, type PlaceResolution, type PlaceWorld, type SettingResolution, type TileUsedFor, type WorldResolution } from './regions.js';

/**
 * How a tile stops being a default tile: it is deleted, or the kind it is for (indoors when indoors is
 * true, outdoors otherwise) is unchecked
 */
export type TileLoss =
	| { kind: 'delete' }
	| { kind: 'uncheck'; indoors: boolean };

/**
 * A region or area that gets a choice of what it takes instead of the tile
 */
export interface LosingPlace
{
	place: PlaceRef;

	/**
	 * The areas it gave the tile to that lose it, by ID, in the order the world lists them
	 */
	areaIds: string[];

	/**
	 * An area of the unchecked kind below a place that keeps the tile for the other kind: Inherit leaves
	 * it as it is, and a tile becomes its own default tile
	 */
	belowKeeper: boolean;
}

/**
 * What a place takes instead of the tile: what is above it, or a tile of its own
 */
export type TileReplacementChoice =
	| { kind: 'inherit' }
	| { kind: 'tile'; tileId: number };

/**
 * The default tile a place gets: none for a place inheriting, otherwise the tile it sets
 */
export interface PlaceTileChange
{
	place: PlaceRef;
	defaultTileId: number | null;
}

/**
 * The default tile an area would inherit, and the places it would come from
 */
export interface InheritedTile
{
	areaId: string;
	tileId: number;
	from: PlaceRef[];
}

/**
 * A tile being deleted, or a kind it is for being unchecked, while regions and areas take it as their
 * default tile: the places that lose it, what Inherit would give each, and what choices leave. The world
 * is worked out once as it is and once with every place losing the tile inheriting, which gives each
 * area what it would inherit: the tile is passed over for those areas either way, so clearing the other
 * places changes nothing for them
 */
export class DefaultTileLoss
{
	/**
	 * The regions and areas that get a choice: every place that sets the tile when it is deleted, each
	 * with the areas it gives it to; when a kind is unchecked, a place that gives it only to areas of that
	 * kind, and each area of that kind below a place that also gives it to areas of the other kind, which
	 * keeps it. Regions first, in the order the world lists them
	 */
	readonly places: readonly LosingPlace[];

	/**
	 * The tile kinds once the tile is lost
	 */
	private readonly kinds: Map<number, TileUsedFor>;

	/**
	 * Each area's settings worked out as the world is, by area ID
	 */
	private readonly before: ReadonlyMap<string, PlaceResolution>;

	/**
	 * Each area's settings worked out with every place losing the tile inheriting, by area ID
	 */
	private readonly inheriting: ReadonlyMap<string, PlaceResolution>;

	/**
	 * @param world The version's regions and areas
	 * @param tileId The tile
	 * @param loss How it is lost
	 */
	constructor(private readonly world: PlaceWorld, private readonly tileId: number, private readonly loss: TileLoss)
	{
		const resolution = resolveAreaSettings(world);

		this.kinds = kindsAfter(world.tileKinds, tileId, loss);
		this.before = resolution.areas;
		this.places = losingPlaces(world, resolution, tileId, loss);

		const inherit = new Map(this.places.map((each): [string, TileReplacementChoice] => [placeKey(each.place), { kind: 'inherit' }]));

		this.inheriting = ((this.places.length === 0) ? new Map() : this.resolve(tileChanges(this.places, inherit)).areas);
	}

	/**
	 * What Inherit gives the areas a place gave the tile to: each area's default tile worked out from
	 * above once the place's is cleared (left as it is, for an area below a place keeping the tile) and
	 * the tile is lost. It is offered only when every area gets one, with no conflict
	 *
	 * @param losing The place
	 * @return What each area would get, in the order of losing.areaIds, or undefined when Inherit can't be offered
	 */
	inheritedTiles(losing: LosingPlace): InheritedTile[] | undefined
	{
		const tiles: InheritedTile[] = [];

		for (const areaId of losing.areaIds)
		{
			const resolution = this.inheriting.get(areaId)?.defaultTileId;

			if (resolution?.kind === 'inherited')
			{
				tiles.push({
					areaId,
					tileId: resolution.value,
					from: resolution.from
				});
			}
			else if (resolution?.kind === 'own')
			{
				tiles.push({
					areaId,
					tileId: resolution.value,
					from: [{ kind: 'area', id: areaId }]
				});
			}
			else
			{
				return(undefined);
			}
		}

		return(tiles);
	}

	/**
	 * The areas a tile can't become the default tile of: those the place gave the lost tile to whose kind
	 * the tile isn't for, once the tile is lost
	 *
	 * @param losing The place
	 * @param replacementId The tile chosen for it
	 * @return The areas' IDs
	 */
	unsuitedAreas(losing: LosingPlace, replacementId: number): string[]
	{
		return(losing.areaIds.filter((areaId) =>
		{
			const settings = this.before.get(areaId);

			return(!suitsKind(this.kinds, replacementId, (settings ? resolvedValue(settings.indoors) : undefined)));
		}));
	}

	/**
	 * The problems the choices leave with the areas that lose the tile: conflicts, missing values and
	 * anything else keeping them from being saved
	 *
	 * @param changes The default tile each place gets
	 * @return The problems
	 */
	problems(changes: readonly PlaceTileChange[]): PlaceProblem[]
	{
		const areaIds = new Set(this.places.flatMap((each) => each.areaIds));

		return(this.resolve(changes).problems
			.filter((problem) => (('areaId' in problem) && areaIds.has(problem.areaId))));
	}

	/**
	 * Works the world out once the tile is lost and places take what was chosen
	 *
	 * @param changes The default tile each place gets
	 * @return The world's settings
	 */
	private resolve(changes: readonly PlaceTileChange[]): WorldResolution
	{
		return(resolveAreaSettings({
			...withTileChanges(this.world, changes),
			tileKinds: this.kinds
		}));
	}
}

/**
 * The tile kinds once the tile is lost
 *
 * @param tileKinds The tiles the version can use
 * @param tileId The tile
 * @param loss How it is lost
 * @return The tile kinds after
 */
function kindsAfter(tileKinds: ReadonlyMap<number, TileUsedFor>, tileId: number, loss: TileLoss): Map<number, TileUsedFor>
{
	const kinds = new Map(tileKinds);
	const kind = kinds.get(tileId);

	if (loss.kind === 'delete')
	{
		kinds.delete(tileId);
	}
	else if (kind)
	{
		kinds.set(tileId, (loss.indoors ? { ...kind, indoors: false } : { ...kind, outdoors: false }));
	}

	return(kinds);
}

/**
 * The places whose default tile setting gives an area its default tile
 *
 * @param resolution How an area's default tile was worked out
 * @param areaId The area
 * @return The places
 */
function giversOf(resolution: SettingResolution<number>, areaId: string): PlaceRef[]
{
	switch (resolution.kind)
	{
		case 'own':
			return([{ kind: 'area', id: areaId }]);
		case 'inherited':
			return(resolution.from);
		default:
			return([]);
	}
}

/**
 * The regions and areas that lose a tile as their default tile (DefaultTileLoss.places)
 *
 * @param world The version's regions and areas
 * @param resolution The world's settings worked out
 * @param tileId The tile
 * @param loss How it is lost
 * @return The places
 */
function losingPlaces(world: PlaceWorld, resolution: WorldResolution, tileId: number, loss: TileLoss): LosingPlace[]
{
	const given = new Map<string, { areaIds: string[]; kinds: Map<string, boolean | undefined> }>();

	for (const area of world.areas)
	{
		const settings = resolution.areas.get(area.id);

		if (!settings || (resolvedValue(settings.defaultTileId) !== tileId))
		{
			continue;
		}

		const indoors = resolvedValue(settings.indoors);

		for (const giver of giversOf(settings.defaultTileId, area.id))
		{
			const entry = (given.get(placeKey(giver)) ?? { areaIds: [], kinds: new Map<string, boolean | undefined>() });

			entry.areaIds.push(area.id);
			entry.kinds.set(area.id, indoors);
			given.set(placeKey(giver), entry);
		}
	}

	const setting: PlaceRef[] = [
		...world.regions
			.filter((region) => (region.defaultTileId === tileId))
			.map((region) => ({ kind: 'region' as const, id: region.id })),
		...world.areas
			.filter((area) => (area.defaultTileId === tileId))
			.map((area) => ({ kind: 'area' as const, id: area.id }))
	];

	if (loss.kind === 'delete')
	{
		return(setting.map((place) => ({
			place,
			areaIds: (given.get(placeKey(place))?.areaIds ?? []),
			belowKeeper: false
		})));
	}

	const losing: LosingPlace[] = [];
	const belowKeepers = new Map<string, LosingPlace>();

	for (const place of setting)
	{
		const entry = given.get(placeKey(place));
		const ofKind = (entry?.areaIds ?? []).filter((areaId) => (entry?.kinds.get(areaId) === loss.indoors));

		if (!entry || (ofKind.length === 0))
		{
			continue;
		}

		if (ofKind.length === entry.areaIds.length)
		{
			losing.push({
				place,
				areaIds: ofKind,
				belowKeeper: false
			});
			continue;
		}

		for (const areaId of ofKind)
		{
			belowKeepers.set(areaId, {
				place: { kind: 'area', id: areaId },
				areaIds: [areaId],
				belowKeeper: true
			});
		}
	}

	// An area listed for a place that loses the tile is chosen for there, not again on its own
	const listed = new Set(losing.flatMap((each) => each.areaIds));
	const ordered = world.areas.flatMap((area) =>
	{
		const each = belowKeepers.get(area.id);

		return((((each === undefined) || listed.has(area.id)) ? [] : [each]));
	});

	return([...losing, ...ordered]);
}

/**
 * The default tile each place gets from the choices made: none for a place inheriting (an area below a
 * place keeping the tile gets no change), the tile chosen otherwise. Places with nothing chosen are left
 * out
 *
 * @param places The places losing the tile
 * @param choices What each takes instead, by placeKey()
 * @return The changes
 */
export function tileChanges(places: readonly LosingPlace[], choices: ReadonlyMap<string, TileReplacementChoice>): PlaceTileChange[]
{
	return(places.flatMap((each) =>
	{
		const choice = choices.get(placeKey(each.place));

		if (!choice || ((choice.kind === 'inherit') && each.belowKeeper))
		{
			return([]);
		}

		return([{
			place: each.place,
			defaultTileId: ((choice.kind === 'inherit') ? null : choice.tileId)
		}]);
	}));
}

/**
 * The world with places given the default tiles chosen for them
 *
 * @param world The version's regions and areas
 * @param changes The default tile each place gets
 * @return The world after
 */
export function withTileChanges(world: PlaceWorld, changes: readonly PlaceTileChange[]): PlaceWorld
{
	const changed = new Map(changes.map((change) => [placeKey(change.place), change.defaultTileId]));
	const tileOf = (place: PlaceRef, defaultTileId: number | null): number | null =>
	{
		const change = changed.get(placeKey(place));

		return(((change === undefined) ? defaultTileId : change));
	};

	return({
		...world,
		regions: world.regions.map((region) => ({ ...region, defaultTileId: tileOf({ kind: 'region', id: region.id }, region.defaultTileId) })),
		areas: world.areas.map((area) => ({ ...area, defaultTileId: tileOf({ kind: 'area', id: area.id }, area.defaultTileId) }))
	});
}

/**
 * Changes to places' default tiles, later changes to a place replacing earlier ones
 *
 * @param lists The changes, earliest first
 * @return The changes, one for each place
 */
export function mergeTileChanges(...lists: (readonly PlaceTileChange[])[]): PlaceTileChange[]
{
	const merged = new Map<string, PlaceTileChange>();

	for (const change of lists.flat())
	{
		merged.delete(placeKey(change.place));
		merged.set(placeKey(change.place), change);
	}

	return([...merged.values()]);
}
