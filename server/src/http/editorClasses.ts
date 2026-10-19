/**
 * The world editor's routes for a universe's classes (listed in shared/src/editor.ts)
 */
import type express from 'express';
import type { Request, Response } from 'express';
import { canEditUniverseSettings, defineMessages, MAX_CUSTOM_CLASSES, type ClassListPayload, type ClassSettings, type CreatedPayload } from '@multiverse-kiln/shared';

import { hasCharactersOfClass } from '../db/characterRepo.js';
import type { Executor } from '../db/client.js';
import { countCustomClasses, createCustomClass, deleteCustomClass, findClassKind, loadEditorClasses, restoreDefaultClass, saveEditedDefaultClass, updateCustomClass } from '../db/classRepo.js';
import { loadEditorRaces } from '../db/raceRepo.js';
import { inTransaction } from '../db/transactions.js';
import { lockUniverse } from '../db/universeRepo.js';
import { requireRole, universeContextOf, type UniverseContext } from './editorAccess.js';
import { classIdParameter, classSettings } from './editorPayloads.js';
import { findStartingProblem } from './editorStartingExtras.js';
import { sendError, sendInvalidRequest, type Refusal } from './errors.js';

/**
 * Reasons the class routes give in more than one place (see shared/src/localization.ts)
 */
const messages = defineMessages({
	noSuchClass: {
		id: 'error.noSuchClass',
		defaultMessage: 'The class doesn\'t exist.',
		description: 'Why a request about a character class (such as fighter or wizard) failed: it was deleted, perhaps by another editor'
	},
	classNeedsName: {
		id: 'error.classNeedsName',
		defaultMessage: 'A class needs a name.',
		description: 'Why a character class the universe added couldn\'t be saved: its name was left out'
	},
	noEnabledClass: {
		id: 'error.noEnabledClass',
		defaultMessage: 'A universe needs at least one enabled class, so new characters have one to be.',
		description: 'Why a character class couldn\'t be disabled or deleted: it is the last class new characters can choose'
	},
	classInUse: {
		id: 'error.classInUse',
		defaultMessage: 'Characters are this class, so it can\'t be deleted. Disable it instead.',
		description: 'Why a character class the universe added couldn\'t be deleted: players have made characters of it; disabling it only stops new characters choosing it'
	}
});

/**
 * Adds the class routes to a universe's router
 *
 * @param router The router for routes under /:universeId
 */
export function addClassRoutes(router: express.Router): void
{
	router.get('/classes', listClasses);
	router.post('/classes', requireRole(canEditUniverseSettings), createClassRoute);
	router.put('/classes/:classId', requireRole(canEditUniverseSettings), saveClass);
	router.delete('/classes/:classId', requireRole(canEditUniverseSettings), deleteClass);
}

/**
 * GET /:universeId/classes: every class the universe can use
 *
 * @param request The request
 * @param response The response
 */
async function listClasses(request: Request, response: Response): Promise<void>
{
	const { universe } = universeContextOf(request);
	const payload: ClassListPayload = { classes: await loadEditorClasses(universe.id, universe.ruleset) };

	response.json(payload);
}

/**
 * POST /:universeId/classes: adds a class to the universe
 *
 * @param request The request
 * @param response The response
 */
async function createClassRoute(request: Request, response: Response): Promise<void>
{
	const body = classSettings.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const { universe } = universeContextOf(request);
	const { name } = body.data;

	if (name === null)
	{
		sendError(response, 400, messages.classNeedsName);
		return;
	}

	const result = await inTransaction(async (transaction): Promise<Refusal | number> =>
	{
		await lockUniverse(universe.id, transaction);

		if (await countCustomClasses(universe.id, transaction) >= MAX_CUSTOM_CLASSES)
		{
			return({
				status: 409,
				message: {
					id: 'error.classLimit',
					defaultMessage: 'A universe can have at most {max, plural, one {# class} other {# classes}} of its own.',
					description: 'Why a new character class wasn\'t made: the universe has as many classes of its own as allowed'
				},
				values: { max: MAX_CUSTOM_CLASSES }
			});
		}

		const problem = await findClassProblem(universe, undefined, body.data, transaction);

		if (problem !== undefined)
		{
			return(problem);
		}

		return(createCustomClass(universe.id, universe.ruleset, { ...body.data, name }, transaction));
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
 * PUT /:universeId/classes/:classId: changes one of the universe's classes, or stores its edited copy of
 * a default class
 *
 * @param request The request
 * @param response The response
 */
async function saveClass(request: Request, response: Response): Promise<void>
{
	const classId = classIdParameter.safeParse(request.params.classId);
	const body = classSettings.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const { universe } = universeContextOf(request);
	const kind = (classId.success ? await findClassKind(universe.id, universe.ruleset, classId.data) : undefined);

	if (!classId.success || (kind === undefined))
	{
		sendError(response, 404, messages.noSuchClass);
		return;
	}

	const { name } = body.data;

	if ((kind === 'custom') && (name === null))
	{
		sendError(response, 400, messages.classNeedsName);
		return;
	}

	const refusal = await inTransaction(async (transaction) =>
	{
		// Deleting an item or a race waits for the universe's lock too, so neither can be deleted as it is added here
		await lockUniverse(universe.id, transaction);

		const problem = await findClassProblem(universe, classId.data, body.data, transaction);

		if (problem !== undefined)
		{
			return(problem);
		}

		if (kind === 'default')
		{
			await saveEditedDefaultClass(universe.id, universe.ruleset, classId.data, body.data, transaction);
		}
		else if (name !== null)
		{
			await updateCustomClass(universe.id, classId.data, { ...body.data, name }, transaction);
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
 * DELETE /:universeId/classes/:classId: deletes one of the universe's own classes, or restores a default
 * class the universe has edited
 *
 * @param request The request
 * @param response The response
 */
async function deleteClass(request: Request, response: Response): Promise<void>
{
	const classId = classIdParameter.safeParse(request.params.classId);
	const { universe } = universeContextOf(request);
	const kind = (classId.success ? await findClassKind(universe.id, universe.ruleset, classId.data) : undefined);

	if (!classId.success || (kind === undefined))
	{
		sendError(response, 404, messages.noSuchClass);
		return;
	}

	// Default classes are enabled, so restoring one never leaves the universe without an enabled class
	if (kind === 'default')
	{
		await restoreDefaultClass(universe.id, classId.data);
		response.sendStatus(204);
		return;
	}

	const refusal = await inTransaction(async (transaction) =>
	{
		// Making a character waits for the universe's lock too, so nobody becomes the class as it is deleted
		await lockUniverse(universe.id, transaction);

		if (await hasCharactersOfClass(classId.data, transaction))
		{
			return(messages.classInUse);
		}

		const others = (await loadEditorClasses(universe.id, universe.ruleset, transaction)).filter((characterClass) => (characterClass.id !== classId.data));

		if (!others.some((characterClass) => characterClass.enabled))
		{
			return(messages.noEnabledClass);
		}

		await deleteCustomClass(universe.id, classId.data, transaction);

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
 * Why a class's settings can't be saved: a starting area, item or race the universe can't use, or
 * leaving the universe without an enabled class
 *
 * @param universe The universe
 * @param classId The class being changed, or undefined for a new one
 * @param settings The class's new settings
 * @param executor A transaction holding the universe's lock
 * @return Why, or undefined when they can be saved
 */
async function findClassProblem(universe: UniverseContext['universe'], classId: number | undefined, settings: ClassSettings, executor: Executor): Promise<Refusal | undefined>
{
	const startingProblem = await findStartingProblem(universe, {
		areaIds: [
			...((settings.startingAreaId === null) ? [] : [settings.startingAreaId]),
			...settings.raceAreas.map(({ areaId }) => areaId)
		],
		itemIds: settings.startingItems.map(({ itemId }) => itemId)
	}, executor);

	if (startingProblem !== undefined)
	{
		return({
			status: 400,
			message: startingProblem
		});
	}

	if (settings.raceAreas.length > 0)
	{
		const raceIds = new Set((await loadEditorRaces(universe.id, universe.ruleset, executor)).map((race) => race.id));

		if (!settings.raceAreas.every(({ raceId }) => raceIds.has(raceId)))
		{
			return({
				status: 400,
				message: {
					id: 'error.unknownRaceArea',
					defaultMessage: 'A starting area is chosen for a race this universe doesn\'t have.',
					description: 'Why a character class\'s settings were refused: one of its areas for a race is for a race that was deleted, perhaps by another editor'
				}
			});
		}
	}

	if (!settings.enabled && !(await loadEditorClasses(universe.id, universe.ruleset, executor)).some((characterClass) => ((characterClass.id !== classId) && characterClass.enabled)))
	{
		return({
			status: 409,
			message: messages.noEnabledClass
		});
	}

	return(undefined);
}
