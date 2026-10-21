/**
 * The world editor's routes for a universe's races (listed in shared/src/editor.ts)
 */
import type express from 'express';
import type { Request, Response } from 'express';
import { canEditUniverseSettings, defineMessages, MAX_CUSTOM_RACES, type CreatedPayload, type RaceListPayload, type RaceSettings } from '@multiverse-kiln/shared';

import { hasCharactersOfRace } from '../db/characterRepo.js';
import type { Executor } from '../db/client.js';
import { countCustomRaces, createCustomRace, deleteCustomRace, findRaceKind, loadEditorRaces, restoreDefaultRace, saveEditedDefaultRace, updateCustomRace } from '../db/raceRepo.js';
import { inTransaction } from '../db/transactions.js';
import { lockUniverse } from '../db/universeRepo.js';
import { requireRole, universeContextOf, type UniverseContext } from './editorAccess.js';
import { raceIdParameter, raceSettings } from './editorPayloads.js';
import { findStartingProblem } from './editorStartingExtras.js';
import { sendError, sendInvalidRequest, type Refusal } from './errors.js';

/**
 * Reasons the race routes give in more than one place (see shared/src/localization.ts)
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
 * Adds the race routes to a universe's router
 *
 * @param router The router for routes under /:universeId
 */
export function addRaceRoutes(router: express.Router): void
{
	router.get('/races', listRaces);
	router.post('/races', requireRole(canEditUniverseSettings), createRaceRoute);
	router.put('/races/:raceId', requireRole(canEditUniverseSettings), saveRace);
	router.delete('/races/:raceId', requireRole(canEditUniverseSettings), deleteRace);
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
 * POST /:universeId/races: adds a race to the universe
 *
 * @param request The request
 * @param response The response
 */
async function createRaceRoute(request: Request, response: Response): Promise<void>
{
	const { universe } = universeContextOf(request);
	const body = raceSettings[universe.ruleset].safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const { name } = body.data;

	if (name === null)
	{
		sendError(response, 400, messages.raceNeedsName);
		return;
	}

	const result = await inTransaction(async (transaction): Promise<Refusal | number> =>
	{
		await lockUniverse(universe.id, transaction);

		if (await countCustomRaces(universe.id, transaction) >= MAX_CUSTOM_RACES)
		{
			return({
				status: 409,
				message: {
					id: 'error.raceLimit',
					defaultMessage: 'A universe can have at most {max, plural, one {# race} other {# races}} of its own.',
					description: 'Why a new race wasn\'t made: the universe has as many races of its own as allowed'
				},
				values: { max: MAX_CUSTOM_RACES }
			});
		}

		const problem = await findRaceProblem(universe, undefined, body.data, transaction);

		if (problem !== undefined)
		{
			return(problem);
		}

		return(createCustomRace(universe.id, universe.ruleset, { ...body.data, name }, transaction));
	});

	if (typeof result !== 'number')
	{
		sendError(response, result.status, result.message, result.values);
		return;
	}

	const payload: CreatedPayload<number> = { id: result };

	response.status(201).json(payload);
}

/**
 * PUT /:universeId/races/:raceId: changes one of the universe's races, or stores its edited copy of a default race
 *
 * @param request The request
 * @param response The response
 */
async function saveRace(request: Request, response: Response): Promise<void>
{
	const raceId = raceIdParameter.safeParse(request.params.raceId);
	const { universe } = universeContextOf(request);
	const body = raceSettings[universe.ruleset].safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const kind = (raceId.success ? await findRaceKind(universe.id, universe.ruleset, raceId.data) : undefined);

	if (!raceId.success || (kind === undefined))
	{
		sendError(response, 404, messages.noSuchRace);
		return;
	}

	const { name } = body.data;

	if ((kind === 'custom') && (name === null))
	{
		sendError(response, 400, messages.raceNeedsName);
		return;
	}

	const refusal = await inTransaction(async (transaction) =>
	{
		// Deleting an item waits for the universe's lock too, so an item can't be deleted as it is added here
		await lockUniverse(universe.id, transaction);

		const problem = await findRaceProblem(universe, raceId.data, body.data, transaction);

		if (problem !== undefined)
		{
			return(problem);
		}

		if (kind === 'default')
		{
			await saveEditedDefaultRace(universe.id, universe.ruleset, raceId.data, body.data, transaction);
		}
		else if (name !== null)
		{
			await updateCustomRace(universe.id, universe.ruleset, raceId.data, { ...body.data, name }, transaction);
		}

		return(undefined);
	});

	if (refusal !== undefined)
	{
		sendError(response, refusal.status, refusal.message, refusal.values);
		return;
	}

	response.sendStatus(204);
}

/**
 * DELETE /:universeId/races/:raceId: deletes one of the universe's own races, or restores a default race
 * the universe has edited
 *
 * @param request The request
 * @param response The response
 */
async function deleteRace(request: Request, response: Response): Promise<void>
{
	const raceId = raceIdParameter.safeParse(request.params.raceId);
	const { universe } = universeContextOf(request);
	const kind = (raceId.success ? await findRaceKind(universe.id, universe.ruleset, raceId.data) : undefined);

	if (!raceId.success || (kind === undefined))
	{
		sendError(response, 404, messages.noSuchRace);
		return;
	}

	// Default races are enabled, so restoring one never leaves the universe without an enabled race
	if (kind === 'default')
	{
		await restoreDefaultRace(universe.id, raceId.data);
		response.sendStatus(204);
		return;
	}

	const refusal = await inTransaction(async (transaction) =>
	{
		// Making a character waits for the universe's lock too, so nobody becomes the race as it is deleted
		await lockUniverse(universe.id, transaction);

		if (await hasCharactersOfRace(raceId.data, transaction))
		{
			return(messages.raceInUse);
		}

		const others = (await loadEditorRaces(universe.id, universe.ruleset, transaction)).filter((race) => (race.id !== raceId.data));

		if (!others.some((race) => race.enabled))
		{
			return(messages.noEnabledRace);
		}

		await deleteCustomRace(universe.id, raceId.data, transaction);

		return(undefined);
	});

	if (refusal !== undefined)
	{
		sendError(response, 409, refusal);
		return;
	}

	response.sendStatus(204);
}

/**
 * Why a race's settings can't be saved: a starting area or item the universe can't use, or leaving the
 * universe without an enabled race
 *
 * @param universe The universe
 * @param raceId The race being changed, or undefined for a new one
 * @param settings The race's new settings
 * @param executor A transaction holding the universe's lock
 * @return Why, or undefined when they can be saved
 */
async function findRaceProblem(universe: UniverseContext['universe'], raceId: number | undefined, settings: RaceSettings, executor: Executor): Promise<Refusal | undefined>
{
	const startingProblem = await findStartingProblem(universe, {
		areaIds: ((settings.startingAreaId === null) ? [] : [settings.startingAreaId]),
		itemIds: settings.startingItems.map(({ itemId }) => itemId)
	}, executor);

	if (startingProblem !== undefined)
	{
		return({
			status: 400,
			message: startingProblem
		});
	}

	if (!settings.enabled && !(await loadEditorRaces(universe.id, universe.ruleset, executor)).some((race) => ((race.id !== raceId) && race.enabled)))
	{
		return({
			status: 409,
			message: messages.noEnabledRace
		});
	}

	return(undefined);
}
