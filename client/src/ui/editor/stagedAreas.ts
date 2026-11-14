import { NEW_AREA_BOUNDS, NO_NEIGHBORS, placeKey, samePlace, type AreaBounds, type AreaSettings, type EditorArea, type EditorRegion, type PlaceRef, type RegionSettings, type ResolvedAreaSettings } from '@multiverse-kiln/shared';

import { refreshUnsavedWork, watchUnsavedWork } from '../changeTracker';
import type { ChangeSource } from './stagedChanges';

/**
 * How the ID of an area added since the Areas tab was last saved starts, so it never matches a saved one
 */
const NEW_AREA_PREFIX = 'new-';

/**
 * How the ID of a region added since the Areas tab was last saved starts
 */
const NEW_REGION_PREFIX = 'new-region-';

/**
 * Whether an area ID is an area's that hasn't been saved yet
 *
 * @param areaId The ID
 * @return True for a new area
 */
export function isNewAreaId(areaId: string): boolean
{
	return(areaId.startsWith(NEW_AREA_PREFIX));
}

/**
 * Whether a region or area hasn't been saved yet
 *
 * @param place The region or area
 * @return True for a new one
 */
export function isNewPlace(place: PlaceRef): boolean
{
	return(isNewAreaId(place.id));
}

/**
 * The settings a new area shows as worked out until the tab works them out from its parents
 */
const UNKNOWN_SETTINGS: ResolvedAreaSettings = {
	enabled: true,
	indoors: false,
	lightLevel: null,
	defaultTileId: 0,
	passageOfTime: null,
	faerieMorning: null,
	fogOfWar: true,
	lobby: false
};

/**
 * A region or area's parents with one taken out, given its parents in its place when it is an area that
 * goes, as the server does with the areas inside a deleted area
 *
 * @param parents The parents
 * @param removed The parent taken out
 * @param inherited The removed area's parents, given in its place
 * @return The parents, or the same list when it held none of them
 */
function withoutParent(parents: readonly PlaceRef[], removed: PlaceRef, inherited: readonly PlaceRef[]): PlaceRef[]
{
	if (!parents.some((parent) => samePlace(parent, removed)))
	{
		return([...parents]);
	}

	const kept = parents.filter((parent) => !samePlace(parent, removed));

	for (const parent of inherited)
	{
		if (!kept.some((each) => samePlace(each, parent)))
		{
			kept.push(parent);
		}
	}

	return(kept);
}

/**
 * The regions and areas added and deleted on the Areas tab, and the saved ones given other parents by
 * deleting a region, kept on the page until the tab is saved. A new area has the bounds every new area
 * starts with (NEW_AREA_BOUNDS), all its default tile, until it is saved
 */
export class StagedAreas implements ChangeSource
{
	/**
	 * The areas added, in the order they were added
	 */
	private added: EditorArea[] = [];

	/**
	 * The regions added, in the order they were added
	 */
	private addedRegions: EditorRegion[] = [];

	/**
	 * The saved regions and areas that will be deleted, by placeKey()
	 */
	private readonly deleted = new Map<string, PlaceRef>();

	/**
	 * The saved regions and areas given other parents, by placeKey()
	 */
	private readonly moved = new Map<string, PlaceRef[]>();

	private nextId = 1;

	private readonly listeners = new Set<(unsaved: boolean) => void>();

	constructor()
	{
		watchUnsavedWork(this);
	}

	/**
	 * Whether regions or areas have been added, deleted or moved since the tab was last saved
	 *
	 * @return True when they have
	 */
	hasUnsavedChanges(): boolean
	{
		return((this.added.length > 0) || (this.addedRegions.length > 0) || (this.deleted.size > 0) || (this.moved.size > 0));
	}

	/**
	 * Hears when regions or areas are added, deleted or moved, or saved
	 *
	 * @param listener Called with whether there are unsaved changes
	 * @return Stops listening
	 */
	subscribe(listener: (unsaved: boolean) => void): () => void
	{
		this.listeners.add(listener);

		return(() =>
		{
			this.listeners.delete(listener);
		});
	}

	/**
	 * Adds an area
	 *
	 * @param settings Its settings
	 * @param bounds Its bounds: those every new area starts with by default, or the size Add Neighbor
	 * gives a neighbor, which saving it resizes it to
	 * @return The area, with an ID that isNewAreaId() until it is saved
	 */
	create(settings: AreaSettings, bounds: AreaBounds = NEW_AREA_BOUNDS): EditorArea
	{
		const area: EditorArea = {
			...settings,
			id: `${NEW_AREA_PREFIX}${this.nextId++}`,
			resolved: { ...UNKNOWN_SETTINGS },
			bounds: { ...bounds },
			neighbors: { ...NO_NEIGHBORS }
		};

		this.added.push(area);
		this.changed();

		return(area);
	}

	/**
	 * Gives a new area other bounds, such as those a resize carrying it along gives it
	 *
	 * @param areaId Its ID
	 * @param bounds Its bounds
	 */
	setNewBounds(areaId: string, bounds: AreaBounds): void
	{
		this.added = this.added.map((area) => ((area.id === areaId) ? { ...area, bounds: { ...bounds } } : area));
		this.changed();
	}

	/**
	 * Adds a region
	 *
	 * @param settings Its settings
	 * @return The region, with an ID that isNewAreaId() until it is saved
	 */
	createRegion(settings: RegionSettings): EditorRegion
	{
		const region: EditorRegion = {
			...settings,
			id: `${NEW_REGION_PREFIX}${this.nextId++}`,
			builderIds: []
		};

		this.addedRegions.push(region);
		this.changed();

		return(region);
	}

	/**
	 * An area added since the tab was last saved
	 *
	 * @param areaId Its ID
	 * @return The area, or undefined when it isn't one
	 */
	get(areaId: string): EditorArea | undefined
	{
		return(this.added.find((area) => (area.id === areaId)));
	}

	/**
	 * A region added since the tab was last saved
	 *
	 * @param regionId Its ID
	 * @return The region, or undefined when it isn't one
	 */
	getRegion(regionId: string): EditorRegion | undefined
	{
		return(this.addedRegions.find((region) => (region.id === regionId)));
	}

	/**
	 * The areas added since the tab was last saved
	 *
	 * @return The areas, in the order they were added
	 */
	newAreas(): readonly EditorArea[]
	{
		return(this.added);
	}

	/**
	 * The regions added since the tab was last saved
	 *
	 * @return The regions, in the order they were added
	 */
	newRegions(): readonly EditorRegion[]
	{
		return(this.addedRegions);
	}

	/**
	 * Changes a new region's or area's settings, such as the parents a dialog gives it
	 *
	 * @param place The region or area
	 * @param parents Its parents
	 */
	setNewParents(place: PlaceRef, parents: readonly PlaceRef[]): void
	{
		if (place.kind === 'region')
		{
			this.addedRegions = this.addedRegions.map((region) => ((region.id === place.id) ? { ...region, parents: [...parents] } : region));
		}
		else
		{
			this.added = this.added.map((area) => ((area.id === place.id) ? { ...area, parents: [...parents] } : area));
		}

		this.changed();
	}

	/**
	 * Gives a saved region or area other parents when the tab is saved, or a new one other parents now
	 *
	 * @param place The region or area
	 * @param parents Its parents
	 */
	move(place: PlaceRef, parents: readonly PlaceRef[]): void
	{
		if (isNewPlace(place))
		{
			this.setNewParents(place, parents);
			return;
		}

		this.moved.set(placeKey(place), [...parents]);
		this.changed();
	}

	/**
	 * The parents a saved region or area will have once the tab is saved, when they change
	 *
	 * @param place The region or area
	 * @return Its parents, or undefined when they stay as saved
	 */
	movedParents(place: PlaceRef): readonly PlaceRef[] | undefined
	{
		return(this.moved.get(placeKey(place)));
	}

	/**
	 * The saved regions and areas given other parents
	 *
	 * @return Each, with its parents once saved
	 */
	movedPlaces(): { place: PlaceRef; parents: PlaceRef[] }[]
	{
		return([...this.moved].map(([key, parents]) => ({
			place: {
				kind: (key.startsWith('region:') ? 'region' : 'area'),
				id: key.slice(key.indexOf(':') + 1)
			},
			parents
		})));
	}

	/**
	 * Whether a saved area will be deleted
	 *
	 * @param areaId Its ID
	 * @return True when it will
	 */
	isDeleted(areaId: string): boolean
	{
		return(this.deleted.has(placeKey({ kind: 'area', id: areaId })));
	}

	/**
	 * Whether a saved region or area will be deleted
	 *
	 * @param place The region or area
	 * @return True when it will
	 */
	isPlaceDeleted(place: PlaceRef): boolean
	{
		return(this.deleted.has(placeKey(place)));
	}

	/**
	 * The saved areas that will be deleted
	 *
	 * @return Their IDs
	 */
	deletedIds(): string[]
	{
		return([...this.deleted.values()]
			.filter((place) => (place.kind === 'area'))
			.map((place) => place.id));
	}

	/**
	 * The saved regions that will be deleted
	 *
	 * @return Their IDs
	 */
	deletedRegionIds(): string[]
	{
		return([...this.deleted.values()]
			.filter((place) => (place.kind === 'region'))
			.map((place) => place.id));
	}

	/**
	 * Deletes an area when the tab is saved. A new area just goes, and the new areas inside it take its
	 * parents, as the server does with a saved area's
	 *
	 * @param areaId Its ID
	 */
	delete(areaId: string): void
	{
		this.deletePlace({ kind: 'area', id: areaId });
	}

	/**
	 * Deletes a region or area when the tab is saved. A new one just goes, and what is inside it loses it
	 * as a parent, an area's taking its parents in its place
	 *
	 * @param place The region or area
	 */
	deletePlace(place: PlaceRef): void
	{
		if (isNewPlace(place))
		{
			this.removeNew(place);
		}
		else
		{
			this.deleted.set(placeKey(place), place);
			this.moved.delete(placeKey(place));
		}

		this.changed();
	}

	/**
	 * Keeps a saved area that was going to be deleted
	 *
	 * @param areaId Its ID
	 */
	undoDelete(areaId: string): void
	{
		this.undoDeletePlace({ kind: 'area', id: areaId });
	}

	/**
	 * Keeps a saved region or area that was going to be deleted
	 *
	 * @param place The region or area
	 */
	undoDeletePlace(place: PlaceRef): void
	{
		this.deleted.delete(placeKey(place));
		this.changed();
	}

	/**
	 * Takes a new area as saved: it leaves the added areas, and new places inside it name the ID it was
	 * saved with
	 *
	 * @param areaId The ID it had on the page
	 * @param savedId The ID the server saved it with
	 */
	markCreated(areaId: string, savedId: string): void
	{
		this.markPlaceCreated({ kind: 'area', id: areaId }, savedId);
	}

	/**
	 * Takes a new region or area as saved: it leaves the added ones, and everything naming it names the
	 * ID it was saved with
	 *
	 * @param place The region or area, by the ID it had on the page
	 * @param savedId The ID the server saved it with
	 */
	markPlaceCreated(place: PlaceRef, savedId: string): void
	{
		const rename = (parents: readonly PlaceRef[]): PlaceRef[] => parents.map((parent) => (samePlace(parent, place) ? { ...parent, id: savedId } : parent));

		this.added = this.added
			.filter((area) => !((place.kind === 'area') && (area.id === place.id)))
			.map((area) => ({ ...area, parents: rename(area.parents) }));
		this.addedRegions = this.addedRegions
			.filter((region) => !((place.kind === 'region') && (region.id === place.id)))
			.map((region) => ({ ...region, parents: rename(region.parents) }));

		for (const [key, parents] of this.moved)
		{
			this.moved.set(key, rename(parents));
		}

		this.changed();
	}

	/**
	 * Takes a saved area as deleted, by a save from this window or another: it is no longer to be
	 * deleted, and new places inside it lose it as a parent
	 *
	 * @param areaId Its ID
	 * @param parents Its parents, which new areas inside it take in its place
	 */
	markDeleted(areaId: string, parents: readonly PlaceRef[] = []): void
	{
		this.markPlaceDeleted({ kind: 'area', id: areaId }, parents);
	}

	/**
	 * Takes a saved region or area as deleted: it is no longer to be deleted, and new places inside it
	 * lose it as a parent, taking an area's parents in its place
	 *
	 * @param place The region or area
	 * @param parents An area's parents, which the areas inside it take in its place
	 */
	markPlaceDeleted(place: PlaceRef, parents: readonly PlaceRef[] = []): void
	{
		this.deleted.delete(placeKey(place));
		this.moved.delete(placeKey(place));
		this.dropParent(place, parents);
		this.changed();
	}

	/**
	 * Takes the moves as saved
	 */
	markMovesSaved(): void
	{
		this.moved.clear();
		this.changed();
	}

	/**
	 * Throws every change away, for when another universe opens
	 */
	clear(): void
	{
		this.added = [];
		this.addedRegions = [];
		this.deleted.clear();
		this.moved.clear();
		this.changed();
	}

	/**
	 * Takes a new region or area away, and out of the parents of everything else
	 *
	 * @param place The region or area
	 */
	private removeNew(place: PlaceRef): void
	{
		const inherited = ((place.kind === 'area') ? (this.get(place.id)?.parents ?? []) : []);

		this.added = this.added.filter((area) => !((place.kind === 'area') && (area.id === place.id)));
		this.addedRegions = this.addedRegions.filter((region) => !((place.kind === 'region') && (region.id === place.id)));
		this.dropParent(place, inherited);
	}

	/**
	 * Takes a parent out of the new regions' and areas' parents and the moved places', an area's taking
	 * its parents in its place
	 *
	 * @param parent The parent
	 * @param inherited An area's parents
	 */
	private dropParent(parent: PlaceRef, inherited: readonly PlaceRef[]): void
	{
		this.added = this.added.map((area) => ({ ...area, parents: withoutParent(area.parents, parent, inherited) }));
		this.addedRegions = this.addedRegions.map((region) => ({ ...region, parents: withoutParent(region.parents, parent, inherited.filter((each) => (each.kind === 'region'))) }));

		for (const [key, parents] of this.moved)
		{
			this.moved.set(key, withoutParent(parents, parent, inherited));
		}
	}

	/**
	 * Tells the listeners and the page that the changes changed
	 */
	private changed(): void
	{
		const unsaved = this.hasUnsavedChanges();

		refreshUnsavedWork();

		for (const listener of this.listeners)
		{
			listener(unsaved);
		}
	}
}
