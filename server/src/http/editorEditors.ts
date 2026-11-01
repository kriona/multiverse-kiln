/**
 * The world editor's routes for a universe's editors (listed in shared/src/editor.ts), and saving
 * changes to them (see editorChanges.ts)
 */
import type express from 'express';
import type { Request, Response } from 'express';
import { canManageEditors, canPlayUniverse, defineMessages, MAX_PLAYER_SEARCH_RESULTS, parsePlayerSearch, type EditorRoleSettings, type PlayerSearchPayload, type UniverseEditorListPayload } from '@multiverse-kiln/shared';

import { findPlayerByUsername } from '../db/playerRepo.js';
import { countUniverseCreators, findUniverseAccess, listUniverseEditors, removeUniverseEditor, searchPlayersToAdd, setUniverseAccess } from '../db/universeEditorRepo.js';
import { requireRole, universeContextOf } from './editorAccess.js';
import { refuse, type ChangeContext } from './editorChangeContext.js';
import { playerSearchQuery } from './editorPayloads.js';
import { sendInvalidRequest } from './errors.js';

/**
 * Reasons changes to editors give in more than one place (see shared/src/localization.ts)
 */
export const editorMessages = defineMessages({
	noSuchPlayer: {
		id: 'error.noSuchPlayerToAdd',
		defaultMessage: 'No player has that username.',
		description: 'Why a player couldn\'t be added to a universe\'s editors, shown on the editor\'s Editors tab: no account has the username chosen, perhaps because the player changed it or deleted their account'
	},
	noSuchEditor: {
		id: 'error.noSuchEditor',
		defaultMessage: 'They are no longer one of the universe\'s editors.',
		description: 'Why a change to one of a universe\'s editors couldn\'t be saved: someone else took their role away, or they left the universe'
	}
});

/**
 * Adds the editor routes to a universe's router
 *
 * @param router The router for routes under /:universeId
 */
export function addEditorListRoutes(router: express.Router): void
{
	router.get('/editors', listEditors);
	router.get('/editors/search', requireRole(canManageEditors), searchPlayers);
}

/**
 * GET /:universeId/editors: everyone with a role in the universe
 *
 * @param request The request
 * @param response The response
 */
async function listEditors(request: Request, response: Response): Promise<void>
{
	const payload: UniverseEditorListPayload = { editors: await listUniverseEditors(universeContextOf(request).universe.id) };

	response.json(payload);
}

/**
 * GET /:universeId/editors/search: players to add to the universe's editors, by username or name, for
 * the Editors tab to offer as they are typed. Profiles can be read by anyone, so this tells nothing a
 * player's page wouldn't
 *
 * @param request The request, with a PlayerSearchQuery
 * @param response The response
 */
async function searchPlayers(request: Request, response: Response): Promise<void>
{
	const query = playerSearchQuery.safeParse(request.query);

	if (!query.success)
	{
		sendInvalidRequest(response, query.error);
		return;
	}

	const payload: PlayerSearchPayload = {
		players: await searchPlayersToAdd(universeContextOf(request).universe.id, parsePlayerSearch(query.data.query), MAX_PLAYER_SEARCH_RESULTS)
	};

	response.json(payload);
}

/**
 * Gives a player a role in the universe
 *
 * @param context The save
 * @param username The player's username
 * @param settings Their role and languages
 */
export async function addEditorChange(context: ChangeContext, username: string, settings: EditorRoleSettings): Promise<void>
{
	const { universe, transaction } = context;
	const player = await findPlayerByUsername(username, transaction);

	if (!player)
	{
		refuse(404, editorMessages.noSuchPlayer);
	}

	if (await findUniverseAccess(universe.id, player.id, transaction))
	{
		refuse(409, {
			id: 'error.alreadyEditor',
			defaultMessage: '{username} already has a role in this universe.',
			description: 'Why a player couldn\'t be added to a universe\'s editors: they are one already; {username} is their username'
		}, {
			username: player.username
		});
	}

	await setUniverseAccess(universe.id, player.id, settings, transaction);
	context.editorRoles.set(player.id, settings.role);
}

/**
 * Changes an editor's role and languages
 *
 * @param context The save
 * @param playerId The editor's player ID
 * @param settings Their role and languages
 */
export async function saveEditorChange(context: ChangeContext, playerId: string, settings: EditorRoleSettings): Promise<void>
{
	const { universe, transaction } = context;

	if (!await findUniverseAccess(universe.id, playerId, transaction))
	{
		refuse(404, editorMessages.noSuchEditor);
	}

	await setUniverseAccess(universe.id, playerId, settings, transaction);
	context.editorRoles.set(playerId, settings.role);
}

/**
 * Takes an editor's role away, or lets the player making the save leave the universe
 *
 * @param context The save
 * @param playerId The editor's player ID
 */
export async function removeEditorChange(context: ChangeContext, playerId: string): Promise<void>
{
	if (!await removeUniverseEditor(context.universe.id, playerId, context.transaction))
	{
		refuse(404, editorMessages.noSuchEditor);
	}

	context.editorRoles.set(playerId, undefined);
}

/**
 * Refuses a save whose changes to the editors leave the universe without a creator. Called once every
 * change is made, so a save can hand the role to another editor before taking it from the last one
 *
 * @param context The save
 */
export async function checkCreatorKept(context: ChangeContext): Promise<void>
{
	if ((context.editorRoles.size > 0) && (await countUniverseCreators(context.universe.id, context.transaction) === 0))
	{
		refuse(409, {
			id: 'error.lastCreator',
			defaultMessage: 'A universe needs at least one creator. Make another editor a creator first.',
			description: 'Why changes to a universe\'s editors couldn\'t be saved: they would take the role of creator from its last creator, whether by changing their role, removing them or them leaving'
		});
	}
}

/**
 * The editors a save took the right to play the universe from, in the stage it is in once saved
 *
 * @param context The save, once committed
 * @return Their player IDs
 */
export function playersLosingAccess(context: ChangeContext): Set<string>
{
	const lost = new Set<string>();

	for (const [playerId, role] of context.editorRoles)
	{
		if (!canPlayUniverse(context.universe.stage, role))
		{
			lost.add(playerId);
		}
	}

	return(lost);
}
