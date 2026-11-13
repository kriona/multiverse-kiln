/**
 * A save's regions and areas (see Regions in STRUCTURE-OVERVIEW.md): held in memory as the save's
 * changes make them, so each change is checked against how the changes before it left them and against
 * what a builder may edit, then every area's settings worked out and stored once every change is made
 */
import { editsEveryPlace, isWithinAssignments, placeKey, type MessageDescriptor, type PlaceKind, type PlaceProblem, type PlaceRef, type PlaceSettings, type ResolvedAreaSettings, type WorldResolution } from '@multiverse-kiln/shared';

import { listAreasLinkingTo, loadPlaceWorld, storeResolvedSettings } from '../db/areaRepo.js';
import { listAssignedRegionIds } from '../db/regionRepo.js';
import { loadUniverseTiles } from '../db/tileRepo.js';
import { PlaceModel } from '../logic/placeModel.js';
import { ChangeRefusal, refuse, resolveStringRef, type ChangeContext } from './editorChangeContext.js';
import { errorMessages } from './errors.js';

/**
 * Why a builder's change was refused
 */
export const outsideAssignmentsMessage: MessageDescriptor = {
	id: 'error.outsideAssignments',
	defaultMessage: 'That region or area isn\'t within the regions you\'re assigned to, so you can\'t change it.',
	description: 'Why the world editor couldn\'t save a builder\'s change: builders only edit the regions and areas below the regions a creator assigned them to, and the change touches one outside them (a move, a parent or a link needs both ends within them)'
};

/**
 * The regions and areas of the version a save changes, and the settings worked out for its areas
 */
export class SavePlaces
{
	private model: PlaceModel | undefined;

	/**
	 * Each area's stored settings as the save found them, by ID
	 */
	private before = new Map<string, ResolvedAreaSettings>();

	/**
	 * Each area's stored settings as the save has written them so far, by ID
	 */
	private current = new Map<string, ResolvedAreaSettings>();

	/**
	 * The version's regions the player is assigned to, as a builder
	 */
	private assigned: Set<string> | undefined;

	/**
	 * How many changes have touched the regions, areas or tiles' kinds, so the save knows which change
	 * last did
	 */
	touches = 0;

	/**
	 * @param contextOf The save, which holds this
	 */
	constructor(private readonly contextOf: () => ChangeContext)
	{
	}

	/**
	 * The save, with the universe as the changes so far left it
	 *
	 * @return The save
	 */
	private get context(): ChangeContext
	{
		return(this.contextOf());
	}

	/**
	 * The regions and areas as the changes so far left them, loaded the first time they are needed
	 *
	 * @return The model
	 */
	async load(): Promise<PlaceModel>
	{
		if (!this.model)
		{
			const { universe, version, transaction } = this.context;
			const { world, stored } = await loadPlaceWorld(version, universe.ruleset, universe.lobbyAreaId, transaction);

			this.model = new PlaceModel(world);
			this.before = stored;
			this.current = new Map(stored);
		}

		return(this.model);
	}

	/**
	 * Notes that a change touched the regions, areas or tiles' kinds, so every area's settings are worked
	 * out again once the save's changes are made
	 */
	touch(): void
	{
		this.touches++;
	}

	/**
	 * Notes the settings stored on an area as it is made, or written for it meanwhile
	 *
	 * @param areaId The area's ID
	 * @param settings The settings stored
	 */
	noteStored(areaId: string, settings: ResolvedAreaSettings): void
	{
		this.current.set(areaId, settings);
	}

	/**
	 * The settings stored on an area so far
	 *
	 * @param areaId The area's ID
	 * @return The settings, or undefined for an area the save hasn't loaded
	 */
	storedOf(areaId: string): ResolvedAreaSettings | undefined
	{
		return(this.current.get(areaId));
	}

	/**
	 * The settings to store on a new area as it is made, before its settings can be worked out: any the
	 * database takes, which the end of the save replaces, or refuses
	 *
	 * @return The settings
	 */
	async placeholderSettings(): Promise<ResolvedAreaSettings>
	{
		const model = await this.load();

		return({
			enabled: false,
			indoors: false,
			lightLevel: null,
			defaultTileId: [...model.world().tileKinds.keys()][0],
			passageOfTime: null,
			faerieMorning: null
		});
	}

	/**
	 * Refuses a builder's change touching a region or area outside the regions they are assigned to;
	 * creators and the site admin role edit every one
	 *
	 * @param places The regions and areas the change touches, as the changes before it left them
	 */
	async requireWithin(...places: PlaceRef[]): Promise<void>
	{
		if (editsEveryPlace(this.context.role))
		{
			return;
		}

		const model = await this.load();
		const assigned = await this.assignedRegionIds();

		for (const place of places)
		{
			if (!isWithinAssignments(model.graph(), place, assigned))
			{
				refuse(403, outsideAssignmentsMessage);
			}
		}
	}

	/**
	 * Refuses a builder's deleting an area that areas outside their assignments link into, since deleting
	 * it deletes those links
	 *
	 * @param areaId The area's ID
	 */
	async requireLinksWithin(areaId: string): Promise<void>
	{
		if (editsEveryPlace(this.context.role))
		{
			return;
		}

		const linking = await listAreasLinkingTo(areaId, this.context.transaction);

		await this.requireWithin(...linking.map((id): PlaceRef => ({ kind: 'area', id })));
	}

	/**
	 * Whether the player is a builder assigned to a region itself, whose parents only creators change
	 *
	 * @param regionId The region's ID
	 * @return True when they are
	 */
	async isAssignedTo(regionId: string): Promise<boolean>
	{
		if (editsEveryPlace(this.context.role))
		{
			return(false);
		}

		return((await this.assignedRegionIds()).has(regionId));
	}

	/**
	 * The version's regions the player is assigned to
	 *
	 * @return Their IDs
	 */
	private async assignedRegionIds(): Promise<Set<string>>
	{
		this.assigned ??= new Set(await listAssignedRegionIds(this.context.version, this.context.playerId, this.context.transaction));

		return(this.assigned);
	}

	/**
	 * Reads the kinds of the version's tiles again after a change to a tile
	 *
	 * @param changesKinds Whether the change may have changed which kinds of area a tile is for, which
	 * the areas' settings are worked out again for; a new tile is the default tile of no area yet, so it
	 * is only read when the regions and areas are loaded already
	 */
	async refreshTiles(changesKinds: boolean): Promise<void>
	{
		if (!this.model && !changesKinds)
		{
			return;
		}

		const { universe, version, transaction } = this.context;
		const model = await this.load();

		for (const tile of await loadUniverseTiles(version, universe.ruleset, transaction))
		{
			model.setTileKind(tile.id, { indoors: tile.indoors, outdoors: tile.outdoors });
		}

		if (changesKinds)
		{
			this.touch();
		}
	}

	/**
	 * Before a tile is deleted: works the areas' settings out without it and stores them, so no area's
	 * stored default tile is the tile, refusing the save when that leaves an area without one
	 *
	 * @param tileId The tile's ID
	 */
	async withoutTile(tileId: number): Promise<void>
	{
		const model = await this.load();

		model.setTileKind(tileId, undefined);
		this.touch();
		await this.resolveAndStore();
	}

	/**
	 * Once every change is made: works out the settings of every area of the version, refuses the save
	 * when an area is left with a conflict or a missing value or anything is nested wrongly, and stores the
	 * settings that changed, telling the rooms about the areas whose settings changed
	 *
	 * @return The areas the save found enabled and leaves disabled
	 */
	async finish(): Promise<string[]>
	{
		if (!this.model || (this.touches === 0))
		{
			return([]);
		}

		const resolution = await this.resolveAndStore();

		return([...resolution.stored]
			.filter(([areaId, settings]) => ((this.before.get(areaId)?.enabled ?? false) && !settings.enabled))
			.map(([areaId]) => areaId));
	}

	/**
	 * Works out the settings of every area of the version as the changes so far left them, refuses the
	 * save on any problem, and stores the settings that changed, telling the rooms
	 *
	 * @return How the settings were worked out
	 */
	private async resolveAndStore(): Promise<WorldResolution>
	{
		const { context } = this;
		const model = await this.load();

		model.setLobbyArea(context.universe.lobbyAreaId);

		const resolution = model.resolve();

		if (resolution.problems.length > 0)
		{
			throw new ChangeRefusal({
				status: 409,
				message: {
					id: 'error.placeProblems',
					defaultMessage: 'Some areas would be left without a value for a setting, or with different values from the regions above them, or regions and areas would be nested wrongly.',
					description: 'Why the world editor couldn\'t save: every area works out its settings (indoors or outdoors, light level, default tile, passage of time) from the regions and areas above it, and the changes leave some with none, or with two different values from places at the same level; the editor lists each problem on the Areas tab'
				}
			}, undefined, undefined, {
				problems: resolution.problems,
				names: this.placeNames(resolution.problems)
			});
		}

		const changed = new Map<string, ResolvedAreaSettings>();

		for (const [areaId, settings] of resolution.stored)
		{
			const stored = this.current.get(areaId);

			if (!stored || !sameSettings(stored, settings))
			{
				changed.set(areaId, settings);
			}
		}

		await storeResolvedSettings(changed, context.transaction);

		let enablingChanged = false;

		for (const [areaId, settings] of changed)
		{
			const stored = this.current.get(areaId);

			this.current.set(areaId, settings);

			// An area the save made is new to the rooms
			if (!this.before.has(areaId))
			{
				continue;
			}

			context.published.push({ kind: 'area', areaId });

			// Players aren't told about links to disabled areas, so the areas with links leading here are read again
			if ((stored !== undefined) && (stored.enabled !== settings.enabled))
			{
				enablingChanged = true;

				for (const linkingAreaId of await listAreasLinkingTo(areaId, context.transaction))
				{
					context.published.push({ kind: 'area', areaId: linkingAreaId });
				}
			}
		}

		if (enablingChanged)
		{
			context.published.push({ kind: 'text', universeId: context.universe.id });
		}

		return(resolution);
	}

	/**
	 * The names of the regions and areas some problems name
	 *
	 * @param problems The problems
	 * @return Each name, by placeKey()
	 */
	private placeNames(problems: readonly PlaceProblem[]): Record<string, string>
	{
		const names: Record<string, string> = {};
		const name = (place: PlaceRef): void =>
		{
			const node = this.model?.graph().node(place);

			if (node)
			{
				names[placeKey(place)] = node.name;
			}
		};

		for (const problem of problems)
		{
			if (('areaId' in problem))
			{
				name({ kind: 'area', id: problem.areaId });
			}

			if (problem.kind === 'conflict')
			{
				for (const { place } of problem.values)
				{
					name(place);
				}
			}
			else if ((problem.kind === 'insideItself') || (problem.kind === 'tooDeep'))
			{
				name(problem.place);
			}
		}

		return(names);
	}
}

/**
 * The parents a change gives a region or area, each named by its ID once refs made earlier in the save
 * are resolved, refusing parents of the wrong kind, parents named twice, an area with no parents or two
 * parent areas, and parents that aren't regions or areas of the version
 *
 * @param context The save
 * @param kind Whether the parents are a region's or an area's
 * @param parents The parents, whose IDs may be refs
 * @param ownId The region's or area's ID, or undefined for one being made
 * @return The parents
 */
export async function resolveParents(context: ChangeContext, kind: PlaceKind, parents: readonly PlaceRef[], ownId?: string): Promise<PlaceRef[]>
{
	const model = await context.places.load();
	const resolved = parents.map((parent): PlaceRef => ({ kind: parent.kind, id: resolveStringRef(context, parent.id) }));
	const keys = new Set(resolved.map(placeKey));

	if (keys.size !== resolved.length)
	{
		refuse(400, errorMessages.invalidRequest, { problem: 'A parent is named twice' });
	}

	// Deeper loops are refused once every change is made, with the places they pass through
	if (resolved.some((parent) => ((parent.kind === kind) && (parent.id === ownId))))
	{
		refuse(400, {
			id: 'error.placeInsideItself',
			defaultMessage: 'A region or area can\'t be inside itself.',
			description: 'Why a region\'s or area\'s parents were refused: one of the parents chosen is the region or area itself'
		});
	}

	if ((kind === 'region') && resolved.some((parent) => (parent.kind !== 'region')))
	{
		refuse(400, errorMessages.invalidRequest, { problem: 'A region\'s parents are regions' });
	}

	if ((kind === 'area') && ((resolved.length === 0) || (resolved.filter((parent) => (parent.kind === 'area')).length > 1)))
	{
		refuse(400, {
			id: 'error.areaParents',
			defaultMessage: 'An area must be in at least one region or area, and inside at most one area.',
			description: 'Why an area\'s parents were refused: every area has at least one parent (a region it is in, or an area it is inside), and at most one of them is an area'
		});
	}

	if (resolved.some((parent) => ((parent.kind === 'region') ? !model.region(parent.id) : !model.area(parent.id))))
	{
		refuse(400, {
			id: 'error.parentNotInUniverse',
			defaultMessage: 'A parent must be a region or area of this universe.',
			description: 'Why a region\'s or area\'s parents were refused: one of the regions or areas chosen to hold it doesn\'t exist, perhaps deleted by another editor'
		});
	}

	return(resolved);
}

/**
 * Refuses a builder changing a region's or area's parents unless both ends of every parent added or
 * removed are within their assignments, and refuses their changing the parents of a region they are
 * assigned to, which only creators do
 *
 * @param context The save
 * @param place The region or area
 * @param before Its parents before the change
 * @param after Its parents after it
 */
export async function requireParentChangesWithin(context: ChangeContext, place: PlaceRef, before: readonly PlaceRef[], after: readonly PlaceRef[]): Promise<void>
{
	const beforeKeys = new Set(before.map(placeKey));
	const afterKeys = new Set(after.map(placeKey));
	const touched = [
		...before.filter((parent) => !afterKeys.has(placeKey(parent))),
		...after.filter((parent) => !beforeKeys.has(placeKey(parent)))
	];

	if (touched.length === 0)
	{
		return;
	}

	if ((place.kind === 'region') && await context.places.isAssignedTo(place.id))
	{
		refuse(403, assignedRegionMessage);
	}

	await context.places.requireWithin(place, ...touched);
}

/**
 * Refuses a region's or area's own settings with a faerie morning set without faerie time or left out
 * with it, or a default tile the version can't use
 *
 * @param context The save
 * @param settings The settings it would have
 */
export async function checkOwnSettings(context: ChangeContext, settings: PlaceSettings): Promise<void>
{
	if ((settings.passageOfTime === 'faerie') !== (settings.faerieMorning !== null))
	{
		refuse(400, faerieMorningMismatchMessage);
	}

	const model = await context.places.load();

	if ((settings.defaultTileId !== null) && !model.world().tileKinds.has(settings.defaultTileId))
	{
		refuse(400, {
			id: 'error.unusableDefaultTile',
			defaultMessage: 'The default tile must be a tile this universe can use.',
			description: 'Why a region\'s or area\'s settings were refused: the default tile was deleted, perhaps by another editor'
		});
	}
}

/**
 * Why time settings were refused for their faerie morning
 */
export const faerieMorningMismatchMessage: MessageDescriptor = {
	id: 'error.faerieMorningMismatch',
	defaultMessage: 'Where morning is must be chosen when, and only when, the passage of time is faerie.',
	description: 'Why time settings were refused: "where is morning?" was given without faerie time, or left out with it'
};

/**
 * Why a builder couldn't move or delete a region they are assigned to
 */
export const assignedRegionMessage: MessageDescriptor = {
	id: 'error.assignedRegionLocked',
	defaultMessage: 'Only the universe\'s creators can move or delete a region you\'re assigned to.',
	description: 'Why the world editor couldn\'t save a builder\'s change: builders can rename the regions they are assigned to and change their settings, but changing their parents or deleting them is for creators'
};

/**
 * Whether two areas' worked-out settings are the same
 *
 * @param first One area's
 * @param second The other's
 * @return True when they are
 */
function sameSettings(first: ResolvedAreaSettings, second: ResolvedAreaSettings): boolean
{
	return((first.enabled === second.enabled)
		&& (first.indoors === second.indoors)
		&& (first.lightLevel === second.lightLevel)
		&& (first.defaultTileId === second.defaultTileId)
		&& (first.passageOfTime === second.passageOfTime)
		&& (first.faerieMorning === second.faerieMorning));
}
