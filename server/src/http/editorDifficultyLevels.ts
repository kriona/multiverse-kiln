/**
 * The world editor's route for a universe's difficulty levels (listed in shared/src/editor.ts), and
 * saving changes to them (see editorChanges.ts)
 */
import type express from 'express';
import type { Request, Response } from 'express';
import { defineMessages, MAX_DIFFICULTY_LEVELS, type DifficultyLevelListPayload, type DifficultyLevelSettings, type NewRef, type NumberRef } from '@multiverse-kiln/shared';

import { countDifficultyLevels, createDifficultyLevel, deleteDifficultyLevel, findDefaultDifficultyLevel, findDifficultyLevel, listDifficultyLevels, updateDifficultyLevel } from '../db/difficultyRepo.js';
import { moveGroupsToDifficultyLevel } from '../db/groupRepo.js';
import { universeContextOf } from './editorAccess.js';
import { recordRef, refuse, resolveNumberRef, type ChangeContext } from './editorChangeContext.js';

/**
 * Reasons changes to difficulty levels give in more than one place (see shared/src/localization.ts)
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
 * Adds the difficulty level route to a universe's router
 *
 * @param router The router for routes under /:universeId
 */
export function addDifficultyLevelRoutes(router: express.Router): void
{
	router.get('/difficulty-levels', listLevels);
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
 * Adds a difficulty level to the universe
 *
 * @param context The save
 * @param ref The level's ref
 * @param settings Its settings
 */
export async function createDifficultyLevelChange(context: ChangeContext, ref: NewRef, settings: DifficultyLevelSettings): Promise<void>
{
	const { universe, transaction } = context;
	const { name } = settings;

	if (name === null)
	{
		refuse(400, messages.levelNeedsName);
	}

	if (await countDifficultyLevels(universe.id, transaction) >= MAX_DIFFICULTY_LEVELS)
	{
		refuse(409, {
			id: 'error.difficultyLevelLimit',
			defaultMessage: 'A universe can have at most {max, plural, one {# difficulty level} other {# difficulty levels}}.',
			description: 'Why a new difficulty level wasn\'t made: the universe has as many as allowed'
		}, {
			max: MAX_DIFFICULTY_LEVELS
		});
	}

	recordRef(context, ref, await createDifficultyLevel(universe.id, { ...settings, name }, transaction));
}

/**
 * Changes one of the universe's difficulty levels
 *
 * @param context The save
 * @param id The level
 * @param settings Its new settings
 */
export async function saveDifficultyLevelChange(context: ChangeContext, id: NumberRef, settings: DifficultyLevelSettings): Promise<void>
{
	const { universe, transaction } = context;
	const level = await findDifficultyLevel(universe.id, resolveNumberRef(context, id), transaction);

	if (!level)
	{
		refuse(404, messages.noSuchLevel);
	}

	if ((settings.name === null) && (level.key === null))
	{
		refuse(400, messages.levelNeedsName);
	}

	if (level.isDefault && !settings.isDefault)
	{
		refuse(409, messages.needsDefault);
	}

	await updateDifficultyLevel(universe.id, level.id, settings, transaction);
}

/**
 * Deletes a difficulty level that isn't the universe's default, moving the groups playing at it to the default
 *
 * @param context The save
 * @param id The level
 */
export async function removeDifficultyLevelChange(context: ChangeContext, id: NumberRef): Promise<void>
{
	const { universe, transaction } = context;

	// Making a group waits for the universe's lock too, so nobody takes the level as it is deleted
	const level = await findDifficultyLevel(universe.id, resolveNumberRef(context, id), transaction);

	if (!level)
	{
		refuse(404, messages.noSuchLevel);
	}

	const defaultLevel = await findDefaultDifficultyLevel(universe.id, transaction);

	if (!defaultLevel || (defaultLevel.id === level.id))
	{
		refuse(409, messages.needsDefault);
	}

	await moveGroupsToDifficultyLevel(level.id, defaultLevel.id, transaction);
	await deleteDifficultyLevel(universe.id, level.id, transaction);
}
