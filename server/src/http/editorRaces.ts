/**
 * The world editor's route for a universe's races (listed in shared/src/editor.ts), and saving changes
 * to them (see editorChanges.ts)
 */
import type express from 'express';
import type { Request, Response } from 'express';
import { defineMessages, MAX_CUSTOM_RACES, type NewRef, type NumberRef, type RaceListPayload, type RaceSettings } from '@multiverse-kiln/shared';

import { hasCharactersOfRace } from '../db/characterRepo.js';
import { countCustomRaces, createCustomRace, deleteCustomRace, findRaceKind, loadEditorRaces, restoreDefaultRace, saveEditedDefaultRace, updateCustomRace } from '../db/raceRepo.js';
import { universeContextOf } from './editorAccess.js';
import { recordRef, refuse, resolveNumberRef, type ChangeContext } from './editorChangeContext.js';
import { checkStartingReferences } from './editorStartingExtras.js';

/**
 * Reasons changes to races give in more than one place (see shared/src/localization.ts)
 */
const messages = defineMessages({
	noSuchRace: {
		id: 'error.noSuchRace',
		defaultMessage: 'The race doesn\'t exist.',
		description: 'Why a request about a race (such as elf or dwarf) failed: it was deleted, perhaps by another editor'
	},
	raceNeedsName: {
		id: 'error.raceNeedsName',
		defaultMessage: 'A race needs a name.',
		description: 'Why a race the universe added couldn\'t be saved: its name was left out'
	},
	noEnabledRace: {
		id: 'error.noEnabledRace',
		defaultMessage: 'A universe needs at least one enabled race, so new characters have one to be.',
		description: 'Why a race couldn\'t be disabled or deleted: it is the last race new characters can choose'
	},
	raceInUse: {
		id: 'error.raceInUse',
		defaultMessage: 'Characters are this race, so it can\'t be deleted. Disable it instead.',
		description: 'Why a race the universe added couldn\'t be deleted: players have made characters of it; disabling it only stops new characters choosing it'
	}
});

/**
 * Adds the race route to a universe's router
 *
 * @param router The router for routes under /:universeId
 */
export function addRaceRoutes(router: express.Router): void
{
	router.get('/races', listRaces);
}

/**
 * GET /:universeId/races: every race the universe can use
 *
 * @param request The request
 * @param response The response
 */
async function listRaces(request: Request, response: Response): Promise<void>
{
	const { universe } = universeContextOf(request);
	const payload: RaceListPayload = { races: await loadEditorRaces(universe.id, universe.ruleset) };

	response.json(payload);
}

/**
 * Adds a race to the universe
 *
 * @param context The save
 * @param ref The race's ref
 * @param settings Its settings
 */
export async function createRaceChange(context: ChangeContext, ref: NewRef, settings: RaceSettings): Promise<void>
{
	const { universe, transaction } = context;
	const { name } = settings;

	if (name === null)
	{
		refuse(400, messages.raceNeedsName);
	}

	if (await countCustomRaces(universe.id, transaction) >= MAX_CUSTOM_RACES)
	{
		refuse(409, {
			id: 'error.raceLimit',
			defaultMessage: 'A universe can have at most {max, plural, one {# race} other {# races}} of its own.',
			description: 'Why a new race wasn\'t made: the universe has as many races of its own as allowed'
		}, {
			max: MAX_CUSTOM_RACES
		});
	}

	await checkRace(context, undefined, settings);
	recordRef(context, ref, await createCustomRace(universe.id, universe.ruleset, { ...settings, name }, transaction));
}

/**
 * Changes one of the universe's races, or stores its edited copy of a default race
 *
 * @param context The save
 * @param id The race
 * @param settings Its new settings
 */
export async function saveRaceChange(context: ChangeContext, id: NumberRef, settings: RaceSettings): Promise<void>
{
	const { universe, transaction } = context;
	const raceId = resolveNumberRef(context, id);
	const kind = await findRaceKind(universe.id, universe.ruleset, raceId, transaction);
	const { name } = settings;

	if (kind === undefined)
	{
		refuse(404, messages.noSuchRace);
	}

	if ((kind === 'custom') && (name === null))
	{
		refuse(400, messages.raceNeedsName);
	}

	await checkRace(context, raceId, settings);

	if (kind === 'default')
	{
		await saveEditedDefaultRace(universe.id, universe.ruleset, raceId, settings, transaction);
	}
	else if (name !== null)
	{
		await updateCustomRace(universe.id, universe.ruleset, raceId, { ...settings, name }, transaction);
	}
}

/**
 * Deletes one of the universe's own races, or restores a default race the universe has edited
 *
 * @param context The save
 * @param id The race
 */
export async function removeRaceChange(context: ChangeContext, id: NumberRef): Promise<void>
{
	const { universe, transaction } = context;
	const raceId = resolveNumberRef(context, id);
	const kind = await findRaceKind(universe.id, universe.ruleset, raceId, transaction);

	if (kind === undefined)
	{
		refuse(404, messages.noSuchRace);
	}

	// Default races are enabled, so restoring one never leaves the universe without an enabled race
	if (kind === 'default')
	{
		await restoreDefaultRace(universe.id, raceId, transaction);
		return;
	}

	// Making a character waits for the universe's lock too, so nobody becomes the race as it is deleted
	if (await hasCharactersOfRace(raceId, transaction))
	{
		refuse(409, messages.raceInUse);
	}

	const others = (await loadEditorRaces(universe.id, universe.ruleset, transaction)).filter((race) => (race.id !== raceId));

	if (!others.some((race) => race.enabled))
	{
		refuse(409, messages.noEnabledRace);
	}

	await deleteCustomRace(universe.id, raceId, transaction);
}

/**
 * Refuses a race's settings with a starting area or item the universe can't use, or that leave the
 * universe without an enabled race
 *
 * @param context The save
 * @param raceId The race being changed, or undefined for a new one
 * @param settings The race's new settings
 */
async function checkRace(context: ChangeContext, raceId: number | undefined, settings: RaceSettings): Promise<void>
{
	const { universe, transaction } = context;

	await checkStartingReferences(context, {
		areaIds: ((settings.startingAreaId === null) ? [] : [settings.startingAreaId]),
		itemIds: settings.startingItems.map(({ itemId }) => itemId)
	});

	if (!settings.enabled && !(await loadEditorRaces(universe.id, universe.ruleset, transaction)).some((race) => ((race.id !== raceId) && race.enabled)))
	{
		refuse(409, messages.noEnabledRace);
	}
}
