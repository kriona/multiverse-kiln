/**
 * Deleting a universe (see Deleting a universe in STRUCTURE-OVERVIEW.md), with its world, uploads,
 * groups and everyone's characters in it
 *
 * Its creators delete it from the editor's Universe tab, through the editor's routes here; a server
 * admin deletes it through the admin route (admin.ts), which records it as an admin event, when they
 * delete it as an admin (deletesUniverseAsAdmin()). Either way the player confirms with their password,
 * and their authenticator or recovery code when the account has 2FA, or with their username, and a code
 * emailed to the account's address, when the account has no password, as deleting an account asks.
 * Deleting an account deletes the universes it chose to here too (accountDeletion.ts)
 */
import type { Request, Response, Router } from 'express';
import { z } from 'zod';
import { canDeleteUniverse, deletesUniverseAsAdmin, MAX_LOCALE_LENGTH, MAX_PASSWORD_LENGTH, MAX_TWO_FACTOR_CODE_INPUT_LENGTH, MAX_USERNAME_LENGTH, SOURCE_LOCALE, UNIVERSE_DELETION_PATH, UNIVERSE_DELETION_PREVENTED, type UniverseDeleteRequest, type UniverseDeletionPayload } from '@multiverse-kiln/shared';

import { countUniverseCharacters } from '../db/characterRepo.js';
import type { Executor } from '../db/client.js';
import { deleteEmailCode, lockContinuation } from '../db/emailCodeRepo.js';
import { countUniverseGroups } from '../db/groupRepo.js';
import { findDisplayName, findEmailRecipient, findPasswordHash, findPlayerEmail } from '../db/playerRepo.js';
import { listTileGraphicStorageKeys } from '../db/tileGraphicRepo.js';
import { inTransaction } from '../db/transactions.js';
import { hasTwoFactor } from '../db/twoFactorRepo.js';
import { listUniverseEditors } from '../db/universeEditorRepo.js';
import { deleteUniverse, findUniverse, isUniverseDeletionPrevented, lockUniverse } from '../db/universeRepo.js';
import { sendEmailInBackground } from '../email/mailer.js';
import { universeDeletedEmail } from '../email/universeEmails.js';
import { deleteObject } from '../storage/objectStorage.js';
import { areaChanges } from '../world/areaChanges.js';
import { authMessages, cookieTokenHash, sendRefusal, type AuthRefusal } from './authCommon.js';
import { clearCookie, CONTINUATION_COOKIE } from './cookies.js';
import { EDITOR_TWO_FACTOR_REFUSAL, findEditorAccess, requireRole, universeContextOf } from './editorAccess.js';
import { errorMessages, sendInvalidRequest } from './errors.js';
import { checkAccountPassword, checkSecondFactor, requireSession } from './twoFactorAuth.js';

const universeDeleteRequest = z.object({
	password: z.string().max(MAX_PASSWORD_LENGTH * 4).nullable(),
	twoFactorCode: z.string().max(MAX_TWO_FACTOR_CODE_INPUT_LENGTH).nullable(),
	username: z.string().trim().max(MAX_USERNAME_LENGTH * 4).nullable(),
	locale: z.string().max(MAX_LOCALE_LENGTH).regex(/^[A-Za-z0-9-]+$/)
}) satisfies z.ZodType<UniverseDeleteRequest>;

/**
 * How one of the routes that delete a universe deletes it: as one of its creators, or as a server admin
 */
export interface UniverseDeleter
{
	/**
	 * Runs the deletion's transaction: the server's own role's, or the admin role's, which can record it
	 *
	 * @param work The deletion
	 * @return What work resolves with
	 */
	inTransaction<T>(work: (executor: Executor) => Promise<T>): Promise<T>;

	/**
	 * Checks the player may delete the universe, once it is locked and before anything changes
	 *
	 * @param universeId The universe
	 * @param playerId The player deleting it
	 * @param executor The deletion's transaction
	 * @return The refusal, or undefined when they may
	 */
	check(universeId: string, playerId: string, executor: Executor): Promise<AuthRefusal | undefined>;

	/**
	 * Whether a server admin deletes it, as an admin, who the emails to its editors don't name
	 */
	asAdmin: boolean;

	/**
	 * Records the deletion, in its transaction, just before the universe is deleted
	 *
	 * @param universeName The universe's name
	 * @param executor The deletion's transaction
	 */
	record?(universeName: string, executor: Executor): Promise<void>;
}

/**
 * What deleting a universe did, for telling the rooms, its editors and storage once it is saved
 */
interface Deletion
{
	universeName: string;

	/**
	 * The name of the player who deleted it, or null for one with no account any more
	 */
	deleterName: string | null;

	/**
	 * Everyone else who had a role in it
	 */
	editorIds: string[];

	storageKeys: string[];
}

/**
 * Adds the editor's routes for deleting a universe, under a universe's router (EDITOR_UNIVERSES_PATH/:universeId)
 *
 * @param router The universe's router, after its routes refuse a player kept out by the universe requiring 2FA
 */
export function addUniverseDeletionRoutes(router: Router): void
{
	router.get(UNIVERSE_DELETION_PATH, requireRole(canDeleteUniverse), deletionRoute);
	router.post(UNIVERSE_DELETION_PATH, requireRole(canDeleteUniverse), deleteAsCreatorRoute);
}

/**
 * GET EDITOR_UNIVERSES_PATH/:universeId/deletion: what deleting the universe deletes, and how the player
 * confirms it
 *
 * @param request The request
 * @param response The response: a UniverseDeletionPayload
 */
async function deletionRoute(request: Request, response: Response): Promise<void>
{
	const { playerId, universe, role, serverAdmin, twoFactor } = universeContextOf(request);
	const [characters, groups, editors, email, passwordHash] = await Promise.all([
		countUniverseCharacters(universe.id),
		countUniverseGroups(universe.id),
		listUniverseEditors(universe.id),
		findPlayerEmail(playerId),
		findPasswordHash(playerId)
	]);
	const payload: UniverseDeletionPayload = {
		characters: characters.characters,
		players: characters.players,
		groups,
		editors: editors.filter((editor) => (editor.playerId !== playerId)).length,
		deletionPrevented: universe.deletionPrevented,
		asAdmin: deletesUniverseAsAdmin(role, serverAdmin, universe.deletionPrevented),
		email,
		hasPassword: (passwordHash !== null),
		twoFactor
	};

	response.json(payload);
}

/**
 * POST EDITOR_UNIVERSES_PATH/:universeId/deletion: deletes the universe as one of its creators. A server
 * admin deleting it as an admin uses the admin route instead, which records it
 *
 * @param request The request, with a UniverseDeleteRequest
 * @param response The response: 204, or the refusal
 */
async function deleteAsCreatorRoute(request: Request, response: Response): Promise<void>
{
	await deleteUniverseRoute(request, response, universeContextOf(request).universe.id, {
		inTransaction,
		check: checkCreatorMayDelete,
		asAdmin: false
	});
}

/**
 * Checks the player is still one of the universe's creators, read again once the universe is locked,
 * and that nothing keeps them from deleting it: the site's admins keeping its creators from deleting it,
 * or the universe requiring 2FA the player doesn't have on, which the editor refuses them
 *
 * @param universeId The universe
 * @param playerId The player deleting it
 * @param executor A transaction that has locked the universe
 * @return The refusal, or undefined when they may delete it
 */
async function checkCreatorMayDelete(universeId: string, playerId: string, executor: Executor): Promise<AuthRefusal | undefined>
{
	// One query at a time: a transaction's queries share its connection
	const { access } = await findEditorAccess(universeId, playerId, executor);
	const universe = await findUniverse(universeId, executor);
	const twoFactor = await hasTwoFactor(playerId, executor);

	if (!universe || (access?.role !== 'creator'))
	{
		return({
			status: 403,
			message: errorMessages.roleNotAllowed
		});
	}

	if (universe.requireTwoFactor && !twoFactor)
	{
		return({
			status: 403,
			message: EDITOR_TWO_FACTOR_REFUSAL,
			values: {
				universe: universe.name
			}
		});
	}

	if (await isUniverseDeletionPrevented(universeId, executor))
	{
		return({
			status: 409,
			message: UNIVERSE_DELETION_PREVENTED
		});
	}

	return(undefined);
}

/**
 * Deletes a universe, once the player confirms it, and tells its rooms, its other editors and storage.
 * The player confirms with the password and 2FA code, or for an account without a password, the username
 * and a code sent to its address that this browser entered
 *
 * @param request The request, with a UniverseDeleteRequest
 * @param response The response: 204, or the refusal
 * @param universeId The universe
 * @param deleter How the route deletes it
 */
export async function deleteUniverseRoute(request: Request, response: Response, universeId: string, deleter: UniverseDeleter): Promise<void>
{
	const body = universeDeleteRequest.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const session = await requireSession(request, response);

	if (!session)
	{
		return;
	}

	const { password, twoFactorCode, username, locale: emailLocale } = body.data;
	const playerId = session.playerId;
	const now = new Date();
	const hasPassword = ((await findPasswordHash(playerId)) !== null);

	if (hasPassword)
	{
		const problem = await checkAccountPassword(request, response, playerId, (password ?? ''), now);

		if (problem)
		{
			sendRefusal(response, problem);
			return;
		}
	}
	else if ((username ?? '').toLowerCase() !== session.username.toLowerCase())
	{
		sendRefusal(response, {
			status: 400,
			message: {
				id: 'error.universeDeletion.wrongUsername',
				defaultMessage: 'Type your username exactly as it is to confirm.',
				description: 'Shown under the username field when deleting a universe from an account that has no password: what was typed isn\'t the account\'s username'
			},
			field: 'username'
		});
		return;
	}

	const outcome = await deleter.inTransaction(async (executor): Promise<AuthRefusal | Deletion> =>
	{
		// Waits for a save in progress to commit, and keeps later ones from starting until it is gone
		if (!await lockUniverse(universeId, executor))
		{
			return({
				status: 404,
				message: errorMessages.noSuchUniverse
			});
		}

		// Checked before the 2FA code, which a right one would use up
		const refusal = await deleter.check(universeId, playerId, executor);

		if (refusal)
		{
			return(refusal);
		}

		// The session alone isn't enough: without a password, a code sent to the account's address that this
		// browser entered, unless it has no address either
		let codeId: string | undefined;

		if (!hasPassword && ((await findPlayerEmail(playerId, executor)) !== null))
		{
			const continuationHash = cookieTokenHash(request, CONTINUATION_COOKIE);
			const code = ((continuationHash === undefined) ? undefined : await lockContinuation('deleteUniverse', continuationHash, now, executor));

			if (!code || (code.playerId !== playerId))
			{
				return({
					status: 403,
					message: authMessages.enterCodeFirst
				});
			}

			codeId = code.id;
		}

		// Checked before anything changes, and committed even when wrong, so the try counts
		const check = await checkSecondFactor(request, response, playerId, twoFactorCode, now, executor, {
			trustedBrowserSkips: false,
			emailLocale
		});

		if ((check.kind === 'wrong') || (check.kind === 'refused'))
		{
			return(check.refusal);
		}

		const universe = await findUniverse(universeId, executor);

		if (!universe)
		{
			return({
				status: 404,
				message: errorMessages.noSuchUniverse
			});
		}

		const editors = await listUniverseEditors(universeId, executor);
		const deleterName = await findDisplayName(playerId, executor);

		// A code deletes one universe: deleting another asks for a new one
		if (codeId !== undefined)
		{
			await deleteEmailCode(codeId, executor);
		}

		await deleter.record?.(universe.name, executor);

		return({
			universeName: universe.name,
			deleterName,
			editorIds: editors
				.map((editor) => editor.playerId)
				.filter((editorId) => (editorId !== playerId)),
			storageKeys: await deleteUniverseWithUploads(universeId, executor)
		});
	});

	if ('status' in outcome)
	{
		sendRefusal(response, outcome);
		return;
	}

	clearCookie(response, CONTINUATION_COOKIE);
	response.sendStatus(204);
	areaChanges.publish({
		kind: 'universeDeleted',
		universeId
	});
	await emailUniverseDeleted(outcome.universeName, outcome.editorIds, (deleter.asAdmin ? null : outcome.deleterName));
	await deleteStoredUploads(outcome.storageKeys);
}

/**
 * Emails each of a deleted universe's other editors that it was deleted, in their language, once the
 * deletion has committed
 *
 * @param universeName The universe's name
 * @param editorIds Everyone who had a role in it but the player who deleted it
 * @param deleterName The name the emails give for who deleted it, or null to say the site's admins did
 */
export async function emailUniverseDeleted(universeName: string, editorIds: readonly string[], deleterName: string | null): Promise<void>
{
	for (const editorId of editorIds)
	{
		const recipient = await findEmailRecipient(editorId);

		if (recipient)
		{
			sendEmailInBackground({
				to: recipient.email,
				...universeDeletedEmail({
					deleterName,
					universeName
				}, recipient.displayName, (recipient.locale ?? SOURCE_LOCALE))
			});
		}
	}
}

/**
 * Deletes a universe and everything in it, which its rows take with them: its world, draft, editors,
 * groups, characters and chats
 *
 * @param universeId The universe
 * @param executor A transaction, which deleteStoredUploads() follows once it commits
 * @return Where its uploaded tile graphics are in object storage, to delete once the transaction commits
 */
export async function deleteUniverseWithUploads(universeId: string, executor: Executor): Promise<string[]>
{
	const storageKeys = await listTileGraphicStorageKeys(universeId, executor);

	await deleteUniverse(universeId, executor);

	return(storageKeys);
}

/**
 * Deletes the uploads of deleted universes from object storage, logging those that can't be deleted
 * rather than failing, since the universes are gone either way
 *
 * @param storageKeys Their keys in object storage
 */
export async function deleteStoredUploads(storageKeys: readonly string[]): Promise<void>
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
