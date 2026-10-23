/**
 * The world editor's routes for a universe's difficulty levels (listed in shared/src/editor.ts)
 */
import type express from 'express';
import type { Request, Response } from 'express';
import { canEditUniverseSettings, defineMessages, MAX_DIFFICULTY_LEVELS, type CreatedPayload, type DifficultyLevelListPayload } from '@multiverse-kiln/shared';

import { countDifficultyLevels, createDifficultyLevel, deleteDifficultyLevel, findDefaultDifficultyLevel, findDifficultyLevel, listDifficultyLevels, updateDifficultyLevel } from '../db/difficultyRepo.js';
import { moveGroupsToDifficultyLevel } from '../db/groupRepo.js';
import { inTransaction } from '../db/transactions.js';
import { lockUniverse } from '../db/universeRepo.js';
import { requireRole, universeContextOf } from './editorAccess.js';
import { difficultyLevelIdParameter, difficultyLevelSettings } from './editorPayloads.js';
import { sendError, sendInvalidRequest, type Refusal } from './errors.js';

/**
 * Reasons the difficulty level routes give in more than one place (see shared/src/localization.ts)
 */
const messages = defineMessages({
	noSuchLevel: {
		id: 'error.noSuchDifficultyLevelToEdit',
		defaultMessage: 'The difficulty level doesn\'t exist.',
		description: 'Why a request about a difficulty level failed: it was deleted, perhaps by another editor'
	},
	levelNeedsName: {
		id: 'error.difficultyLevelNeedsName',
		defaultMessage: 'A difficulty level needs a name.',
		description: 'Why a difficulty level the universe added couldn\'t be saved: its name was left out'
	},
	needsDefault: {
		id: 'error.difficultyLevelNeedsDefault',
		defaultMessage: 'A universe needs a default difficulty level. Make another level the default instead.',
		description: 'Why the default difficulty level couldn\'t be deleted or stop being the default: exactly one level is always the default, so another one has to be made the default'
	}
});

/**
 * Adds the difficulty level routes to a universe's router
 *
 * @param router The router for routes under /:universeId
 */
export function addDifficultyLevelRoutes(router: express.Router): void
{
	router.get('/difficulty-levels', listLevels);
	router.post('/difficulty-levels', requireRole(canEditUniverseSettings), createLevel);
	router.put('/difficulty-levels/:levelId', requireRole(canEditUniverseSettings), saveLevel);
	router.delete('/difficulty-levels/:levelId', requireRole(canEditUniverseSettings), deleteLevel);
}

/**
 * GET /:universeId/difficulty-levels: every difficulty level of the universe
 *
 * @param request The request
 * @param response The response
 */
async function listLevels(request: Request, response: Response): Promise<void>
{
	const payload: DifficultyLevelListPayload = { difficultyLevels: await listDifficultyLevels(universeContextOf(request).universe.id) };

	response.json(payload);
}

/**
 * POST /:universeId/difficulty-levels: adds a difficulty level to the universe
 *
 * @param request The request
 * @param response The response
 */
async function createLevel(request: Request, response: Response): Promise<void>
{
	const body = difficultyLevelSettings.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const { universe } = universeContextOf(request);
	const { name } = body.data;

	if (name === null)
	{
		sendError(response, 400, messages.levelNeedsName);
		return;
	}

	const result = await inTransaction(async (transaction): Promise<Refusal | number> =>
	{
		await lockUniverse(universe.id, transaction);

		if (await countDifficultyLevels(universe.id, transaction) >= MAX_DIFFICULTY_LEVELS)
		{
			return({
				status: 409,
				message: {
					id: 'error.difficultyLevelLimit',
					defaultMessage: 'A universe can have at most {max, plural, one {# difficulty level} other {# difficulty levels}}.',
					description: 'Why a new difficulty level wasn\'t made: the universe has as many as allowed'
				},
				values: {
					max: MAX_DIFFICULTY_LEVELS
				}
			});
		}

		return(createDifficultyLevel(universe.id, { ...body.data, name }, transaction));
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
 * PUT /:universeId/difficulty-levels/:levelId: changes one of the universe's difficulty levels
 *
 * @param request The request
 * @param response The response
 */
async function saveLevel(request: Request, response: Response): Promise<void>
{
	const levelId = difficultyLevelIdParameter.safeParse(request.params.levelId);
	const body = difficultyLevelSettings.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const { universe } = universeContextOf(request);
	const refusal = await inTransaction(async (transaction): Promise<Refusal | undefined> =>
	{
		await lockUniverse(universe.id, transaction);

		const level = (levelId.success ? await findDifficultyLevel(universe.id, levelId.data, transaction) : undefined);

		if (!level)
		{
			return({ status: 404, message: messages.noSuchLevel });
		}

		if ((body.data.name === null) && (level.key === null))
		{
			return({ status: 400, message: messages.levelNeedsName });
		}

		if (level.isDefault && !body.data.isDefault)
		{
			return({ status: 409, message: messages.needsDefault });
		}

		await updateDifficultyLevel(universe.id, level.id, body.data, transaction);

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
 * DELETE /:universeId/difficulty-levels/:levelId: deletes a difficulty level that isn't the universe's
 * default, moving the groups playing at it to the default
 *
 * @param request The request
 * @param response The response
 */
async function deleteLevel(request: Request, response: Response): Promise<void>
{
	const levelId = difficultyLevelIdParameter.safeParse(request.params.levelId);
	const { universe } = universeContextOf(request);
	const refusal = await inTransaction(async (transaction): Promise<Refusal | undefined> =>
	{
		// Making a group waits for the universe's lock too, so nobody takes the level as it is deleted
		await lockUniverse(universe.id, transaction);

		const level = (levelId.success ? await findDifficultyLevel(universe.id, levelId.data, transaction) : undefined);

		if (!level)
		{
			return({ status: 404, message: messages.noSuchLevel });
		}

		const defaultLevel = await findDefaultDifficultyLevel(universe.id, transaction);

		if (!defaultLevel || (defaultLevel.id === level.id))
		{
			return({ status: 409, message: messages.needsDefault });
		}

		await moveGroupsToDifficultyLevel(level.id, defaultLevel.id, transaction);
		await deleteDifficultyLevel(universe.id, level.id, transaction);

		return(undefined);
	});

	if (refusal !== undefined)
	{
		sendError(response, refusal.status, refusal.message, refusal.values);
		return;
	}

	response.sendStatus(204);
}
