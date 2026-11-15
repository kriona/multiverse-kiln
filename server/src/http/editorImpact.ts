/**
 * What saving the editor's changes would do to players (POST /:universeId/changes/impact, see
 * shared/src/editorChanges.ts), so the editor can warn about disabling things players are using and ask
 * what should happen before it saves. Nothing is saved
 */
import type express from 'express';
import type { Request, Response } from 'express';
import { lobbyAreaIds, mayMakeChange, normalizedRulebooks, PlaceGraph, type ChangeImpact, type EditableUniverseDetails, type EditorChange, type ImpactedOption, type OptionName, type Ruleset, type SaveImpactPayload } from '@multiverse-kiln/shared';

import { listAreas, loadPlaceWorld } from '../db/areaRepo.js';
import { countCharactersCarrying, countCharactersOfClasses, countCharactersOfRaces } from '../db/characterRepo.js';
import { loadEditorClasses } from '../db/classRepo.js';
import { countGroupsLargerThan, listMembersInAreas } from '../db/groupRepo.js';
import { loadEditorItems } from '../db/itemRepo.js';
import { loadEditorRaces } from '../db/raceRepo.js';
import { loadRulebookSettings } from '../db/rulesetRepo.js';
import { areas, classes, items, races } from '../db/schema.js';
import { findDraftOrigins } from '../db/universeDraftRepo.js';
import { findEditableUniverse } from '../db/universeRepo.js';
import { draftVersion, liveVersion, type UniverseVersion } from '../db/universeVersions.js';
import { areasById, areasInTree, countCharactersInAreas, enabledAncestor } from '../logic/disabling.js';
import { enabledAreaIds, findDisabledAreas, findLobbyEntries } from '../logic/placeChanges.js';
import { PlaceModel } from '../logic/placeModel.js';
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
 * classes, items and areas they disable that characters are using, the books they turn off whose races,
 * classes and items characters are using, and a group size smaller than some groups
 *
 * @param universe The universe, with its live version's settings
 * @param changes The changes
 * @return What each change affecting players would do, in the changes' order
 */
export async function findImpacts(universe: EditableUniverseDetails, changes: readonly EditorChange[]): Promise<ChangeImpact[]>
{
	const impacts = (await Promise.all([
		raceImpacts(universe, changes),
		classImpacts(universe, changes),
		itemImpacts(universe, changes),
		areaImpacts(universe, changes),
		groupSizeImpacts(universe, changes),
		rulebookImpacts(universe, changes)
	])).flat();

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
	const [liveUniverse, draftUniverse] = await Promise.all([
		findEditableUniverse(liveVersion(universeId)),
		findEditableUniverse(draftVersion(universeId))
	]);

	if (!liveUniverse || !draftUniverse)
	{
		return([]);
	}

	return((await Promise.all([
		draftOptionImpacts('race', universeId, changeIndex, (version) => loadEditorRaces(version, ruleset), races, countCharactersOfRaces),
		draftOptionImpacts('class', universeId, changeIndex, (version) => loadEditorClasses(version, ruleset), classes, countCharactersOfClasses),
		draftOptionImpacts('item', universeId, changeIndex, (version) => loadEditorItems(version, ruleset), items, countCharactersCarrying),
		draftAreaImpacts(liveUniverse, changeIndex),
		draftGroupSizeImpacts(liveUniverse, draftUniverse, changeIndex),
		draftRulebookImpacts(universeId, ruleset, changeIndex)
	])).flat());
}

/**
 * The books a ruleset change turns off whose races, classes or items characters use. A save uses its
 * last ruleset change, so the impact is found at that one
 *
 * @param universe The universe
 * @param changes The changes
 * @return An impact for each such book
 */
async function rulebookImpacts(universe: EditableUniverseDetails, changes: readonly EditorChange[]): Promise<ChangeImpact[]>
{
	const changeIndex = changes.findLastIndex((change) => (change.kind === 'ruleset'));
	const change = changes.at(changeIndex);

	if ((changeIndex < 0) || (change?.kind !== 'ruleset'))
	{
		return([]);
	}

	const before = await loadRulebookSettings(liveVersion(universe.id), universe.ruleset);
	const after = normalizedRulebooks(universe.ruleset, change.settings.settings);
	const turnedOff = before.rulebooks.filter((rulebook) => !after.rulebooks.includes(rulebook));

	return(rulebookOffImpacts(universe.id, universe.ruleset, turnedOff, changeIndex));
}

/**
 * The books a universe's draft turns off whose races, classes or items characters use
 *
 * @param universeId The universe's ID
 * @param ruleset The universe's ruleset
 * @param changeIndex The applyDraft change's place in the save
 * @return An impact for each such book, at the applyDraft change
 */
async function draftRulebookImpacts(universeId: string, ruleset: Ruleset, changeIndex: number): Promise<ChangeImpact[]>
{
	const [live, draft] = await Promise.all([
		loadRulebookSettings(liveVersion(universeId), ruleset),
		loadRulebookSettings(draftVersion(universeId), ruleset)
	]);
	const turnedOff = live.rulebooks.filter((rulebook) => !draft.rulebooks.includes(rulebook));

	return(rulebookOffImpacts(universeId, ruleset, turnedOff, changeIndex));
}

/**
 * What turning books off would do to the players using the live version's races, classes and items of
 * them: those enabled on their own that characters are or carry, by book
 *
 * @param universeId The universe's ID
 * @param ruleset The universe's ruleset
 * @param turnedOff The books turned off
 * @param changeIndex The change that turns them off
 * @return An impact for each book whose races, classes or items characters use
 */
async function rulebookOffImpacts(universeId: string, ruleset: Ruleset, turnedOff: readonly string[], changeIndex: number): Promise<ChangeImpact[]>
{
	if (turnedOff.length === 0)
	{
		return([]);
	}

	const live = liveVersion(universeId);
	const inBooks = <Option extends { enabled: boolean; rulebook: string | null }>(options: readonly Option[]): Option[] => options.filter((option) => (option.enabled && (option.rulebook !== null) && turnedOff.includes(option.rulebook)));
	const [liveRaces, liveClasses, liveItems] = await Promise.all([
		loadEditorRaces(live, ruleset),
		loadEditorClasses(live, ruleset),
		loadEditorItems(live, ruleset)
	]);
	const bookRaces = inBooks(liveRaces);
	const bookClasses = inBooks(liveClasses);
	const bookItems = inBooks(liveItems);
	const [raceCounts, classCounts, itemCounts] = await Promise.all([
		countCharactersOfRaces(universeId, bookRaces.map(({ id }) => id)),
		countCharactersOfClasses(universeId, bookClasses.map(({ id }) => id)),
		countCharactersCarrying(universeId, bookItems.map(({ id }) => id))
	]);
	const impacted = (options: readonly (OptionName & { id: number; rulebook: string | null })[], counts: ReadonlyMap<number, number>, rulebook: string): ImpactedOption[] => options
		.filter((option) => ((option.rulebook === rulebook) && ((counts.get(option.id) ?? 0) > 0)))
		.map((option) => ({
			id: option.id,
			name: {
				key: option.key,
				name: option.name
			},
			characters: (counts.get(option.id) ?? 0)
		}));

	return(turnedOff.flatMap((rulebook): ChangeImpact[] =>
	{
		const impact: ChangeImpact = {
			changeIndex,
			kind: 'rulebook',
			rulebook,
			races: impacted(bookRaces, raceCounts, rulebook),
			classes: impacted(bookClasses, classCounts, rulebook),
			items: impacted(bookItems, itemCounts, rulebook)
		};

		return((((impact.races.length + impact.classes.length + impact.items.length) > 0) ? [impact] : []));
	}));
}

/**
 * The live races, classes or items that a universe's draft disables or deletes with characters using them
 *
 * @param kind What they are
 * @param universeId The universe's ID
 * @param changeIndex The applyDraft change's place in the save
 * @param load Loads every one of them in a version
 * @param table Their table, whose draft rows map back to the live rows they came from
 * @param count Counts the characters using each of some of them
 * @return Their impacts
 */
async function draftOptionImpacts(kind: 'race' | 'class' | 'item', universeId: string, changeIndex: number, load: (version: UniverseVersion) => Promise<(OptionName & { id: number; enabled: boolean })[]>, table: typeof races | typeof classes | typeof items, count: (universeId: string, ids: readonly number[]) => Promise<Map<number, number>>): Promise<ChangeImpact[]>
{
	const [liveOptions, draftOptions, origins] = await Promise.all([
		load(liveVersion(universeId)),
		load(draftVersion(universeId)),
		findDraftOrigins<number>(table, universeId)
	]);

	// A default's ID is the same in both, and the draft's own rows map back to the live rows they came from
	const inDraft = new Map(draftOptions.map((option) => [(origins.get(option.id) ?? option.id), option]));
	const disabled = liveOptions.filter((option) => (option.enabled && !(inDraft.get(option.id)?.enabled ?? false)));
	const counts = await count(universeId, disabled.map(({ id }) => id));

	return(disabled.flatMap((option): ChangeImpact[] =>
	{
		const characters = (counts.get(option.id) ?? 0);
		const named = (inDraft.get(option.id) ?? option);

		return(((characters > 0) ? [{
			changeIndex,
			kind,
			id: option.id,
			name: {
				key: named.key,
				name: named.name
			},
			characters
		}] : []));
	}));
}

/**
 * The group size a universe's draft gives it, when it is lower than the live one, with how many groups
 * are larger
 *
 * @param liveUniverse The universe, with its live version's settings
 * @param draftUniverse The universe, with its draft's settings
 * @param changeIndex The applyDraft change's place in the save
 * @return Its impact
 */
async function draftGroupSizeImpacts(liveUniverse: EditableUniverseDetails, draftUniverse: EditableUniverseDetails, changeIndex: number): Promise<ChangeImpact[]>
{
	const groupSize = draftUniverse.groupSize;

	if (groupSize >= liveUniverse.groupSize)
	{
		return([]);
	}

	const groups = await countGroupsLargerThan(liveUniverse.id, groupSize);

	return(((groups > 0) ? [{ changeIndex, kind: 'groupSize', groupSize, groups }] : []));
}

/**
 * The live areas outside the lobby that a universe's draft disables or deletes, with characters in them,
 * playing or saved, and those it puts below the lobby region with group characters in them
 *
 * @param liveUniverse The universe, with its live version's settings
 * @param changeIndex The applyDraft change's place in the save
 * @return Their impacts
 */
async function draftAreaImpacts(liveUniverse: EditableUniverseDetails, changeIndex: number): Promise<ChangeImpact[]>
{
	const universeId = liveUniverse.id;
	const [liveAreas, draftAreas, origins] = await Promise.all([
		listAreas(liveVersion(universeId)),
		listAreas(draftVersion(universeId)),
		findDraftOrigins<string>(areas, universeId)
	]);
	const liveIdOf = (id: string): string => (origins.get(id) ?? id);

	// The areas once the draft is applied, by their live IDs, enabled as worked out in the draft; those it
	// deletes are there, disabled, so the parent of a deleted area can be found
	const inDraft = new Map(areasInTree(draftAreas).map((area) => [liveIdOf(area.id), {
		...area,
		id: liveIdOf(area.id),
		parentAreaId: ((area.parentAreaId === null) ? null : liveIdOf(area.parentAreaId))
	}]));
	const draftNames = new Map(draftAreas.map((area) => [liveIdOf(area.id), area.name]));
	const tree = areasById([...inDraft.values(), ...areasInTree(liveAreas)
		.filter((area) => !inDraft.has(area.id))
		.map((area) => ({ ...area, enabled: false }))]);
	const lobbyInDraft = new Set(draftAreas
		.filter((area) => area.resolved.lobby)
		.map((area) => liveIdOf(area.id)));
	const entering = liveAreas.filter((area) => (!area.resolved.lobby && lobbyInDraft.has(area.id)));
	const enteringIds = new Set(entering.map(({ id }) => id));
	const disabled = liveAreas.filter((area) => (area.resolved.enabled && !area.resolved.lobby && !enteringIds.has(area.id) && !(inDraft.get(area.id)?.enabled ?? false)));
	const areaIds = [...disabled, ...entering].map(({ id }) => id);
	const saved = (await listMembersInAreas(areaIds)).map(({ characterId, areaId }) => ({ characterId, areaId }));
	const counts = countCharactersInAreas(saved, areaOccupants.list(universeId), areaIds);

	return([
		...disabled.flatMap((area): ChangeImpact[] =>
		{
			const characters = (counts.get(area.id) ?? 0);

			return(((characters > 0) ? [{
				changeIndex,
				kind: 'area',
				id: area.id,
				name: (draftNames.get(area.id) ?? area.name),
				characters,
				hasParent: (enabledAncestor(tree, area.id) !== undefined)
			}] : []));
		}),
		...entering.flatMap((area): ChangeImpact[] =>
		{
			const characters = (counts.get(area.id) ?? 0);

			return(((characters > 0) ? [{
				changeIndex,
				kind: 'lobbyArea',
				id: area.id,
				name: (draftNames.get(area.id) ?? area.name),
				characters
			}] : []));
		})
	]);
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
	if (!changes.some((change) => ((change.kind === 'saveRace') && !change.settings.enabled)))
	{
		return([]);
	}

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
	if (!changes.some((change) => ((change.kind === 'saveClass') && !change.settings.enabled)))
	{
		return([]);
	}

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
 * The areas outside the lobby that the changes disable with characters in them, playing or saved, and
 * the areas they put below the lobby region with group characters in them. Lobby players in a lobby area
 * disabled go back to the lobby's starting square, which needs no choice
 *
 * @param universe The universe
 * @param changes The changes
 * @return Their impacts
 */
async function areaImpacts(universe: EditableUniverseDetails, changes: readonly EditorChange[]): Promise<ChangeImpact[]>
{
	const placeKinds: ReadonlySet<EditorChange['kind']> = new Set(['updateRegion', 'deleteRegion', 'createArea', 'updateArea', 'deleteArea']);
	const changesLobby = changes.some((change) => ((change.kind === 'universe') && (change.update.lobbyRegionId !== undefined)));

	if (!changesLobby && !changes.some((change) => placeKinds.has(change.kind)))
	{
		return([]);
	}

	const live = liveVersion(universe.id);
	const { world } = await loadPlaceWorld(live, universe.ruleset, universe.lobbyRegionId);
	const lobbyBefore = lobbyAreaIds(new PlaceGraph(world.regions, world.areas), universe.lobbyRegionId);
	const model = new PlaceModel(world);
	const disabledAt = findDisabledAreas(model, changes);
	const enteredAt = findLobbyEntries(new PlaceModel(world), changes);

	for (const areaId of lobbyBefore)
	{
		disabledAt.delete(areaId);
	}

	const areaIds = [...new Set([...disabledAt.keys(), ...enteredAt.keys()])];
	const saved = (await listMembersInAreas(areaIds)).map(({ characterId, areaId }) => ({ characterId, areaId }));
	const counts = countCharactersInAreas(saved, areaOccupants.list(universe.id), areaIds);
	const enabled = enabledAreaIds(model.graph());
	const byId = areasById(model.allAreas().map((area) => ({
		id: area.id,
		parentAreaId: (area.parents.find((parent) => (parent.kind === 'area'))?.id ?? null),
		enabled: enabled.has(area.id)
	})));
	const nameOfArea = (id: string): string => (model.area(id)?.name ?? '');

	return([
		...[...disabledAt]
			.filter(([id]) => !enteredAt.has(id))
			.flatMap(([id, changeIndex]): ChangeImpact[] =>
			{
				const characters = (counts.get(id) ?? 0);

				return(((characters > 0)
					? [{
						changeIndex,
						kind: 'area',
						id,
						name: nameOfArea(id),
						characters,
						hasParent: (enabledAncestor(byId, id) !== undefined)
					}]
					: []));
			}),
		...[...enteredAt].flatMap(([id, changeIndex]): ChangeImpact[] =>
		{
			const characters = (counts.get(id) ?? 0);

			return(((characters > 0)
				? [{
					changeIndex,
					kind: 'lobbyArea',
					id,
					name: nameOfArea(id),
					characters
				}]
				: []));
		})
	]);
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

	const groups = await countGroupsLargerThan(universe.id, groupSize);

	return(((groups > 0) ? [{ changeIndex, kind: 'groupSize', groupSize, groups }] : []));
}
