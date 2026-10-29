/**
 * Deleting an account (see Deleting an account in STRUCTURE-OVERVIEW.md), on the auth router
 *
 * The player confirms with their password, and their authenticator or recovery code when the account
 * has 2FA, or with their username when the account has no password. Each universe they are the only
 * creator of is handed to another of its editors or deleted first, as they chose (GET
 * PROFILE_DELETION_PATH lists them). Groups whose anchor being was one of their characters disband, and
 * every window of theirs is turned away
 */
import type { Request, Response, Router } from 'express';
import { z } from 'zod';
import { AUTH_ACCOUNT_DELETE_PATH, defineMessages, MAX_LOCALE_LENGTH, MAX_PASSWORD_LENGTH, MAX_TWO_FACTOR_CODE_INPUT_LENGTH, MAX_USERNAME_LENGTH, type AccountDeleteRequest } from '@multiverse-kiln/shared';

import type { Executor } from '../db/client.js';
import { listMembersOfGroups, listPlayerMemberships } from '../db/groupRepo.js';
import { deletePlayer, findPasswordHash, findPlayerEmail, lockPlayer } from '../db/playerRepo.js';
import { deletePlayerSessions } from '../db/sessionRepo.js';
import { listTileGraphicStorageKeys } from '../db/tileGraphicRepo.js';
import { inTransaction } from '../db/transactions.js';
import { listOtherUniverseEditors, listSoleCreatedUniverses, setUniverseRole } from '../db/universeEditorRepo.js';
import { deleteUniverse, lockUniverse } from '../db/universeRepo.js';
import { accountDeletedEmail } from '../email/authEmails.js';
import { sendEmailInBackground } from '../email/mailer.js';
import { connectedSessions } from '../players/connectedSessions.js';
import { accountDeletionChanges, groupChanges, type GroupChange } from '../players/groupChanges.js';
import { deleteObject } from '../storage/objectStorage.js';
import { areaChanges } from '../world/areaChanges.js';
import { sendRefusal, type AuthRefusal } from './authCommon.js';
import { clearCookie, SESSION_COOKIE } from './cookies.js';
import { sendInvalidRequest } from './errors.js';
import { checkAccountPassword, checkSecondFactor, requireSession } from './twoFactorAuth.js';

/**
 * Reasons the account deletion route gives (see shared/src/localization.ts)
 */
const deletionMessages = defineMessages({
	wrongUsername: {
		id: 'error.auth.deleteWrongUsername',
		defaultMessage: 'Type your username exactly as it is to confirm.',
		description: 'Shown under the username field when deleting an account that has no password: what was typed isn\'t the account\'s username'
	},
	universesChanged: {
		id: 'error.auth.deleteUniversesChanged',
		defaultMessage: 'The universes you alone create have changed. Look at them again before deleting your account.',
		description: 'Why deleting an account was refused: the universes the player is the only creator of, or their editors, changed since the deletion dialog listed them'
	}
});

const accountDeleteRequest = z.object({
	password: z.string().max(MAX_PASSWORD_LENGTH * 4).nullable(),
	twoFactorCode: z.string().max(MAX_TWO_FACTOR_CODE_INPUT_LENGTH).nullable(),
	username: z.string().trim().max(MAX_USERNAME_LENGTH * 4).nullable(),
	universes: z.array(z.object({
		universeId: z.uuid(),
		newCreatorId: z.uuid().nullable()
	})).max(1000),
	locale: z.string().max(MAX_LOCALE_LENGTH).regex(/^[A-Za-z0-9-]+$/)
}) satisfies z.ZodType<AccountDeleteRequest>;

/**
 * What deleting an account did, for telling the rooms and storage once it is saved
 */
interface Deletion
{
	email: string | null;
	sessionIds: string[];
	changes: GroupChange[];
	deletedUniverseIds: string[];
	storageKeys: string[];
}

/**
 * Adds the account deletion route to the auth router
 *
 * @param router The auth router
 * @param underAuthPath A route's path within the router, from its full path
 */
export function addAccountDeletionRoutes(router: Router, underAuthPath: (path: string) => string): void
{
	router.post(underAuthPath(AUTH_ACCOUNT_DELETE_PATH), deleteAccountRoute);
}

/**
 * POST AUTH_ACCOUNT_DELETE_PATH: deletes the logged-in account, once the player confirms it and has
 * decided what becomes of each universe they are the only creator of. Ends every session of the
 * account, and emails the address it had
 *
 * @param request The request, with an AccountDeleteRequest
 * @param response The response: 204, clearing the session cookie
 */
async function deleteAccountRoute(request: Request, response: Response): Promise<void>
{
	const body = accountDeleteRequest.safeParse(request.body);

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

	const { password, twoFactorCode, username, universes, locale: emailLocale } = body.data;
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
			message: deletionMessages.wrongUsername,
			field: 'username'
		});
		return;
	}

	const decisions = new Map(universes.map((decision) => [decision.universeId, decision.newCreatorId]));
	const outcome = await inTransaction(async (executor): Promise<AuthRefusal | Deletion> =>
	{
		await lockPlayer(playerId, executor);

		// Checked before anything changes, and committed even when wrong, so the try counts
		const check = await checkSecondFactor(request, response, playerId, twoFactorCode, now, executor, { trustedBrowserSkips: false });

		if ((check.kind === 'wrong') || (check.kind === 'refused'))
		{
			return(check.refusal);
		}

		return(await deleteAccount(playerId, decisions, executor));
	});

	if ('status' in outcome)
	{
		sendRefusal(response, outcome);
		return;
	}

	clearCookie(response, SESSION_COOKIE);
	response.sendStatus(204);
	connectedSessions.end(outcome.sessionIds);

	for (const universeId of outcome.deletedUniverseIds)
	{
		areaChanges.publish({
			kind: 'universeDeleted',
			universeId
		});
	}

	for (const change of outcome.changes)
	{
		groupChanges.publish(change);
	}

	for (const storageKey of outcome.storageKeys)
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

	if (outcome.email !== null)
	{
		sendEmailInBackground({
			to: outcome.email,
			...accountDeletedEmail(emailLocale)
		});
	}
}

/**
 * Hands on or deletes each universe the player is the only creator of, then deletes the account
 *
 * @param playerId The account
 * @param decisions The new creator of each universe the player is the only creator of, by universe ID; null deletes it
 * @param executor A transaction that has locked the player
 * @return What was deleted, or the refusal when the decisions don't match the player's universes
 */
async function deleteAccount(playerId: string, decisions: ReadonlyMap<string, string | null>, executor: Executor): Promise<AuthRefusal | Deletion>
{
	const deletedUniverseIds: string[] = [];
	const storageKeys: string[] = [];
	const universes: { id: string; newCreatorId: string | null }[] = [];

	// Every decision is checked before any is carried out: the transaction is committed even when refused
	for (const universe of await listSoleCreatedUniverses(playerId, executor))
	{
		await lockUniverse(universe.id, executor);

		const newCreatorId = decisions.get(universe.id);
		const editors = await listOtherUniverseEditors(universe.id, playerId, executor);

		if ((newCreatorId === undefined) || ((newCreatorId !== null) && !editors.some((editor) => (editor.playerId === newCreatorId))))
		{
			return({
				status: 409,
				message: deletionMessages.universesChanged
			});
		}

		universes.push({
			id: universe.id,
			newCreatorId
		});
	}

	for (const universe of universes)
	{
		if (universe.newCreatorId !== null)
		{
			await setUniverseRole(universe.id, universe.newCreatorId, 'creator', executor);
		}
		else
		{
			storageKeys.push(...await listTileGraphicStorageKeys(universe.id, executor));
			await deleteUniverse(universe.id, executor);
			deletedUniverseIds.push(universe.id);
		}
	}

	// Read after the universes are deleted: groups that went with them need no change, since their rooms close
	const memberships = await listPlayerMemberships(playerId, executor);
	const members = await listMembersOfGroups(memberships.map(({ groupId }) => groupId), executor);
	const email = await findPlayerEmail(playerId, executor);
	const sessionIds = await deletePlayerSessions(playerId, executor);

	await deletePlayer(playerId, executor);

	return({
		email,
		sessionIds,
		changes: accountDeletionChanges(memberships, members),
		deletedUniverseIds,
		storageKeys
	});
}
