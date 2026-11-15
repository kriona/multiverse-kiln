/**
 * The world editor's routes for the characters made in a universe (listed in shared/src/editor.ts), for
 * the Character List tab: listing them and showing their sheets, and for creators, deleting them, giving
 * them their last rites, restoring them and taking them out of their groups. Characters belong to their
 * players rather than the universe, so these change them immediately, as their players' own routes do
 */
import type express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { canEditWorld, canManageCharacters, defineMessages, parsePlayerSearch, type CharacterDeletionPayload, type EditorCharacterListPayload, type GroupCharacterRequest, type OptionName } from '@multiverse-kiln/shared';

import { findCharacterPlayerId, findUniverseCharacterDetails, listUniverseCharacters } from '../db/characterRepo.js';
import { loadClassNames } from '../db/classRepo.js';
import { loadRaceNames } from '../db/raceRepo.js';
import { findEditableUniverse } from '../db/universeRepo.js';
import { liveVersion } from '../db/universeVersions.js';
import { characterSheetOf, deleteCharacterNow, giveLastRites, restoreCharacterOf } from './characters.js';
import { requireRole, universeContextOf } from './editorAccess.js';
import { editorCharacterListQuery } from './editorPayloads.js';
import { sendError, sendInvalidRequest } from './errors.js';
import { noSuchGroupMessage, takeOutOfGroup } from './groups.js';
import { UniverseTextTranslator } from './universeTextTranslator.js';

/**
 * GroupCharacterRequest: a character in the universe
 */
const groupCharacterRequest = z.object({
	characterId: z.uuid()
}) satisfies z.ZodType<GroupCharacterRequest>;

/**
 * Reasons the editor's character routes give (see shared/src/localization.ts)
 */
const messages = defineMessages({
	noSuchCharacter: {
		id: 'error.editorNoSuchCharacter',
		defaultMessage: 'The character doesn\'t exist any more.',
		description: 'Why the editor\'s Character List tab couldn\'t show or change a character: their player deleted them, or their last rites are over'
	},
	universeDisabled: {
		id: 'error.universeDisabledCharacters',
		defaultMessage: 'The site\'s admins have disabled this universe, so its characters can\'t be changed.',
		description: 'Why a character couldn\'t be deleted, restored or taken out of their group from the editor\'s Character List tab: one of the site\'s admins disabled the universe'
	}
});

/**
 * Adds the character routes to a universe's router
 *
 * @param router The router for routes under /:universeId
 */
export function addCharacterListRoutes(router: express.Router): void
{
	const manage = [requireRole(canManageCharacters), refuseWhileDisabled];

	router.get('/characters', requireRole(canEditWorld), listCharacters);
	router.get('/characters/:characterId', requireRole(canEditWorld), sheetRoute);
	router.delete('/characters/:characterId', ...manage, deleteRoute);
	router.put('/characters/:characterId/deletion', ...manage, scheduleDeletionRoute);
	router.delete('/characters/:characterId/deletion', ...manage, restoreRoute);
	router.post('/groups/:groupId/leave', ...manage, leaveGroupRoute);
}

/**
 * Middleware that answers 403 while the universe is disabled, except to a server admin, who may fix
 * what it was disabled for
 *
 * @param request The request
 * @param response The response
 * @param next Continues to the next handler
 */
function refuseWhileDisabled(request: Request, response: Response, next: NextFunction): void
{
	const { universe, serverAdmin } = universeContextOf(request);

	if ((universe.disabledReason !== null) && !serverAdmin)
	{
		sendError(response, 403, messages.universeDisabled);
		return;
	}

	next();
}

/**
 * GET /:universeId/characters: a page of the characters made in the universe, filtered
 *
 * @param request The request, with an EditorCharacterListQuery
 * @param response The response
 */
async function listCharacters(request: Request, response: Response): Promise<void>
{
	const query = editorCharacterListQuery.safeParse(request.query);

	if (!query.success)
	{
		sendInvalidRequest(response, query.error);
		return;
	}

	// Characters are the live version's, whatever version the editor has open
	const { universe } = universeContextOf(request);
	const { search, raceId, classId, inGroup, sort, direction, offset, limit } = query.data;
	const parsedSearch = ((search === undefined) ? undefined : parsePlayerSearch(search));
	const [page, raceNames, classNames] = await Promise.all([
		listUniverseCharacters(universe.id, {
			search: ((parsedSearch && (parsedSearch.text !== '')) ? parsedSearch : undefined),
			raceId,
			classId,
			inGroup,
			sort: (sort ?? 'name'),
			direction: (direction ?? 'ascending'),
			offset,
			limit
		}),
		loadRaceNames(liveVersion(universe.id), universe.ruleset),
		loadClassNames(liveVersion(universe.id), universe.ruleset)
	]);
	const unnamed: OptionName = { key: null, name: null };
	const payload: EditorCharacterListPayload = {
		characters: page.characters.map((character) => ({
			id: character.id,
			name: character.name,
			race: (raceNames.get(character.raceId) ?? unnamed),
			characterClass: (classNames.get(character.classId) ?? unnamed),
			player: {
				username: character.playerUsername,
				displayName: character.playerDisplayName
			},
			createdAt: character.createdAt.toISOString(),
			deleteAt: (character.deleteAt?.toISOString() ?? null),
			inGroup: character.inGroup
		})),
		total: page.total
	};

	response.json(payload);
}

/**
 * GET /:universeId/characters/:characterId: any player's character in the universe, as their sheet
 * shows them, with the universe's source text
 *
 * @param request The request
 * @param response The response
 */
async function sheetRoute(request: Request, response: Response): Promise<void>
{
	const characterId = characterIdOf(request, response);

	if (characterId === undefined)
	{
		return;
	}

	// Characters play the live version, whatever version the editor has open, so its coins name their money
	const universe = await findEditableUniverse(liveVersion(universeContextOf(request).universe.id));
	const character = (universe ? await findUniverseCharacterDetails(universe.id, universe.ruleset, characterId) : undefined);

	if (!universe || !character)
	{
		sendError(response, 404, messages.noSuchCharacter);
		return;
	}

	response.json(await characterSheetOf(universe, character, () => Promise.resolve(UniverseTextTranslator.sourceText())));
}

/**
 * DELETE /:universeId/characters/:characterId: deletes a player's character immediately, unless they
 * are in a group
 *
 * @param request The request
 * @param response The response
 */
async function deleteRoute(request: Request, response: Response): Promise<void>
{
	const found = await findCharacterOf(request, response);

	if (!found)
	{
		return;
	}

	const refusal = await deleteCharacterNow(found.playerId, found.universeId, found.characterId, messages.noSuchCharacter);

	if (refusal)
	{
		sendError(response, refusal.status, refusal.message, refusal.values);
		return;
	}

	response.sendStatus(204);
}

/**
 * PUT /:universeId/characters/:characterId/deletion: gives a player's character their last rites, as
 * their player can
 *
 * @param request The request
 * @param response The response
 */
async function scheduleDeletionRoute(request: Request, response: Response): Promise<void>
{
	const found = await findCharacterOf(request, response);

	if (!found)
	{
		return;
	}

	const result = await giveLastRites(found.playerId, found.universeId, found.characterId, messages.noSuchCharacter);

	if (!(result instanceof Date))
	{
		sendError(response, result.status, result.message, result.values);
		return;
	}

	const payload: CharacterDeletionPayload = { deleteAt: result.toISOString() };

	response.json(payload);
}

/**
 * DELETE /:universeId/characters/:characterId/deletion: restores a player's character given their
 * last rites
 *
 * @param request The request
 * @param response The response
 */
async function restoreRoute(request: Request, response: Response): Promise<void>
{
	const found = await findCharacterOf(request, response);

	if (!found)
	{
		return;
	}

	if (!await restoreCharacterOf(found.playerId, found.universeId, found.characterId))
	{
		sendError(response, 404, messages.noSuchCharacter);
		return;
	}

	response.sendStatus(204);
}

/**
 * POST /:universeId/groups/:groupId/leave: takes a player's character out of their group, disbanding it
 * when they are its anchor being
 *
 * @param request The request, with a GroupCharacterRequest
 * @param response The response
 */
async function leaveGroupRoute(request: Request, response: Response): Promise<void>
{
	const groupId = z.uuid().safeParse(request.params.groupId);
	const body = groupCharacterRequest.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const universeId = universeContextOf(request).universe.id;
	const playerId = await findCharacterPlayerId(universeId, body.data.characterId);

	if (!groupId.success || (playerId === undefined) || !await takeOutOfGroup(playerId, universeId, groupId.data, body.data.characterId))
	{
		sendError(response, 404, noSuchGroupMessage);
		return;
	}

	response.sendStatus(204);
}

/**
 * The character a request's path names, answering 404 when the ID can't be one
 *
 * @param request The request
 * @param response The response
 * @return The character's ID, or undefined once the response has been sent
 */
function characterIdOf(request: Request, response: Response): string | undefined
{
	const characterId = z.uuid().safeParse(request.params.characterId);

	if (!characterId.success)
	{
		sendError(response, 404, messages.noSuchCharacter);
		return(undefined);
	}

	return(characterId.data);
}

/**
 * The character a request's path names and their player, answering 404 when the universe has no such
 * character
 *
 * @param request The request
 * @param response The response
 * @return The character, their player and their universe, or undefined once the response has been sent
 */
async function findCharacterOf(request: Request, response: Response): Promise<{ characterId: string; playerId: string; universeId: string } | undefined>
{
	const characterId = characterIdOf(request, response);

	if (characterId === undefined)
	{
		return(undefined);
	}

	const universeId = universeContextOf(request).universe.id;
	const playerId = await findCharacterPlayerId(universeId, characterId);

	if (playerId === undefined)
	{
		sendError(response, 404, messages.noSuchCharacter);
		return(undefined);
	}

	return({
		characterId,
		playerId,
		universeId
	});
}
