/**
 * A version's regions and areas held in memory while a save changes them, so each change can be checked
 * against how the changes before it left them, and every area's settings worked out once they are all
 * made (see Regions in STRUCTURE-OVERVIEW.md). Pure: the save writes the same changes to the database
 */
import { PlaceGraph, placeKey, resolveAreaSettings, samePlace, type AreaNode, type PlaceNode, type PlaceRef, type PlaceWorld, type TileUsedFor, type WorldResolution } from '@multiverse-kiln/shared';

/**
 * A version's regions, areas, tiles and lobby, which changes as a save's changes are made
 */
export class PlaceModel
{
	private readonly regions: Map<string, PlaceNode>;
	private readonly areas: Map<string, AreaNode>;
	private readonly tileKinds: Map<number, TileUsedFor>;
	private lobbyAreaId: string | null;
	private cachedGraph: PlaceGraph | undefined;

	/**
	 * @param world The version as it is saved
	 */
	constructor(world: PlaceWorld)
	{
		this.regions = new Map(world.regions.map((region) => [region.id, region]));
		this.areas = new Map(world.areas.map((area) => [area.id, area]));
		this.tileKinds = new Map(world.tileKinds);
		this.lobbyAreaId = world.lobbyAreaId;
	}

	/**
	 * The regions and areas as the changes so far left them, indexed
	 *
	 * @return The graph
	 */
	graph(): PlaceGraph
	{
		this.cachedGraph ??= new PlaceGraph([...this.regions.values()], [...this.areas.values()]);

		return(this.cachedGraph);
	}

	/**
	 * The version as the changes so far left it
	 *
	 * @return The world
	 */
	world(): PlaceWorld
	{
		return({
			regions: [...this.regions.values()],
			areas: [...this.areas.values()],
			tileKinds: this.tileKinds,
			lobbyAreaId: this.lobbyAreaId
		});
	}

	/**
	 * Every area's settings worked out, with what keeps any from being saved
	 *
	 * @return The resolution
	 */
	resolve(): WorldResolution
	{
		return(resolveAreaSettings(this.world()));
	}

	/**
	 * A region
	 *
	 * @param regionId The region's ID
	 * @return It, or undefined when there is no such region
	 */
	region(regionId: string): PlaceNode | undefined
	{
		return(this.regions.get(regionId));
	}

	/**
	 * An area
	 *
	 * @param areaId The area's ID
	 * @return It, or undefined when there is no such area
	 */
	area(areaId: string): AreaNode | undefined
	{
		return(this.areas.get(areaId));
	}

	/**
	 * Every region
	 *
	 * @return The regions
	 */
	allRegions(): PlaceNode[]
	{
		return([...this.regions.values()]);
	}

	/**
	 * Every area
	 *
	 * @return The areas
	 */
	allAreas(): AreaNode[]
	{
		return([...this.areas.values()]);
	}

	/**
	 * Adds a region, or replaces one with new settings and parents
	 *
	 * @param region The region
	 */
	setRegion(region: PlaceNode): void
	{
		this.regions.set(region.id, region);
		this.cachedGraph = undefined;
	}

	/**
	 * Adds an area, or replaces one with new settings and parents
	 *
	 * @param area The area
	 */
	setArea(area: AreaNode): void
	{
		this.areas.set(area.id, area);
		this.cachedGraph = undefined;
	}

	/**
	 * Deletes a region: what it held loses it as a parent, and its assignments go with it
	 *
	 * @param regionId The region's ID
	 * @return The regions and areas that lost it as a parent
	 */
	deleteRegion(regionId: string): PlaceRef[]
	{
		const removed: PlaceRef = { kind: 'region', id: regionId };
		const children = this.graph().childrenOf(removed);

		this.regions.delete(regionId);
		this.dropParent(children, removed);

		return(children);
	}

	/**
	 * Deletes an area. The areas inside it take its parents in its place, beside their other parents
	 *
	 * @param areaId The area's ID
	 * @return The areas inside it, with the parents each has now
	 */
	deleteArea(areaId: string): AreaNode[]
	{
		const removed: PlaceRef = { kind: 'area', id: areaId };
		const area = this.areas.get(areaId);
		const inherited = (area?.parents ?? []);
		const moved: AreaNode[] = [];

		for (const child of this.graph().childrenOf(removed))
		{
			const node = this.areas.get(child.id);

			if ((child.kind !== 'area') || !node)
			{
				continue;
			}

			const parents = node.parents.filter((parent) => !samePlace(parent, removed));
			const keys = new Set(parents.map(placeKey));

			for (const parent of inherited)
			{
				if (!keys.has(placeKey(parent)))
				{
					keys.add(placeKey(parent));
					parents.push(parent);
				}
			}

			const updated = { ...node, parents };

			this.areas.set(child.id, updated);
			moved.push(updated);
		}

		this.areas.delete(areaId);
		this.cachedGraph = undefined;

		return(moved);
	}

	/**
	 * Gives a tile the kinds of area it is for, or with undefined takes it away, as deleting it does
	 *
	 * @param tileId The tile's ID
	 * @param kind The kinds it is for, or undefined
	 */
	setTileKind(tileId: number, kind: TileUsedFor | undefined): void
	{
		if (kind === undefined)
		{
			this.tileKinds.delete(tileId);
		}
		else
		{
			this.tileKinds.set(tileId, kind);
		}
	}

	/**
	 * Makes another area the lobby's, or none
	 *
	 * @param areaId The area's ID, or null
	 */
	setLobbyArea(areaId: string | null): void
	{
		this.lobbyAreaId = areaId;
	}

	/**
	 * Takes a parent from some places
	 *
	 * @param places The places
	 * @param parent The parent
	 */
	private dropParent(places: readonly PlaceRef[], parent: PlaceRef): void
	{
		for (const place of places)
		{
			if (place.kind === 'region')
			{
				const node = this.regions.get(place.id);

				if (node)
				{
					this.regions.set(place.id, { ...node, parents: node.parents.filter((each) => !samePlace(each, parent)) });
				}
			}
			else
			{
				const node = this.areas.get(place.id);

				if (node)
				{
					this.areas.set(place.id, { ...node, parents: node.parents.filter((each) => !samePlace(each, parent)) });
				}
			}
		}

		this.cachedGraph = undefined;
	}
}
