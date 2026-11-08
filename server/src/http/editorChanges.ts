/**
 * Saving the world editor (POST /:universeId/changes, see shared/src/editorChanges.ts): every change
 * made on its tabs, in one transaction, so they are saved all or nothing
 *
 * Each change is checked and saved by its own module (editor.ts for the universe, its ruleset and its
 * tiles, editorItems.ts for items, and so on), through a ChangeContext. A change that is refused throws
 * a ChangeRefusal, which rolls the whole save back. The rooms only hear about the changes once the save
 * has committed, and the universe's editor room what it changed, for its other windows
 */
import type express from 'express';
import type { Request, Response } from 'express';
import { EDITOR_CHANGE_CHECKS, localize, mayMakeChange, maySaveInStage, onlyLeaves, type EditorAccess, type EditorChange, type NewRef, type SaveChangesPayload, type SaveRefusedPayload, type SavedEditDetail } from '@multiverse-kiln/shared';

import { loadBarredOptions, sameBarred } from '../db/barredOptions.js';
import { findPlayer } from '../db/playerRepo.js';
import { inTransaction } from '../db/transactions.js';
import { hasTwoFactor } from '../db/twoFactorRepo.js';
import { recordUniverseEdit } from '../db/universeEditRepo.js';
import { listUniverseRoles } from '../db/universeEditorRepo.js';
import { findEditableUniverse, findUniverse, hasDraft, lockUniverse, UniverseNameTakenError } from '../db/universeRepo.js';
import { universeAccessChanges, type StageChange } from '../players/universeAccess.js';
import { describeInvalidPayload } from '../rooms/payloads.js';
import { deleteObject } from '../storage/objectStorage.js';
import { areaChanges } from '../world/areaChanges.js';
import { editorUpdates } from '../world/editorUpdates.js';
import { applyRulesetChange, applyUniverseChange, createTileChange, removeTileChange, saveTileChange } from './editor.js';
import { findEditorAccess, universeContextOf, type UniverseContext } from './editorAccess.js';
import { createAreaChange, deleteAreaChange, deleteLinkChange, editCellsChange, resizeAreaChange, saveLinkChange, updateAreaChange } from './editorAreas.js';
import { ChangeRefusal, refuse, type ChangeContext, type PreparedUpload } from './editorChangeContext.js';
import { createClassChange, removeClassChange, saveClassChange } from './editorClasses.js';
import { createDifficultyLevelChange, removeDifficultyLevelChange, saveDifficultyLevelChange } from './editorDifficultyLevels.js';
import { SaveDisablings } from './editorDisablings.js';
import { addEditorChange, checkCreatorKept, emailAddedEditors, playersLosingAccess, removeEditorChange, saveEditorChange } from './editorEditors.js';
import { createItemChange, removeItemChange, saveItemChange } from './editorItems.js';
import { saveChangesRequest } from './editorPayloads.js';
import { SaveAudit } from './editorSaveAudit.js';
import { SaveMerge } from './editorSaveMerge.js';
import { createRaceChange, removeRaceChange, saveRaceChange } from './editorRaces.js';
import { createThemeChange, removeThemeChange, saveThemeChange } from './editorThemes.js';
import { isUniverseTextChange, saveNoTranslationChange, saveTranslationChange, saveTranslatorNoteChange, settleUniverseText, writeSavedTranslations } from './editorTranslations.js';
import { applyDraftChange, discardDraftChange, startDraftChange } from './editorDrafts.js';
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
 * A change to save, or a function that makes it from the IDs the changes before it gave the things they
 * made, for a change that names them where a save from the editor can only name saved things (such as a
 * race's starting area). Only the server makes the functions, as importing a universe does
 */
export type PendingChange = EditorChange | ((ids: ReadonlyMap<NewRef, number | string>) => EditorChange);

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

	const outcome = await saveChanges(context, body.data.changes, body.data.windowId);

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
		...((refusal.resizeConflict === undefined) ? {} : { resizeConflict: refusal.resizeConflict }),
		...((refusal.conflicts === undefined) ? {} : { conflicts: refusal.conflicts })
	};

	response.status(status).json(payload);
}

/**
 * Finds a change to the universe's draft that is out of place. Starting the draft copies what the rest
 * of the save changes, so it comes last; applying or discarding it is the only change in its save, since
 * a change saved after it would be saved to a version that is gone
 *
 * @param changes The save's changes
 * @return The index of the first change out of place, or -1 when there is none
 */
function misplacedDraftChange(changes: readonly PendingChange[]): number
{
	return(changes.findIndex((change, index) => ((typeof change !== 'function') && (((change.kind === 'startDraft') && (index !== (changes.length - 1))) || (((change.kind === 'applyDraft') || (change.kind === 'discardDraft')) && (changes.length > 1))))));
}

/**
 * The kinds of change only a save's own changes may be, never one a PendingChange function makes, since
 * misplacedDraftChange() checks where they are before the save starts
 */
const DRAFT_KINDS: ReadonlySet<EditorChange['kind']> = new Set(['startDraft', 'applyDraft', 'discardDraft']);

/**
 * Saves changes to a universe in one transaction, in the order given, stopping at the first one refused
 * and saving none of them then
 *
 * Uploaded tilesets are checked and stored before the transaction starts, so the universe isn't locked
 * while images are re-encoded, and deleted again if the save doesn't commit
 *
 * @param base The universe, and the player and their role
 * @param changes The changes, or functions making them once the changes before them are saved
 * @param windowId The editor room session ID of the window saving, which isn't told of the save
 * @return The IDs the things made were saved with, or the change refused
 */
export async function saveChanges(base: UniverseContext, changes: readonly PendingChange[], windowId?: string): Promise<SaveOutcome>
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

	const draftIndex = misplacedDraftChange(changes);
	const given = changes.filter((change) => (typeof change !== 'function'));

	// A save holding changes a function makes never only leaves the universe
	const onlyLeaving = ((given.length === changes.length) && onlyLeaves(given, base.playerId));

	if (draftIndex >= 0)
	{
		const misplaced = changes[draftIndex];
		const misplacedKind = ((typeof misplaced === 'function') ? 'A change' : misplaced.kind);

		return({
			saved: false,
			changeIndex: draftIndex,
			refusal: new ChangeRefusal({
				status: 400,
				message: errorMessages.invalidRequest,
				values: {
					problem: `${misplacedKind} must be ${((misplacedKind === 'startDraft') ? 'the last change' : 'the only change')} in a save`
				}
			})
		});
	}

	const lastEditorChange = changes.findLastIndex((change) => ((typeof change !== 'function') && (EDITOR_CHANGE_CHECKS[change.kind] === 'manageEditors')));
	const uploads = new Map<NewRef, PreparedUpload>();

	// The changes as they were saved, once each is made
	const applied: EditorChange[] = [];
	let current = 0;

	// Set when the save is refused as a whole, rather than one of its changes
	let refusedWhole = false;

	// Set when the save changes the universe's stage
	let stageChange: StageChange | undefined;

	// What the save changed, as the Audit tab lists it
	let details: SavedEditDetail[] = [];
	let context: ChangeContext;

	try
	{
		for (; current < changes.length; current++)
		{
			const change = changes[current];

			if ((typeof change === 'function') || (change.kind !== 'uploadTileGraphic'))
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

			// The role, the stage and the universe's settings may have changed since the request was let in,
			// by a save that held the lock
			const { access, serverAdmin } = await findEditorAccess(base.universe.id, base.playerId, transaction);
			const locked = await findUniverse(base.universe.id, transaction);
			const stageBefore = (locked?.stage ?? base.universe.stage);

			// Disabling the universe takes its lock too, so no save commits after it, except a server
			// admin's, who may fix what it was disabled for, and one that only leaves the universe
			if (!serverAdmin && (locked?.disabled ?? false) && !onlyLeaving)
			{
				refusedWhole = true;
				refuse(403, {
					id: 'error.universeDisabledSave',
					defaultMessage: 'The site\'s admins have disabled this universe, so changes to it can\'t be saved.',
					description: 'Why the world editor couldn\'t save: one of the site\'s admins disabled the universe, for a reason the editor shows. Leaving the universe can still be saved'
				});
			}

			if (!access)
			{
				refusedWhole = true;
				refuse(403, {
					id: 'error.noLongerEditor',
					defaultMessage: 'You no longer have a role in this universe, so your changes can\'t be saved.',
					description: 'Why the world editor couldn\'t save: the player\'s role in the universe was taken away while they were editing it'
				});
			}

			if (!maySaveInStage(onlyLeaving, stageBefore, access))
			{
				refusedWhole = true;
				refuse(403, {
					id: 'error.universeLockedSave',
					defaultMessage: 'This universe has reached the end of time, so only its creators can change it.',
					description: 'Why the world editor couldn\'t save: the universe is in the stage "end of time", which locks it, and the player isn\'t one of its creators. Leaving the universe can still be saved'
				});
			}

			if ((locked?.requireTwoFactor ?? false) && !onlyLeaving && !await hasTwoFactor(base.playerId, transaction))
			{
				refusedWhole = true;
				refuse(403, {
					id: 'error.twoFactorRequiredSave',
					defaultMessage: 'This universe requires its editors to have two-factor authentication on. Turn it on for your account to save changes.',
					description: 'Why the world editor couldn\'t save: the universe\'s creators require its editors to have two-factor authentication on, and the player doesn\'t. Leaving the universe can still be saved'
				});
			}

			const allowedIndex = refusedIndex(access, base.playerId, changes);

			if (allowedIndex >= 0)
			{
				current = allowedIndex;
				refuse(403, errorMessages.roleNotAllowed);
			}

			// Applying or discarding the draft takes the universe's lock too
			if (base.version.draft && !await hasDraft(base.universe.id, transaction))
			{
				refusedWhole = true;
				refuse(404, errorMessages.noSuchDraft);
			}

			const saving: ChangeContext = {
				playerId: base.playerId,
				universe: (await findEditableUniverse(base.version, transaction) ?? base.universe),
				version: base.version,
				role: access.role,
				editorRoles: new Map(),
				addedEditors: [],
				transaction,
				ids: new Map(),
				uploads,
				published: [],
				onCommit: [],
				disablings: new SaveDisablings(),
				deletedImages: [],
				draftApplied: false
			};

			const audit = new SaveAudit(saving);
			const merge = new SaveMerge(saving, audit);
			const changesOptions = (!base.version.draft && changes.some((change) => ((typeof change === 'function') || BARRING_KINDS.has(change.kind))));
			const barredBefore = (changesOptions ? await loadBarredOptions(base.universe.id, transaction) : undefined);

			for (; current < changes.length; current++)
			{
				const pending = changes[current];
				const made = ((typeof pending === 'function') ? pending(saving.ids) : pending);

				// The role was checked for the save's own changes before it started
				if ((typeof pending === 'function') && (DRAFT_KINDS.has(made.kind) || !mayMakeChange(made, access, base.playerId)))
				{
					refuse(403, errorMessages.roleNotAllowed);
				}

				const change = await merge.merge(current, made);

				if (change === null)
				{
					continue;
				}

				if (!isUniverseTextChange(change))
				{
					await settleUniverseText(saving);
				}

				await audit.describe(change);
				await applyChange(saving, change);
				applied.push(change);
			}

			await writeSavedTranslations(saving);

			if (merge.conflicts.length > 0)
			{
				current = merge.conflicts[0].changeIndex;

				throw new ChangeRefusal({
					status: 409,
					message: {
						id: 'error.saveConflicts',
						defaultMessage: 'Other editors changed some of the same settings since you loaded them. Choose whose to keep, then save again.',
						description: 'Why the world editor couldn\'t save: another editor saved different values for settings the player also changed; the editor then lists each one, to keep the player\'s value or take the other editor\'s'
					}
				}, undefined, merge.conflicts);
			}

			await saving.disablings.finish(saving);
			current = lastEditorChange;
			await checkCreatorKept(saving);

			if (barredBefore)
			{
				const barred = await loadBarredOptions(base.universe.id, transaction);

				if (!sameBarred(barredBefore, barred))
				{
					saving.onCommit.push(() =>
					{
						universeAccessChanges.publishBarred({
							universeId: base.universe.id,
							barred
						});
					});
				}
			}

			const { requireTwoFactor } = saving.universe;

			if (requireTwoFactor !== (locked?.requireTwoFactor ?? requireTwoFactor))
			{
				saving.onCommit.push(() =>
				{
					editorUpdates.publish({
						kind: 'twoFactorRequirement',
						universeId: base.universe.id,
						required: requireTwoFactor
					});
				});
			}

			if (saving.universe.stage !== stageBefore)
			{
				stageChange = {
					universeId: base.universe.id,
					stage: saving.universe.stage,
					previousStage: stageBefore,
					roles: await listUniverseRoles(base.universe.id, transaction)
				};
			}

			if (audit.hasChanges())
			{
				await recordUniverseEdit({
					universeId: base.universe.id,
					playerId: base.playerId,
					role: access.role,
					draft: base.version.draft,
					changeDetails: audit.savedDetails(),
					savedAt: new Date()
				}, transaction);
			}

			details = audit.noticedDetails();

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

	// The rooms play the live version, so the draft's areas and settings are nothing to them until it is applied
	if (base.version.draft && !context.draftApplied)
	{
		context.published.length = 0;
	}
	// Told after the areas' own changes, so a room has sent their new settings before its clients fetch the text
	else if (applied.some(changesRoomText))
	{
		context.published.push({ kind: 'text', universeId: base.universe.id });
	}

	await afterCommit(context, stageChange);
	await publishSave(base, windowId, details);

	return({ saved: true, ids: context.ids });
}

/**
 * Whether a change may change the text the rooms leave clients to look up (UniverseTextPayload): the
 * names of areas and tiles, which areas are enabled, and the universe's languages
 *
 * @param change The change
 * @return True when it may
 */
function changesRoomText(change: EditorChange): boolean
{
	switch (change.kind)
	{
		case 'universe':
			return((change.update.sourceLanguage !== undefined) || (change.update.translationLanguages !== undefined));
		case 'updateArea':
			return((change.update.name !== undefined) || (change.update.enabled !== undefined));
		case 'saveTranslation':
		case 'saveNoTranslation':
			return((change.text.kind === 'area') || (change.text.kind === 'tile'));
		case 'createArea':
		case 'deleteArea':
		case 'createTile':
		case 'saveTile':
		case 'removeTile':
			return(true);
		default:
			return(false);
	}
}

/**
 * The kinds of change that can bar characters of a race or class from playing, or let them play again
 */
const BARRING_KINDS: ReadonlySet<EditorChange['kind']> = new Set(['saveRace', 'removeRace', 'saveClass', 'removeClass']);

/**
 * The first change a player's role doesn't let them make, of those given as changes; one a function
 * makes is checked as it is made
 *
 * @param access The player's role in the editor, and their languages
 * @param playerId The player's ID
 * @param changes The changes
 * @return The change's place in the list, or -1 when the role allows every one
 */
function refusedIndex(access: EditorAccess, playerId: string, changes: readonly PendingChange[]): number
{
	return(changes.findIndex((change) => ((typeof change !== 'function') && !mayMakeChange(change, access, playerId))));
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
			await applyUniverseChange(context, change.update, (change.largerGroups ?? 'keep'));
			context.universe = (await findEditableUniverse(context.version, context.transaction) ?? context.universe);
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
			return(saveItemChange(context, change.id, change.settings, (change.whenDisabled ?? 'keep')));
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
			return(updateAreaChange(context, change.areaId, change.update, (change.moveTo ?? 'start')));
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
		case 'saveTranslation':
			return(saveTranslationChange(context, change));
		case 'saveTranslatorNote':
			return(saveTranslatorNoteChange(context, change));
		case 'saveNoTranslation':
			return(saveNoTranslationChange(context, change));
		case 'startDraft':
			return(startDraftChange(context));
		case 'applyDraft':
			return(applyDraftChange(context, change.choices));
		case 'discardDraft':
			return(discardDraftChange(context));
	}
}

/**
 * Finishes a save that has committed: removes the deleted tilesets' images, emails the players it gave
 * a role, and tells the rooms what changed, each change once, and who may no longer play there. A new
 * stage goes to the rooms with every editor's role, which covers the roles the save changed too. The
 * editor room hears of the roles the save changed either way
 *
 * @param context The save
 * @param stageChange The universe's new stage, when the save changed it
 */
async function afterCommit(context: ChangeContext, stageChange: StageChange | undefined): Promise<void>
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

	if (stageChange)
	{
		universeAccessChanges.publishStage(stageChange);
	}
	else
	{
		universeAccessChanges.publish({
			universeId: context.universe.id,
			playerIds: playersLosingAccess(context)
		});
	}

	if (context.editorRoles.size > 0)
	{
		editorUpdates.publish({
			kind: 'roles',
			universeId: context.universe.id,
			roles: new Map(context.editorRoles)
		});
	}

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

	for (const tell of context.onCommit)
	{
		tell();
	}
}

/**
 * Tells the universe's editor room what a save that has committed changed, for its other windows, when
 * it changed anything. A save whose player can't be found (their account deleted as it saved) tells
 * no one, since there is no one to name
 *
 * @param base The universe and version saved, and the player who saved
 * @param windowId The editor room session ID of the window that saved, or undefined when it named none
 * @param details What the save changed, as the Audit tab lists it, with the ID of each thing and the
 * chunks each area's painting touched
 */
async function publishSave(base: UniverseContext, windowId: string | undefined, details: SavedEditDetail[]): Promise<void>
{
	if (details.length === 0)
	{
		return;
	}

	const player = await findPlayer(base.playerId);

	if (!player)
	{
		return;
	}

	editorUpdates.publish({
		kind: 'saved',
		universeId: base.universe.id,
		windowId,
		playerId: player.id,
		name: player.displayName,
		username: player.username,
		version: (base.version.draft ? 'draft' : 'live'),
		details
	});
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
