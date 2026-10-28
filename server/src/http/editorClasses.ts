/**
 * The world editor's route for a universe's classes (listed in shared/src/editor.ts), and saving
 * changes to them (see editorChanges.ts)
 */
import type express from 'express';
import type { Request, Response } from 'express';
import { defineMessages, MAX_CUSTOM_CLASSES, type ClassListPayload, type ClassSettings, type NewRef, type NumberRef } from '@multiverse-kiln/shared';

import { hasCharactersOfClass } from '../db/characterRepo.js';
import { countCustomClasses, createCustomClass, deleteCustomClass, findClassKind, loadEditorClasses, restoreDefaultClass, saveEditedDefaultClass, updateCustomClass } from '../db/classRepo.js';
import { loadEditorRaces } from '../db/raceRepo.js';
import { universeContextOf } from './editorAccess.js';
import { recordRef, refuse, resolveNumberRef, type ChangeContext } from './editorChangeContext.js';
import { checkStartingReferences } from './editorStartingExtras.js';

/**
 * Reasons changes to classes give in more than one place (see shared/src/localization.ts)
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
 * Adds the class route to a universe's router
 *
 * @param router The router for routes under /:universeId
 */
export function addClassRoutes(router: express.Router): void
{
	router.get('/classes', listClasses);
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
 * Adds a class to the universe
 *
 * @param context The save
 * @param ref The class's ref
 * @param settings Its settings
 */
export async function createClassChange(context: ChangeContext, ref: NewRef, settings: ClassSettings): Promise<void>
{
	const { universe, transaction } = context;
	const { name } = settings;

	if (name === null)
	{
		refuse(400, messages.classNeedsName);
	}

	if (await countCustomClasses(universe.id, transaction) >= MAX_CUSTOM_CLASSES)
	{
		refuse(409, {
			id: 'error.classLimit',
			defaultMessage: 'A universe can have at most {max, plural, one {# class} other {# classes}} of its own.',
			description: 'Why a new character class wasn\'t made: the universe has as many classes of its own as allowed'
		}, {
			max: MAX_CUSTOM_CLASSES
		});
	}

	await checkClass(context, undefined, settings);
	recordRef(context, ref, await createCustomClass(universe.id, universe.ruleset, { ...settings, name }, transaction));
}

/**
 * Changes one of the universe's classes, or stores its edited copy of a default class
 *
 * @param context The save
 * @param id The class
 * @param settings Its new settings
 */
export async function saveClassChange(context: ChangeContext, id: NumberRef, settings: ClassSettings): Promise<void>
{
	const { universe, transaction } = context;
	const classId = resolveNumberRef(context, id);
	const kind = await findClassKind(universe.id, universe.ruleset, classId, transaction);
	const { name } = settings;

	if (kind === undefined)
	{
		refuse(404, messages.noSuchClass);
	}

	if ((kind === 'custom') && (name === null))
	{
		refuse(400, messages.classNeedsName);
	}

	// Deleting an item or a race waits for the universe's lock too, so neither can be deleted as it is added here
	await checkClass(context, classId, settings);

	if (kind === 'default')
	{
		await saveEditedDefaultClass(universe.id, universe.ruleset, classId, settings, transaction);
	}
	else if (name !== null)
	{
		await updateCustomClass(universe.id, universe.ruleset, classId, { ...settings, name }, transaction);
	}
}

/**
 * Deletes one of the universe's own classes, or restores a default class the universe has edited
 *
 * @param context The save
 * @param id The class
 */
export async function removeClassChange(context: ChangeContext, id: NumberRef): Promise<void>
{
	const { universe, transaction } = context;
	const classId = resolveNumberRef(context, id);
	const kind = await findClassKind(universe.id, universe.ruleset, classId, transaction);

	if (kind === undefined)
	{
		refuse(404, messages.noSuchClass);
	}

	// Default classes are enabled, so restoring one never leaves the universe without an enabled class
	if (kind === 'default')
	{
		await restoreDefaultClass(universe.id, classId, transaction);
		return;
	}

	// Making a character waits for the universe's lock too, so nobody becomes the class as it is deleted
	if (await hasCharactersOfClass(classId, transaction))
	{
		refuse(409, messages.classInUse);
	}

	const others = (await loadEditorClasses(universe.id, universe.ruleset, transaction)).filter((characterClass) => (characterClass.id !== classId));

	if (!others.some((characterClass) => characterClass.enabled))
	{
		refuse(409, messages.noEnabledClass);
	}

	await deleteCustomClass(universe.id, classId, transaction);
}

/**
 * Refuses a class's settings with a starting area, item or race the universe can't use, or that leave
 * the universe without an enabled class
 *
 * @param context The save
 * @param classId The class being changed, or undefined for a new one
 * @param settings The class's new settings
 */
async function checkClass(context: ChangeContext, classId: number | undefined, settings: ClassSettings): Promise<void>
{
	const { universe, transaction } = context;

	await checkStartingReferences(context, {
		areaIds: [
			...((settings.startingAreaId === null) ? [] : [settings.startingAreaId]),
			...settings.raceAreas.map(({ areaId }) => areaId)
		],
		itemIds: settings.startingItems.map(({ itemId }) => itemId)
	});

	if (settings.raceAreas.length > 0)
	{
		const raceIds = new Set((await loadEditorRaces(universe.id, universe.ruleset, transaction)).map((race) => race.id));

		if (!settings.raceAreas.every(({ raceId }) => raceIds.has(raceId)))
		{
			refuse(400, {
				id: 'error.unknownRaceArea',
				defaultMessage: 'A starting area is chosen for a race this universe doesn\'t have.',
				description: 'Why a character class\'s settings were refused: one of its areas for a race is for a race that was deleted, perhaps by another editor'
			});
		}
	}

	if (!settings.enabled && !(await loadEditorClasses(universe.id, universe.ruleset, transaction)).some((characterClass) => ((characterClass.id !== classId) && characterClass.enabled)))
	{
		refuse(409, messages.noEnabledClass);
	}
}
