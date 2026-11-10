/**
 * Deleting an account (see Deleting an account in STRUCTURE-OVERVIEW.md), on the auth router
 *
 * The player confirms with their password, and their authenticator or recovery code when the account
 * has 2FA, or with their username when the account has no password. Each universe they are the only
 * creator of is handed to another of its editors or deleted first, as they chose (GET
 * PROFILE_DELETION_PATH lists them); one a server admin disabled and kept from being deleted can only be
 * handed on. The other editors of a universe deleted are emailed. Groups whose anchor being was one of
 * their characters disband, and every window of theirs is turned away
 */
import type { Request, Response, Router } from 'express';
import { z } from 'zod';
import { AUTH_ACCOUNT_DELETE_PATH, defineMessages, LAST_SERVER_ADMIN_DELETION, MAX_LOCALE_LENGTH, MAX_PASSWORD_LENGTH, MAX_TWO_FACTOR_CODE_INPUT_LENGTH, MAX_USERNAME_LENGTH, UNHANDABLE_TWO_FACTOR_UNIVERSE_DELETION, UNHANDABLE_UNIVERSE_DELETION, type AccountDeleteRequest } from '@multiverse-kiln/shared';

import { forgetChatAuthor } from '../db/chatRepo.js';
import type { Executor } from '../db/client.js';
import { lockContinuation } from '../db/emailCodeRepo.js';
import { listMembersOfGroups, listPlayerMemberships } from '../db/groupRepo.js';
import { deletePlayer, findDisplayName, findEmailRecipient, findPasswordHash, findPlayerEmail, lockPlayer, type EmailRecipient } from '../db/playerRepo.js';
import { isLastServerAdmin } from '../db/serverAdminRepo.js';
import { deletePlayerSessions } from '../db/sessionRepo.js';
import { inTransaction } from '../db/transactions.js';
import { listOtherUniverseEditors, listSoleCreatedUniverses, setUniverseRole } from '../db/universeEditorRepo.js';
import { hasTwoFactor } from '../db/twoFactorRepo.js';
import { findUniverse, isUniverseDeletionPrevented, lockUniverse } from '../db/universeRepo.js';
import { accountDeletedEmail } from '../email/authEmails.js';
import { sendEmailInBackground } from '../email/mailer.js';
import { accountDeletions } from '../players/accountDeletions.js';
import { connectedSessions } from '../players/connectedSessions.js';
import { accountDeletionChanges, groupChanges, type GroupChange } from '../players/groupChanges.js';
import { deleteObjects } from '../storage/objectStorage.js';
import { areaChanges } from '../world/areaChanges.js';
import { authMessages, cookieTokenHash, sendRefusal, type AuthRefusal } from './authCommon.js';
import { clearCookie, CONTINUATION_COOKIE, SESSION_COOKIE } from './cookies.js';
import { sendInvalidRequest } from './errors.js';
import { checkAccountPassword, checkSecondFactor, requireSession } from './twoFactorAuth.js';
import { deleteUniverseWithUploads, emailUniverseDeleted } from './universeDeletion.js';

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
	},
	universeDeletionPrevented: {
		id: 'error.auth.deleteUniversePrevented',
		defaultMessage: 'The site\'s admins disabled {universe} and kept it from being deleted. Make another of its editors its creator.',
		description: 'Why deleting an account was refused: the player chose to delete a universe they are the only creator of, but the site\'s admins disabled it and kept it from being deleted, perhaps a moment ago; {universe} is its name'
	},
	universeNeedsTwoFactor: {
		id: 'error.auth.deleteUniverseNeedsTwoFactor',
		defaultMessage: '{universe} requires its editors to have two-factor authentication on, so it can only be deleted with your account while you have it on. Make another of its editors its creator, or turn on two-factor authentication.',
		description: 'Why deleting an account was refused: the player chose to delete a universe they are the only creator of, but it requires its editors to have two-factor authentication on and the player doesn\'t, perhaps since a moment ago; {universe} is its name'
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
	/**
	 * Where the account was emailed and the name it had, or undefined when it had no address
	 */
	recipient: EmailRecipient | undefined;

	sessionIds: string[];
	changes: GroupChange[];

	/**
	 * The universes deleted with the account, with everyone else who had a role in each, to email
	 */
	deletedUniverses: { id: string; name: string; editorIds: string[] }[];

	/**
	 * The name the account had, which the emails to the deleted universes' editors give
	 */
	displayName: string | null;

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
 * decided what becomes of each universe they are the only creator of. The player confirms with the
 * password and 2FA code, or for an account without a password, the username and a code sent to its
 * address that this browser entered. Ends every session of the account, and emails the address it had
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

		// The session alone isn't enough: without a password, a code sent to the account's address that this
		// browser entered, unless it has no address either. The code goes with the account
		if (!hasPassword && ((await findPlayerEmail(playerId, executor)) !== null))
		{
			const continuationHash = cookieTokenHash(request, CONTINUATION_COOKIE);
			const code = ((continuationHash === undefined) ? undefined : await lockContinuation('deleteAccount', continuationHash, now, executor));

			if (!code || (code.playerId !== playerId))
			{
				return({
					status: 403,
					message: authMessages.enterCodeFirst
				});
			}
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

		return(await deleteAccount(playerId, decisions, executor));
	});

	if ('status' in outcome)
	{
		sendRefusal(response, outcome);
		return;
	}

	clearCookie(response, SESSION_COOKIE);
	clearCookie(response, CONTINUATION_COOKIE);
	response.sendStatus(204);
	connectedSessions.end(outcome.sessionIds);
	accountDeletions.publish(playerId);

	for (const universe of outcome.deletedUniverses)
	{
		areaChanges.publish({
			kind: 'universeDeleted',
			universeId: universe.id
		});
	}

	for (const change of outcome.changes)
	{
		groupChanges.publish(change);
	}

	for (const universe of outcome.deletedUniverses)
	{
		await emailUniverseDeleted(universe.name, universe.editorIds, outcome.displayName);
	}

	await deleteObjects(outcome.storageKeys);

	if (outcome.recipient)
	{
		sendEmailInBackground({
			to: outcome.recipient.email,
			...accountDeletedEmail(outcome.recipient.displayName, emailLocale)
		});
	}
}

/**
 * Hands on or deletes each universe the player is the only creator of, then deletes the account
 *
 * @param playerId The account
 * @param decisions The new creator of each universe the player is the only creator of, by universe ID; null deletes it
 * @param executor A transaction that has locked the player
 * @return What was deleted, or the refusal when the player is the site's only server admin, the
 * decisions don't match the player's universes, or one chosen to be deleted is kept from being deleted
 * or requires 2FA the player doesn't have on
 */
async function deleteAccount(playerId: string, decisions: ReadonlyMap<string, string | null>, executor: Executor): Promise<AuthRefusal | Deletion>
{
	const deletedUniverses: Deletion['deletedUniverses'] = [];
	const storageKeys: string[] = [];
	const universes: { id: string; name: string; newCreatorId: string | null; editorIds: string[] }[] = [];

	// Every check comes before anything changes: the transaction is committed even when refused. Deleting
	// the player deletes their server admin row with them, so the site's only admin can't go
	if (await isLastServerAdmin(playerId, executor))
	{
		return({
			status: 409,
			message: LAST_SERVER_ADMIN_DELETION
		});
	}

	const twoFactor = await hasTwoFactor(playerId, executor);

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

		// Read again once locked: an admin may have disabled it since it was listed
		if ((newCreatorId === null) && await isUniverseDeletionPrevented(universe.id, executor))
		{
			return({
				status: 409,
				message: ((editors.length === 0) ? UNHANDABLE_UNIVERSE_DELETION : deletionMessages.universeDeletionPrevented),
				values: {
					universe: universe.name
				}
			});
		}

		// Read again once locked too: a save may have made it require 2FA since it was listed. Deleting it
		// with the account would otherwise let an account without 2FA do what the editor refuses it
		if ((newCreatorId === null) && !twoFactor && ((await findUniverse(universe.id, executor))?.requireTwoFactor ?? false))
		{
			return({
				status: 409,
				message: ((editors.length === 0) ? UNHANDABLE_TWO_FACTOR_UNIVERSE_DELETION : deletionMessages.universeNeedsTwoFactor),
				values: {
					universe: universe.name
				}
			});
		}

		universes.push({
			id: universe.id,
			name: universe.name,
			newCreatorId,
			editorIds: editors.map((editor) => editor.playerId)
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
			storageKeys.push(...await deleteUniverseWithUploads(universe.id, executor));
			deletedUniverses.push({
				id: universe.id,
				name: universe.name,
				editorIds: universe.editorIds
			});
		}
	}

	// Read after the universes are deleted: groups that went with them need no change, since their rooms close
	const memberships = await listPlayerMemberships(playerId, executor);
	const members = await listMembersOfGroups(memberships.map(({ groupId }) => groupId), executor);
	const recipient = await findEmailRecipient(playerId, executor);
	const displayName = await findDisplayName(playerId, executor);
	const sessionIds = await deletePlayerSessions(playerId, executor);

	await forgetChatAuthor(playerId, executor);
	await deletePlayer(playerId, executor);

	return({
		recipient,
		sessionIds,
		changes: accountDeletionChanges(memberships, members),
		deletedUniverses,
		displayName,
		storageKeys
	});
}
