/**
 * Saving changes to a universe's regions and the builders assigned to them (see Regions in
 * STRUCTURE-OVERVIEW.md, and editorChanges.ts)
 */
import { editsEveryPlace, type AreaEvacuations, type MessageDescriptor, type NewRef, type NewRegionChange, type PlaceNode, type PlaceRef, type RegionChangeUpdate, type RegionSettings, type StringRef } from '@multiverse-kiln/shared';

import { countRegions, createRegion, deleteRegion, findLiveRegionId, listAssignmentsByBuilder, setRegionAssignments, setRegionParents, updateRegionSettings } from '../db/regionRepo.js';
import { findSiteSettings } from '../db/siteSettingsRepo.js';
import { listUniverseRoles } from '../db/universeEditorRepo.js';
import { recordRef, refuse, resolveNumberRef, resolveStringRef, type ChangeContext } from './editorChangeContext.js';
import { assignedRegionMessage, checkOwnSettings, outsideAssignmentsMessage, requireParentChangesWithin, resolveParents } from './editorPlaces.js';

/**
 * Why a region couldn't be found
 */
const noSuchRegionMessage: MessageDescriptor = {
	id: 'error.noSuchRegion',
	defaultMessage: 'The region doesn\'t exist.',
	description: 'Why a change to a region failed: it was deleted, perhaps by another editor'
};

/**
 * A region of the version a change names, as the changes before it left it
 *
 * @param context The save
 * @param ref The region's ID, or the ref of one made earlier in the save
 * @return The region; a missing region is refused
 */
async function regionOf(context: ChangeContext, ref: StringRef): Promise<PlaceNode>
{
	const region = (await context.places.load()).region(resolveStringRef(context, ref));

	if (!region)
	{
		refuse(404, noSuchRegionMessage);
	}

	return(region);
}

/**
 * Refuses a region name another region of the version has, not counting case
 *
 * @param context The save
 * @param name The name
 * @param regionId The region being named, or undefined for a new one
 */
async function checkRegionName(context: ChangeContext, name: string, regionId: string | undefined): Promise<void>
{
	const lower = name.toLowerCase();
	const taken = (await context.places.load()).allRegions().some((region) => ((region.id !== regionId) && (region.name.toLowerCase() === lower)));

	if (taken)
	{
		refuse(409, {
			id: 'error.regionNameTaken',
			defaultMessage: 'Another region is already named {name}.',
			description: 'Why a region\'s name was refused: region names are unique within a universe, not counting capitals; {name} is the name'
		}, {
			name
		});
	}
}

/**
 * A region's own settings in a save with the default tile they name, as saved
 *
 * @param context The save
 * @param update The settings
 * @return The settings, naming the default tile by its ID, without the parents
 */
function resolveRegionUpdate(context: ChangeContext, { defaultTileId, parents: _parents, ...rest }: RegionChangeUpdate): Partial<Omit<RegionSettings, 'parents'>>
{
	return({
		...rest,
		...((defaultTileId === undefined) ? {} : { defaultTileId: ((defaultTileId === null) ? null : resolveNumberRef(context, defaultTileId)) })
	});
}

/**
 * Adds a region to the universe, inside the regions it names
 *
 * @param context The save
 * @param ref The region's ref
 * @param region Its settings
 */
export async function createRegionChange(context: ChangeContext, ref: NewRef, region: NewRegionChange): Promise<void>
{
	const { version, transaction } = context;
	const parents = await resolveParents(context, 'region', region.parents);
	const settings = {
		enabled: null,
		indoors: null,
		lightLevel: null,
		defaultTileId: null,
		passageOfTime: null,
		faerieMorning: null,
		...resolveRegionUpdate(context, region),
		name: region.name
	};

	// A builder's region goes within their assignments, so a new top-level region is never theirs
	if ((parents.length === 0) && !editsEveryPlace(context.role))
	{
		refuse(403, outsideAssignmentsMessage);
	}

	await context.places.requireWithin(...parents);
	await checkRegionName(context, settings.name, undefined);
	await checkOwnSettings(context, settings);

	const { areasPerUniverse } = await findSiteSettings(transaction);

	if (await countRegions(version, transaction) >= areasPerUniverse)
	{
		refuse(409, {
			id: 'error.regionLimit',
			defaultMessage: 'A universe can have at most {max, plural, one {# region} other {# regions}}.',
			description: 'Why a new region wasn\'t made: the universe has as many regions as the site allows (as many as areas); {max} is the most it can have'
		}, {
			max: areasPerUniverse
		});
	}

	const regionId = await createRegion(version, settings, transaction);

	await setRegionParents(regionId, parents.map((parent) => parent.id), transaction);
	(await context.places.load()).setRegion({ ...settings, id: regionId, parents });
	context.places.touch();
	recordRef(context, ref, regionId);
}

/**
 * Changes a region's settings or parents. The areas below it whose settings change with it are told to
 * the rooms once their settings are worked out, and those it leaves disabled send the characters in
 * them where moveTo says
 *
 * @param context The save
 * @param regionId The region
 * @param update The settings to change
 * @param moveTo Where disabling the areas it disables sends the characters in them, by area
 */
export async function updateRegionChange(context: ChangeContext, regionId: StringRef, update: RegionChangeUpdate, moveTo: AreaEvacuations): Promise<void>
{
	const { transaction } = context;
	const region = await regionOf(context, regionId);
	const place: PlaceRef = { kind: 'region', id: region.id };
	const resolved = resolveRegionUpdate(context, update);
	const parents = ((update.parents === undefined) ? region.parents : await resolveParents(context, 'region', update.parents, region.id));
	const updated: PlaceNode = { ...region, ...resolved, parents };

	await context.places.requireWithin(place);
	await requireParentChangesWithin(context, place, region.parents, parents);

	if (resolved.name !== undefined)
	{
		await checkRegionName(context, resolved.name, region.id);
	}

	await checkOwnSettings(context, updated);
	await updateRegionSettings(region.id, resolved, transaction);

	if (update.parents !== undefined)
	{
		await setRegionParents(region.id, parents.map((parent) => parent.id), transaction);
	}

	(await context.places.load()).setRegion(updated);
	context.places.touch();
	context.disablings.areas(moveTo);
}

/**
 * Deletes a region. What it holds loses it as a parent; the save moves or deletes what has no other
 * parent with changes before this one, and is refused when it leaves an area in no region
 *
 * @param context The save
 * @param regionId The region
 * @param moveTo Where the characters in the areas its deletion disables go, by area
 */
export async function deleteRegionChange(context: ChangeContext, regionId: StringRef, moveTo: AreaEvacuations): Promise<void>
{
	const region = await regionOf(context, regionId);

	await context.places.requireWithin({ kind: 'region', id: region.id });

	if (await context.places.isAssignedTo(region.id))
	{
		refuse(403, assignedRegionMessage);
	}

	(await context.places.load()).deleteRegion(region.id);
	await deleteRegion(region.id, context.transaction);
	context.places.touch();
	context.disablings.areas(moveTo);
}

/**
 * Assigns builders to a region, replacing those assigned to it. The assignment is the universe's, kept
 * for the live region, so a region the draft added can't be assigned until the draft is applied. The
 * windows of the builders whose assignments change load the universe again
 *
 * @param context The save
 * @param regionId The region, in the version open
 * @param builderIds The builders, by player ID
 */
export async function assignBuildersChange(context: ChangeContext, regionId: StringRef, builderIds: readonly string[]): Promise<void>
{
	const { universe, transaction } = context;
	const region = await regionOf(context, regionId);
	const liveId = await findLiveRegionId(region.id, transaction);

	if (liveId === null)
	{
		refuse(409, {
			id: 'error.draftRegionAssignment',
			defaultMessage: 'Builders can be assigned to a region the draft added once the draft is applied.',
			description: 'Why builders couldn\'t be assigned to a region: assignments belong to the universe rather than its draft, so they name live regions, and this region only exists in the draft so far'
		});
	}

	const roles = await listUniverseRoles(universe.id, transaction);

	if (builderIds.some((playerId) => (roles.get(playerId) !== 'builder')))
	{
		refuse(400, {
			id: 'error.assignNonBuilder',
			defaultMessage: 'Only the universe\'s builders can be assigned to regions.',
			description: 'Why builders couldn\'t be assigned to a region: one of the players chosen isn\'t a builder of the universe, perhaps because another editor changed their role'
		});
	}

	const before = new Set([...await listAssignmentsByBuilder(universe.id, transaction)]
		.filter(([, regionIds]) => regionIds.includes(liveId))
		.map(([playerId]) => playerId));

	await setRegionAssignments(universe.id, liveId, builderIds, transaction);

	for (const playerId of new Set([...before, ...builderIds]))
	{
		if (!before.has(playerId) || !builderIds.includes(playerId))
		{
			context.editorRoles.set(playerId, 'builder');
		}
	}
}
