/**
 * A version's regions and areas held in memory while a save changes them, so each change can be checked
 * against how the changes before it left them, and every area's settings worked out once they are all
 * made (see Regions in STRUCTURE-OVERVIEW.md). Pure: the save writes the same changes to the database
 */
import { PlaceGraph, placeKey, resolveAreaSettings, samePlace, type AreaNode, type PlaceNode, type PlaceRef, type PlaceWorld, type TileUsedFor, type WorldResolution } from '@multiverse-kiln/shared';

/**
 * A version's regions, areas, tiles and lobby region, which changes as a save's changes are made
 */
export class PlaceModel
{
	private readonly places: PlaceGraph;
	private readonly tileKinds: Map<number, TileUsedFor>;
	private lobbyRegionId: string | null;

	/**
	 * @param world The version as it is saved
	 */
	constructor(world: PlaceWorld)
	{
		this.places = new PlaceGraph(world.regions, world.areas);
		this.tileKinds = new Map(world.tileKinds);
		this.lobbyRegionId = world.lobbyRegionId;
	}

	/**
	 * The regions and areas as the changes so far left them, indexed. Later changes update it in place
	 *
	 * @return The graph
	 */
	graph(): PlaceGraph
	{
		return(this.places);
	}

	/**
	 * The version as the changes so far left it
	 *
	 * @return The world
	 */
	world(): PlaceWorld
	{
		return({
			regions: [...this.places.regions.values()],
			areas: [...this.places.areas.values()],
			tileKinds: this.tileKinds,
			lobbyRegionId: this.lobbyRegionId
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
		return(this.places.regions.get(regionId));
	}

	/**
	 * An area
	 *
	 * @param areaId The area's ID
	 * @return It, or undefined when there is no such area
	 */
	area(areaId: string): AreaNode | undefined
	{
		return(this.places.areas.get(areaId));
	}

	/**
	 * Every region
	 *
	 * @return The regions
	 */
	allRegions(): PlaceNode[]
	{
		return([...this.places.regions.values()]);
	}

	/**
	 * Every area
	 *
	 * @return The areas
	 */
	allAreas(): AreaNode[]
	{
		return([...this.places.areas.values()]);
	}

	/**
	 * Adds a region, or replaces one with new settings and parents
	 *
	 * @param region The region
	 */
	setRegion(region: PlaceNode): void
	{
		this.places.setRegion(region);
	}

	/**
	 * Adds an area, or replaces one with new settings and parents
	 *
	 * @param area The area
	 */
	setArea(area: AreaNode): void
	{
		this.places.setArea(area);
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
		const children = [...this.places.childrenOf(removed)];

		this.places.deletePlace(removed);
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
		const area = this.places.areas.get(areaId);
		const inherited = (area?.parents ?? []);
		const moved: AreaNode[] = [];

		for (const child of [...this.places.childrenOf(removed)])
		{
			const node = this.places.areas.get(child.id);

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

			this.places.setArea(updated);
			moved.push(updated);
		}

		this.places.deletePlace(removed);

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
	 * Makes another region the lobby region, or none
	 *
	 * @param regionId The region's ID, or null
	 */
	setLobbyRegion(regionId: string | null): void
	{
		this.lobbyRegionId = regionId;
	}

	/**
	 * The lobby region
	 *
	 * @return Its ID, or null when there is none
	 */
	lobbyRegion(): string | null
	{
		return(this.lobbyRegionId);
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
				const node = this.places.regions.get(place.id);

				if (node)
				{
					this.places.setRegion({ ...node, parents: node.parents.filter((each) => !samePlace(each, parent)) });
				}
			}
			else
			{
				const node = this.places.areas.get(place.id);

				if (node)
				{
					this.places.setArea({ ...node, parents: node.parents.filter((each) => !samePlace(each, parent)) });
				}
			}
		}
	}
}
