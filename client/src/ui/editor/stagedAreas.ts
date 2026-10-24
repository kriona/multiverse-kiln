import { NEW_AREA_BOUNDS, type AreaSettings, type EditorArea } from '@multiverse-kiln/shared';

import { refreshUnsavedWork, watchUnsavedWork } from '../changeTracker';
import type { ChangeSource } from './stagedChanges';

/**
 * How the ID of an area added since the Areas tab was last saved starts, so it never matches a saved one
 */
const NEW_AREA_PREFIX = 'new-';

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
 * The areas added and deleted on the Areas tab, kept on the page until the tab is saved. A new area has
 * the map every new area starts with (NEW_AREA_BOUNDS), all its default tile, until it is saved
 */
export class StagedAreas implements ChangeSource
{
	/**
	 * The areas added, in the order they were added
	 */
	private added: EditorArea[] = [];

	/**
	 * The saved areas that will be deleted
	 */
	private readonly deleted = new Set<string>();

	private nextId = 1;

	private readonly listeners = new Set<(unsaved: boolean) => void>();

	constructor()
	{
		watchUnsavedWork(this);
	}

	/**
	 * Whether areas have been added or deleted since the tab was last saved
	 *
	 * @return True when they have
	 */
	hasUnsavedChanges(): boolean
	{
		return((this.added.length > 0) || (this.deleted.size > 0));
	}

	/**
	 * Hears when areas are added or deleted, or saved
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
	 * @return The area, with an ID that isNewAreaId() until it is saved
	 */
	create(settings: AreaSettings): EditorArea
	{
		const area: EditorArea = {
			...settings,
			id: `${NEW_AREA_PREFIX}${this.nextId++}`,
			bounds: { ...NEW_AREA_BOUNDS }
		};

		this.added.push(area);
		this.changed();

		return(area);
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
	 * The areas added since the tab was last saved
	 *
	 * @return The areas, in the order they were added
	 */
	newAreas(): readonly EditorArea[]
	{
		return(this.added);
	}

	/**
	 * Whether a saved area will be deleted
	 *
	 * @param areaId Its ID
	 * @return True when it will
	 */
	isDeleted(areaId: string): boolean
	{
		return(this.deleted.has(areaId));
	}

	/**
	 * The saved areas that will be deleted
	 *
	 * @return Their IDs
	 */
	deletedIds(): string[]
	{
		return([...this.deleted]);
	}

	/**
	 * Deletes an area when the tab is saved. A new area just goes, and new areas inside it become
	 * top-level areas, as the server does with a saved area's
	 *
	 * @param areaId Its ID
	 */
	delete(areaId: string): void
	{
		if (isNewAreaId(areaId))
		{
			this.added = this.added
				.filter((area) => (area.id !== areaId))
				.map((area) => ((area.parentAreaId === areaId) ? { ...area, parentAreaId: null } : area));
		}
		else
		{
			this.deleted.add(areaId);
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
		this.deleted.delete(areaId);
		this.changed();
	}

	/**
	 * Takes a new area as saved: it leaves the added areas, and new areas inside it name the ID it was saved with
	 *
	 * @param areaId The ID it had on the page
	 * @param savedId The ID the server saved it with
	 */
	markCreated(areaId: string, savedId: string): void
	{
		this.added = this.added
			.filter((area) => (area.id !== areaId))
			.map((area) => ((area.parentAreaId === areaId) ? { ...area, parentAreaId: savedId } : area));
		this.changed();
	}

	/**
	 * Takes a saved area as deleted
	 *
	 * @param areaId Its ID
	 */
	markDeleted(areaId: string): void
	{
		this.deleted.delete(areaId);
		this.changed();
	}

	/**
	 * Throws every change away, for when another universe opens
	 */
	clear(): void
	{
		this.added = [];
		this.deleted.clear();
		this.changed();
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
