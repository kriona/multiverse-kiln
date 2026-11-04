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
import { EDITOR_CHANGE_CHECKS, localize, mayMakeChange, type EditorAccess, type EditorChange, type NewRef, type SaveChangesPayload, type SaveRefusedPayload } from '@multiverse-kiln/shared';

import { inTransaction } from '../db/transactions.js';
import { recordUniverseEdit } from '../db/universeEditRepo.js';
import { findDisabledReason, findEditableUniverse, lockUniverse, UniverseNameTakenError } from '../db/universeRepo.js';
import { universeAccessChanges } from '../players/universeAccess.js';
import { describeInvalidPayload } from '../rooms/payloads.js';
import { deleteObject } from '../storage/objectStorage.js';
import { areaChanges } from '../world/areaChanges.js';
import { applyRulesetChange, applyUniverseChange, createTileChange, removeTileChange, saveTileChange } from './editor.js';
import { findEditorAccess, universeContextOf, type UniverseContext } from './editorAccess.js';
import { createAreaChange, deleteAreaChange, deleteLinkChange, editCellsChange, resizeAreaChange, saveLinkChange, updateAreaChange } from './editorAreas.js';
import { ChangeRefusal, refuse, type ChangeContext, type PreparedUpload } from './editorChangeContext.js';
import { createClassChange, removeClassChange, saveClassChange } from './editorClasses.js';
import { createDifficultyLevelChange, removeDifficultyLevelChange, saveDifficultyLevelChange } from './editorDifficultyLevels.js';
import { addEditorChange, checkCreatorKept, emailAddedEditors, playersLosingAccess, removeEditorChange, saveEditorChange } from './editorEditors.js';
import { createItemChange, removeItemChange, saveItemChange } from './editorItems.js';
import { saveChangesRequest } from './editorPayloads.js';
import { SaveAudit } from './editorSaveAudit.js';
import { createRaceChange, removeRaceChange, saveRaceChange } from './editorRaces.js';
import { createThemeChange, removeThemeChange, saveThemeChange } from './editorThemes.js';
import { deleteTileGraphicChange, prepareUpload, uploadTileGraphicChange } from './editorTileGraphics.js';
import { errorMessages, type Refusal } from './errors.js';

/**
 * How a save went: the ID each thing made was saved with, or the change refused (null when the save
 * as a whole was) and why
 */
export type SaveOutcome =
	| { saved: true; ids: Map<NewRef, number | string> }
	| { saved: false; changeIndex: number | null; refusal: ChangeRefusal };

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
	const roleIndex = refusedIndex(base, base.playerId, changes);

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

	const lastEditorChange = changes.findLastIndex((change) => (EDITOR_CHANGE_CHECKS[change.kind] === 'manageEditors'));
	const uploads = new Map<NewRef, PreparedUpload>();
	let current = 0;

	// Set when the save is refused as a whole, rather than one of its changes
	let refusedWhole = false;
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

			// The role may have changed since the request was let in, by a save that held the lock
			const { access, serverAdmin } = await findEditorAccess(base.universe.id, base.playerId, transaction);

			// Disabling the universe takes its lock too, so no save commits after it, except a server
			// admin's, who may fix what it was disabled for
			if (!serverAdmin && (await findDisabledReason(base.universe.id, transaction) !== null))
			{
				refusedWhole = true;
				refuse(403, {
					id: 'error.universeDisabledSave',
					defaultMessage: 'The site\'s admins have disabled this universe, so changes to it can\'t be saved.',
					description: 'Why the world editor couldn\'t save: one of the site\'s admins disabled the universe, for a reason the editor shows'
				});
			}

			if (!access)
			{
				refuse(403, {
					id: 'error.noLongerEditor',
					defaultMessage: 'You no longer have a role in this universe, so your changes can\'t be saved.',
					description: 'Why the world editor couldn\'t save: the player\'s role in the universe was taken away while they were editing it'
				});
			}

			const allowedIndex = refusedIndex(access, base.playerId, changes);

			if (allowedIndex >= 0)
			{
				current = allowedIndex;
				refuse(403, errorMessages.roleNotAllowed);
			}

			const saving: ChangeContext = {
				playerId: base.playerId,
				universe: base.universe,
				role: access.role,
				editorRoles: new Map(),
				addedEditors: [],
				transaction,
				ids: new Map(),
				uploads,
				published: [],
				deletedImages: []
			};

			const audit = new SaveAudit(saving);

			for (; current < changes.length; current++)
			{
				await audit.describe(changes[current]);
				await applyChange(saving, changes[current]);
			}

			current = lastEditorChange;
			await checkCreatorKept(saving);

			if (audit.hasChanges())
			{
				await recordUniverseEdit({
					universeId: base.universe.id,
					playerId: base.playerId,
					role: access.role,
					changeDetails: audit.details,
					savedAt: new Date()
				}, transaction);
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

		return({ saved: false, changeIndex: (refusedWhole ? null : current), refusal });
	}

	await afterCommit(context);

	return({ saved: true, ids: context.ids });
}

/**
 * The first change a player's role doesn't let them make
 *
 * @param access The player's role in the editor, and their languages
 * @param playerId The player's ID
 * @param changes The changes
 * @return The change's place in the list, or -1 when the role allows every one
 */
function refusedIndex(access: EditorAccess, playerId: string, changes: readonly EditorChange[]): number
{
	return(changes.findIndex((change) => !mayMakeChange(change, access, playerId)));
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
		case 'addEditor':
			return(addEditorChange(context, change.username, change.settings));
		case 'saveEditor':
			return(saveEditorChange(context, change.playerId, change.settings));
		case 'removeEditor':
			return(removeEditorChange(context, change.playerId));
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
 * Finishes a save that has committed: removes the deleted tilesets' images, emails the players it gave
 * a role, and tells the rooms what changed, each change once, and who may no longer play there
 *
 * @param context The save
 */
async function afterCommit(context: ChangeContext): Promise<void>
{
	await deleteImages(context.deletedImages);

	try
	{
		await emailAddedEditors(context);
	}
	catch (error)
	{
		console.error('Could not email the players a save gave a role:', error);
	}

	universeAccessChanges.publish({
		universeId: context.universe.id,
		playerIds: playersLosingAccess(context)
	});

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
