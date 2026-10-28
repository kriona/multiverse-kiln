/**
 * Saving the world editor (POST /:universeId/changes, see shared/src/editorChanges.ts): every change
 * made on its tabs, in one transaction, so they are saved all or nothing
 *
 * Each change is checked and saved by its own module (editor.ts for the universe, its ruleset and its
 * tiles, editorItems.ts for items, and so on), through a ChangeContext. A change that is refused throws
 * a ChangeRefusal, which rolls the whole save back. The rooms only hear about the changes once the save
 * has committed
 */
import type express from 'express';
import type { Request, Response } from 'express';
import { canEditUniverseSettings, canEditWorld, localize, type EditorChange, type EditorChangeKind, type NewRef, type SaveChangesPayload, type SaveRefusedPayload, type UniverseRole } from '@multiverse-kiln/shared';

import { inTransaction } from '../db/transactions.js';
import { findEditableUniverse, lockUniverse, UniverseNameTakenError } from '../db/universeRepo.js';
import { describeInvalidPayload } from '../rooms/payloads.js';
import { deleteObject } from '../storage/objectStorage.js';
import { areaChanges } from '../world/areaChanges.js';
import { applyRulesetChange, applyUniverseChange, createTileChange, removeTileChange, saveTileChange } from './editor.js';
import { universeContextOf, type UniverseContext } from './editorAccess.js';
import { createAreaChange, deleteAreaChange, deleteLinkChange, editCellsChange, resizeAreaChange, saveLinkChange, updateAreaChange } from './editorAreas.js';
import { ChangeRefusal, type ChangeContext, type PreparedUpload } from './editorChangeContext.js';
import { createClassChange, removeClassChange, saveClassChange } from './editorClasses.js';
import { createDifficultyLevelChange, removeDifficultyLevelChange, saveDifficultyLevelChange } from './editorDifficultyLevels.js';
import { createItemChange, removeItemChange, saveItemChange } from './editorItems.js';
import { saveChangesRequest } from './editorPayloads.js';
import { createRaceChange, removeRaceChange, saveRaceChange } from './editorRaces.js';
import { createThemeChange, removeThemeChange, saveThemeChange } from './editorThemes.js';
import { deleteTileGraphicChange, prepareUpload, uploadTileGraphicChange } from './editorTileGraphics.js';
import { errorMessages, type Refusal } from './errors.js';

/**
 * The changes that need canEditUniverseSettings(); the rest need canEditWorld()
 */
const SETTINGS_CHANGES = new Set<EditorChangeKind>([
	'universe',
	'ruleset',
	'createRace',
	'saveRace',
	'removeRace',
	'createClass',
	'saveClass',
	'removeClass',
	'createTheme',
	'saveTheme',
	'removeTheme',
	'createDifficultyLevel',
	'saveDifficultyLevel',
	'removeDifficultyLevel'
]);

/**
 * How a save went: the ID each thing made was saved with, or the change refused and why
 */
export type SaveOutcome =
	| { saved: true; ids: Map<NewRef, number | string> }
	| { saved: false; changeIndex: number; refusal: ChangeRefusal };

/**
 * Adds the route that saves the editor's changes to a universe's router
 *
 * @param router The router for routes under /:universeId
 */
export function addChangeRoutes(router: express.Router): void
{
	router.post('/changes', saveChangesRoute);
}

/**
 * POST /:universeId/changes: saves the editor's changes, all or nothing
 *
 * @param request The request
 * @param response The response
 */
async function saveChangesRoute(request: Request, response: Response): Promise<void>
{
	const context = universeContextOf(request);
	const body = saveChangesRequest[context.universe.ruleset].safeParse(request.body);

	if (!body.success)
	{
		const [first] = body.error.issues;
		const index = (((first?.path[0] === 'changes') && (typeof first.path[1] === 'number')) ? first.path[1] : null);

		sendRefused(response, index, new ChangeRefusal({
			status: 400,
			message: errorMessages.invalidRequest,
			values: {
				problem: describeInvalidPayload(body.error)
			}
		}));
		return;
	}

	const outcome = await saveChanges(context, body.data.changes);

	if (!outcome.saved)
	{
		sendRefused(response, outcome.changeIndex, outcome.refusal);
		return;
	}

	const payload: SaveChangesPayload = { ids: Object.fromEntries(outcome.ids) };

	response.json(payload);
}

/**
 * Answers a save that was refused
 *
 * @param response The response
 * @param changeIndex The change refused, or null when the request as a whole was
 * @param refusal Why
 */
function sendRefused(response: Response, changeIndex: number | null, refusal: ChangeRefusal): void
{
	const { status, message, values } = refusal.refusal;
	const payload: SaveRefusedPayload = {
		error: localize(message, values),
		changeIndex,
		...((refusal.resizeConflict === undefined) ? {} : { resizeConflict: refusal.resizeConflict })
	};

	response.status(status).json(payload);
}

/**
 * Saves changes to a universe in one transaction, in the order given, stopping at the first one refused
 * and saving none of them then
 *
 * Uploaded tilesets are checked and stored before the transaction starts, so the universe isn't locked
 * while images are re-encoded, and deleted again if the save doesn't commit
 *
 * @param base The universe, and the player and their role
 * @param changes The changes
 * @return The IDs the things made were saved with, or the change refused
 */
export async function saveChanges(base: UniverseContext, changes: readonly EditorChange[]): Promise<SaveOutcome>
{
	const roleIndex = changes.findIndex((change) => !isAllowed(base.role, change));

	if (roleIndex >= 0)
	{
		return({
			saved: false,
			changeIndex: roleIndex,
			refusal: new ChangeRefusal({
				status: 403,
				message: errorMessages.roleNotAllowed
			})
		});
	}

	const uploads = new Map<NewRef, PreparedUpload>();
	let current = 0;
	let context: ChangeContext;

	try
	{
		for (; current < changes.length; current++)
		{
			const change = changes[current];

			if (change.kind !== 'uploadTileGraphic')
			{
				continue;
			}

			if (uploads.has(change.ref))
			{
				throw new ChangeRefusal({
					status: 400,
					message: errorMessages.invalidRequest,
					values: {
						problem: `${change.ref} is made twice`
					}
				});
			}

			uploads.set(change.ref, await prepareUpload(base.universe.id, change.upload));
		}

		current = 0;
		context = await inTransaction(async (transaction) =>
		{
			await lockUniverse(base.universe.id, transaction);

			const saving: ChangeContext = {
				playerId: base.playerId,
				universe: base.universe,
				role: base.role,
				transaction,
				ids: new Map(),
				uploads,
				published: [],
				deletedImages: []
			};

			for (; current < changes.length; current++)
			{
				await applyChange(saving, changes[current]);
			}

			return(saving);
		});
	}
	catch (error)
	{
		await deleteImages([...uploads.values()].map((upload) => upload.storageKey));

		const refusal = refusalOf(error);

		if (!refusal)
		{
			throw error;
		}

		return({ saved: false, changeIndex: current, refusal });
	}

	await afterCommit(context);

	return({ saved: true, ids: context.ids });
}

/**
 * Whether a role may make a change
 *
 * @param role The player's role in the universe
 * @param change The change
 * @return True when it may
 */
function isAllowed(role: UniverseRole, change: EditorChange): boolean
{
	return((SETTINGS_CHANGES.has(change.kind) ? canEditUniverseSettings : canEditWorld)(role));
}

/**
 * The refusal an error from a save stands for
 *
 * @param error What a change threw
 * @return The refusal, or undefined for an error that isn't one
 */
function refusalOf(error: unknown): ChangeRefusal | undefined
{
	if (error instanceof ChangeRefusal)
	{
		return(error);
	}

	if (error instanceof UniverseNameTakenError)
	{
		const refusal: Refusal = {
			status: 409,
			message: errorMessages.universeNameTaken
		};

		return(new ChangeRefusal(refusal));
	}

	return(undefined);
}

/**
 * Saves one change
 *
 * @param context The save
 * @param change The change
 */
async function applyChange(context: ChangeContext, change: EditorChange): Promise<void>
{
	switch (change.kind)
	{
		case 'universe':
			await applyUniverseChange(context, change.update);
			context.universe = (await findEditableUniverse(context.universe.id, context.transaction) ?? context.universe);
			return;
		case 'ruleset':
			return(applyRulesetChange(context, change.settings));
		case 'uploadTileGraphic':
			return(uploadTileGraphicChange(context, change.ref, change.upload));
		case 'deleteTileGraphic':
			return(deleteTileGraphicChange(context, change.graphicId));
		case 'createTile':
			return(createTileChange(context, change.ref, change.settings));
		case 'saveTile':
			return(saveTileChange(context, change.id, change.settings));
		case 'removeTile':
			return(removeTileChange(context, change.id, change.replaceWith));
		case 'createItem':
			return(createItemChange(context, change.ref, change.settings));
		case 'saveItem':
			return(saveItemChange(context, change.id, change.settings));
		case 'removeItem':
			return(removeItemChange(context, change.id));
		case 'createRace':
			return(createRaceChange(context, change.ref, change.settings));
		case 'saveRace':
			return(saveRaceChange(context, change.id, change.settings));
		case 'removeRace':
			return(removeRaceChange(context, change.id));
		case 'createClass':
			return(createClassChange(context, change.ref, change.settings));
		case 'saveClass':
			return(saveClassChange(context, change.id, change.settings));
		case 'removeClass':
			return(removeClassChange(context, change.id));
		case 'createTheme':
			return(createThemeChange(context, change.ref, change.settings));
		case 'saveTheme':
			return(saveThemeChange(context, change.id, change.settings));
		case 'removeTheme':
			return(removeThemeChange(context, change.id));
		case 'createDifficultyLevel':
			return(createDifficultyLevelChange(context, change.ref, change.settings));
		case 'saveDifficultyLevel':
			return(saveDifficultyLevelChange(context, change.id, change.settings));
		case 'removeDifficultyLevel':
			return(removeDifficultyLevelChange(context, change.id));
		case 'createArea':
			return(createAreaChange(context, change.ref, change.area));
		case 'updateArea':
			return(updateAreaChange(context, change.areaId, change.update));
		case 'deleteArea':
			return(deleteAreaChange(context, change.areaId));
		case 'resizeArea':
			return(resizeAreaChange(context, change.areaId, change.bounds, change.discard));
		case 'editCells':
			return(editCellsChange(context, change.areaId, change.changes));
		case 'saveLink':
			return(saveLinkChange(context, change.areaId, change.column, change.row, change.target));
		case 'deleteLink':
			return(deleteLinkChange(context, change.areaId, change.column, change.row));
	}
}

/**
 * Finishes a save that has committed: removes the deleted tilesets' images, and tells the rooms what
 * changed, each change once
 *
 * @param context The save
 */
async function afterCommit(context: ChangeContext): Promise<void>
{
	await deleteImages(context.deletedImages);

	const told = new Set<string>();

	for (const change of context.published)
	{
		const key = JSON.stringify(change);

		if (!told.has(key))
		{
			told.add(key);
			areaChanges.publish(change);
		}
	}
}

/**
 * Removes images from storage. One that can't be removed is only logged: nothing serves an image
 * without its row, so it does no harm
 *
 * @param storageKeys The images' keys
 */
async function deleteImages(storageKeys: readonly string[]): Promise<void>
{
	for (const storageKey of storageKeys)
	{
		try
		{
			await deleteObject(storageKey);
		}
		catch (error)
		{
			console.error(`Could not delete the image ${storageKey}:`, error);
		}
	}
}
