/**
 * What saving the editor's changes would do to players (POST /:universeId/changes/impact, see
 * shared/src/editorChanges.ts), so the editor can warn about disabling things players are using and ask
 * what should happen before it saves. Nothing is saved
 */
import type express from 'express';
import type { Request, Response } from 'express';
import { isNewRef, mayMakeChange, type ChangeImpact, type EditableUniverseDetails, type EditorChange, type OptionName, type Ruleset, type SaveImpactPayload } from '@multiverse-kiln/shared';

import { listAreas } from '../db/areaRepo.js';
import { countCharactersCarrying, countCharactersOfClasses, countCharactersOfRaces } from '../db/characterRepo.js';
import { loadEditorClasses } from '../db/classRepo.js';
import { listGroupsLargerThan, listMembersInAreas } from '../db/groupRepo.js';
import { loadEditorItems } from '../db/itemRepo.js';
import { loadEditorRaces } from '../db/raceRepo.js';
import { areas, classes, items, races } from '../db/schema.js';
import { findDraftOrigins } from '../db/universeDraftRepo.js';
import { findEditableUniverse } from '../db/universeRepo.js';
import { draftVersion, liveVersion } from '../db/universeVersions.js';
import { countCharactersInAreas, enabledAncestor } from '../logic/disabling.js';
import { areaOccupants } from '../world/areaOccupants.js';
import { universeContextOf } from './editorAccess.js';
import { saveChangesRequest } from './editorPayloads.js';
import { errorMessages, sendError, sendInvalidRequest } from './errors.js';

/**
 * Adds the route that tells the editor what its changes would do to players to a universe's router
 *
 * @param router The router for routes under /:universeId
 */
export function addImpactRoutes(router: express.Router): void
{
	router.post('/changes/impact', impactRoute);
}

/**
 * POST /:universeId/changes/impact: what the changes would do to players, in a SaveImpactPayload
 *
 * @param request The request, whose body is a SaveChangesRequest
 * @param response The response
 */
async function impactRoute(request: Request, response: Response): Promise<void>
{
	const context = universeContextOf(request);
	const { universe } = context;
	const body = saveChangesRequest[universe.ruleset].safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	// Only what the player's role could save is worth warning about
	if (!body.data.changes.every((change) => mayMakeChange(change, context, context.playerId)))
	{
		sendError(response, 403, errorMessages.roleNotAllowed);
		return;
	}

	const { changes } = body.data;
	const applyIndex = changes.findIndex((change) => (change.kind === 'applyDraft'));

	// Players play the live version, so changes saved to the draft do nothing to them until it is applied
	const impacts = [
		...(context.version.draft ? [] : await findImpacts(universe, changes)),
		...((applyIndex < 0) ? [] : await draftImpacts(universe.id, universe.ruleset, applyIndex))
	];
	const payload: SaveImpactPayload = {
		impacts: impacts.sort((first, second) => (first.changeIndex - second.changeIndex))
	};

	response.json(payload);
}

/**
 * A change disabling something saved before, with its place in the save
 */
interface Disabling<Id>
{
	changeIndex: number;
	id: Id;
}

/**
 * What changes to the live version would do to players, compared with it as it is saved now: the races,
 * classes, items and areas they disable that characters are using, and a group size smaller than some groups
 *
 * @param universe The universe, with its live version's settings
 * @param changes The changes
 * @return What each change affecting players would do, in the changes' order
 */
export async function findImpacts(universe: EditableUniverseDetails, changes: readonly EditorChange[]): Promise<ChangeImpact[]>
{
	const impacts = [
		...await raceImpacts(universe, changes),
		...await classImpacts(universe, changes),
		...await itemImpacts(universe, changes),
		...await areaImpacts(universe, changes),
		...await groupSizeImpacts(universe, changes)
	];

	return(impacts.sort((first, second) => (first.changeIndex - second.changeIndex)));
}

/**
 * What applying a universe's draft as it is saved would do to players, compared with the live version:
 * the races, classes, items and areas the draft disables or deletes that characters are using, and a
 * group size smaller than some groups. Each names what it is about by its live ID
 *
 * @param universeId The universe's ID
 * @param ruleset The universe's ruleset
 * @param changeIndex The applyDraft change's place in the save
 * @return What applying would do, each at the applyDraft change
 */
async function draftImpacts(universeId: string, ruleset: Ruleset, changeIndex: number): Promise<ChangeImpact[]>
{
	const live = liveVersion(universeId);
	const draft = draftVersion(universeId);
	const liveUniverse = await findEditableUniverse(live);
	const draftUniverse = await findEditableUniverse(draft);

	if (!liveUniverse || !draftUniverse)
	{
		return([]);
	}

	const impacts: ChangeImpact[] = [];

	for (const [kind, liveOptions, draftOptions, origins, count] of [
		['race', await loadEditorRaces(live, ruleset), await loadEditorRaces(draft, ruleset), await findDraftOrigins<number>(races, universeId), countCharactersOfRaces],
		['class', await loadEditorClasses(live, ruleset), await loadEditorClasses(draft, ruleset), await findDraftOrigins<number>(classes, universeId), countCharactersOfClasses],
		['item', await loadEditorItems(live, ruleset), await loadEditorItems(draft, ruleset), await findDraftOrigins<number>(items, universeId), countCharactersCarrying]
	] as const)
	{
		// A default's ID is the same in both, and the draft's own rows map back to the live rows they came from
		const inDraft = new Map<number, OptionName & { enabled: boolean }>(draftOptions.map((option) => [(origins.get(option.id) ?? option.id), option]));
		const disabled = liveOptions.filter((option) => (option.enabled && !(inDraft.get(option.id)?.enabled ?? false)));
		const counts = await count(universeId, disabled.map(({ id }) => id));

		for (const option of disabled)
		{
			const characters = (counts.get(option.id) ?? 0);
			const named = (inDraft.get(option.id) ?? option);

			if (characters > 0)
			{
				impacts.push({
					changeIndex,
					kind,
					id: option.id,
					name: {
						key: named.key,
						name: named.name
					},
					characters
				});
			}
		}
	}

	impacts.push(...await draftAreaImpacts(liveUniverse, changeIndex));

	if (draftUniverse.groupSize < liveUniverse.groupSize)
	{
		const groups = (await listGroupsLargerThan(universeId, draftUniverse.groupSize)).length;

		if (groups > 0)
		{
			impacts.push({
				changeIndex,
				kind: 'groupSize',
				groupSize: draftUniverse.groupSize,
				groups
			});
		}
	}

	return(impacts);
}

/**
 * The live areas other than the lobby's that a universe's draft disables or deletes, with characters in
 * them, playing or saved
 *
 * @param liveUniverse The universe, with its live version's settings
 * @param changeIndex The applyDraft change's place in the save
 * @return Their impacts
 */
async function draftAreaImpacts(liveUniverse: EditableUniverseDetails, changeIndex: number): Promise<ChangeImpact[]>
{
	const universeId = liveUniverse.id;
	const liveAreas = await listAreas(liveVersion(universeId));
	const origins = await findDraftOrigins<string>(areas, universeId);
	const liveIdOf = (id: string): string => (origins.get(id) ?? id);

	// The areas once the draft is applied, by their live IDs; those it deletes are there, disabled, so the
	// parent of a deleted area can be found
	const inDraft = new Map((await listAreas(draftVersion(universeId))).map((area) => [liveIdOf(area.id), {
		...area,
		id: liveIdOf(area.id),
		parentAreaId: ((area.parentAreaId === null) ? null : liveIdOf(area.parentAreaId))
	}]));
	const tree = [...inDraft.values(), ...liveAreas
		.filter((area) => !inDraft.has(area.id))
		.map((area) => ({ ...area, enabled: false }))];
	const disabled = liveAreas.filter((area) => (area.enabled && (area.id !== liveUniverse.lobbyAreaId) && !(inDraft.get(area.id)?.enabled ?? false)));
	const areaIds = disabled.map(({ id }) => id);
	const saved = (await listMembersInAreas(areaIds)).map(({ characterId, areaId }) => ({ characterId, areaId }));
	const counts = countCharactersInAreas(saved, areaOccupants.list(universeId), areaIds);

	return(disabled.flatMap((area): ChangeImpact[] =>
	{
		const characters = (counts.get(area.id) ?? 0);

		return(((characters > 0) ? [{
			changeIndex,
			kind: 'area',
			id: area.id,
			name: (inDraft.get(area.id)?.name ?? area.name),
			characters,
			hasParent: (enabledAncestor(tree, area.id) !== undefined)
		}] : []));
	}));
}

/**
 * The things saved as enabled that the save leaves disabled: those whose last change disables them. A
 * thing disabled more than once is found once, at its last change, whose choice the save uses (see
 * editorDisablings.ts); one enabled or restored again after being disabled isn't found
 *
 * @param changes The save's changes
 * @param touches The ID of the saved thing a change enables, disables, restores or deletes, or undefined
 * for a change that does none of these
 * @param disables Whether a change disables what it touches
 * @param isEnabled Whether something is saved as enabled
 * @return The changes, with their places and what they disable
 */
function disablings<Id>(changes: readonly EditorChange[], touches: (change: EditorChange) => Id | undefined, disables: (change: EditorChange) => boolean, isEnabled: (id: Id) => boolean): Disabling<Id>[]
{
	const lastChanges = new Map<Id, number>();

	for (const [changeIndex, change] of changes.entries())
	{
		const id = touches(change);

		if (id !== undefined)
		{
			lastChanges.set(id, changeIndex);
		}
	}

	return([...lastChanges]
		.filter(([id, changeIndex]) => (disables(changes[changeIndex]) && isEnabled(id)))
		.map(([id, changeIndex]) => ({ changeIndex, id })));
}

/**
 * The saved race, class or item a change to one of those lists saves or removes
 *
 * @param change The change
 * @param kinds The list's save and remove changes, e.g. saveRace and removeRace
 * @return Its ID, or undefined for a change to something else or to something made in the save
 */
function savedOptionOf(change: EditorChange, kinds: readonly [EditorChange['kind'], EditorChange['kind']]): number | undefined
{
	if (!kinds.includes(change.kind) || !('id' in change) || (typeof change.id !== 'number'))
	{
		return(undefined);
	}

	return(change.id);
}

/**
 * Whether a change saves a race, class or item disabled
 *
 * @param change The change
 * @return True when it does
 */
function savesDisabled(change: EditorChange): boolean
{
	return((((change.kind === 'saveRace') || (change.kind === 'saveClass') || (change.kind === 'saveItem')) && !change.settings.enabled));
}

/**
 * The name a race, class or item has once a change is saved
 *
 * @param saved How it is saved now
 * @param name The name the change gives it
 * @return Its key and name
 */
function nameOf(saved: OptionName | undefined, name: string | null): OptionName
{
	return({
		key: (saved?.key ?? null),
		name: (name ?? saved?.name ?? null)
	});
}

/**
 * The races the changes disable that characters are
 *
 * @param universe The universe
 * @param changes The changes
 * @return Their impacts
 */
async function raceImpacts(universe: EditableUniverseDetails, changes: readonly EditorChange[]): Promise<ChangeImpact[]>
{
	const races = new Map((await loadEditorRaces(liveVersion(universe.id), universe.ruleset)).map((race) => [race.id, race]));
	const found = disablings(changes, (change) => savedOptionOf(change, ['saveRace', 'removeRace']), savesDisabled, (id) => (races.get(id)?.enabled ?? false));
	const counts = await countCharactersOfRaces(universe.id, found.map(({ id }) => id));

	return(found.flatMap(({ changeIndex, id }): ChangeImpact[] =>
	{
		const change = changes[changeIndex];
		const characters = (counts.get(id) ?? 0);

		return((((characters > 0) && (change.kind === 'saveRace')) ? [{ changeIndex, kind: 'race', id, name: nameOf(races.get(id), change.settings.name), characters }] : []));
	}));
}

/**
 * The classes the changes disable that characters are
 *
 * @param universe The universe
 * @param changes The changes
 * @return Their impacts
 */
async function classImpacts(universe: EditableUniverseDetails, changes: readonly EditorChange[]): Promise<ChangeImpact[]>
{
	const classes = new Map((await loadEditorClasses(liveVersion(universe.id), universe.ruleset)).map((option) => [option.id, option]));
	const found = disablings(changes, (change) => savedOptionOf(change, ['saveClass', 'removeClass']), savesDisabled, (id) => (classes.get(id)?.enabled ?? false));
	const counts = await countCharactersOfClasses(universe.id, found.map(({ id }) => id));

	return(found.flatMap(({ changeIndex, id }): ChangeImpact[] =>
	{
		const change = changes[changeIndex];
		const characters = (counts.get(id) ?? 0);

		return((((characters > 0) && (change.kind === 'saveClass')) ? [{ changeIndex, kind: 'class', id, name: nameOf(classes.get(id), change.settings.name), characters }] : []));
	}));
}

/**
 * The items the changes disable that characters carry
 *
 * @param universe The universe
 * @param changes The changes
 * @return Their impacts
 */
async function itemImpacts(universe: EditableUniverseDetails, changes: readonly EditorChange[]): Promise<ChangeImpact[]>
{
	if (!changes.some((change) => ((change.kind === 'saveItem') && !change.settings.enabled)))
	{
		return([]);
	}

	const items = new Map((await loadEditorItems(liveVersion(universe.id), universe.ruleset)).map((item) => [item.id, item]));
	const found = disablings(changes, (change) => savedOptionOf(change, ['saveItem', 'removeItem']), savesDisabled, (id) => (items.get(id)?.enabled ?? false));
	const counts = await countCharactersCarrying(universe.id, found.map(({ id }) => id));

	return(found.flatMap(({ changeIndex, id }): ChangeImpact[] =>
	{
		const change = changes[changeIndex];
		const characters = (counts.get(id) ?? 0);

		return((((characters > 0) && (change.kind === 'saveItem')) ? [{ changeIndex, kind: 'item', id, name: nameOf(items.get(id), change.settings.name), characters }] : []));
	}));
}

/**
 * The areas other than the lobby's that the changes disable with characters in them, playing or saved
 *
 * @param universe The universe
 * @param changes The changes
 * @return Their impacts
 */
async function areaImpacts(universe: EditableUniverseDetails, changes: readonly EditorChange[]): Promise<ChangeImpact[]>
{
	const areas = await listAreas(liveVersion(universe.id));
	const byId = new Map(areas.map((area) => [area.id, area]));
	const found = disablings(changes, (change) => areaTouched(change, universe), (change) => ((change.kind === 'updateArea') && (change.update.enabled === false)), (id) => (byId.get(id)?.enabled ?? false));
	const areaIds = found.map(({ id }) => id);
	const saved = (await listMembersInAreas(areaIds)).map(({ characterId, areaId }) => ({ characterId, areaId }));
	const counts = countCharactersInAreas(saved, areaOccupants.list(universe.id), areaIds);

	return(found.flatMap(({ changeIndex, id }): ChangeImpact[] =>
	{
		const change = changes[changeIndex];
		const characters = (counts.get(id) ?? 0);
		const name = (((change.kind === 'updateArea') ? change.update.name : undefined) ?? byId.get(id)?.name ?? '');

		return(((characters > 0) ? [{ changeIndex, kind: 'area', id, name, characters, hasParent: (enabledAncestor(areas, id) !== undefined) }] : []));
	}));
}

/**
 * The saved area other than the lobby's whose enabling a change sets, or that it deletes
 *
 * @param change The change
 * @param universe The universe
 * @return Its ID, or undefined for a change that does neither, or is to an area made in the save
 */
function areaTouched(change: EditorChange, universe: EditableUniverseDetails): string | undefined
{
	const areaId = ((((change.kind === 'updateArea') && (change.update.enabled !== undefined)) || (change.kind === 'deleteArea')) ? change.areaId : undefined);

	// The lobby's players are always in its area, so disabling it moves nobody
	return((((areaId === undefined) || isNewRef(areaId) || (areaId === universe.lobbyAreaId)) ? undefined : areaId));
}

/**
 * The group size the changes leave the universe with, when it is lower than the saved one, with how many
 * groups are larger. It is found at the last change setting the group size, whose choice the save uses
 *
 * @param universe The universe
 * @param changes The changes
 * @return Its impact
 */
async function groupSizeImpacts(universe: EditableUniverseDetails, changes: readonly EditorChange[]): Promise<ChangeImpact[]>
{
	const changeIndex = changes.findLastIndex((change) => ((change.kind === 'universe') && (change.update.groupSize !== undefined)));
	const change = changes.at(changeIndex);
	const groupSize = (((changeIndex >= 0) && (change?.kind === 'universe')) ? change.update.groupSize : undefined);

	if ((groupSize === undefined) || (groupSize >= universe.groupSize))
	{
		return([]);
	}

	const groups = (await listGroupsLargerThan(universe.id, groupSize)).length;

	return(((groups > 0) ? [{ changeIndex, kind: 'groupSize', groupSize, groups }] : []));
}
