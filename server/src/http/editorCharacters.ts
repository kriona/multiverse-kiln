/**
 * The world editor's routes for the characters made in a universe (listed in shared/src/editor.ts), for
 * the Character List tab: listing them and showing their sheets, and for creators, deleting them, giving
 * them their last rites, restoring them, taking them out of their groups, giving and discarding items,
 * and equipping, unequipping and giving away what they carry.
 * Characters belong to their players rather than the universe, so these change them immediately, as
 * their players' own routes do
 */
import type express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { canEditWorld, canManageCharacters, defineMessages, isUsable, MAX_ITEM_QUANTITY, parsePlayerSearch, type CharacterDeletionPayload, type EditableUniverseDetails, type EditorCharacterListPayload, type GroupCharacterRequest, type MessageDescriptor, type OptionName } from '@multiverse-kiln/shared';

import { findCharacterPlayerId, findUniverseCharacterDetails, giveCharacterItems, listUniverseCharacters, lockCharacters } from '../db/characterRepo.js';
import { loadClassNames } from '../db/classRepo.js';
import { loadEditorItemsIn } from '../db/itemRepo.js';
import { loadRaceNames } from '../db/raceRepo.js';
import { loadRulebookSettings } from '../db/rulesetRepo.js';
import { inTransaction } from '../db/transactions.js';
import { findEditableUniverse, lockUniverseShared } from '../db/universeRepo.js';
import { liveVersion } from '../db/universeVersions.js';
import { characterItemChanges } from '../players/characterItemChanges.js';
import { characterItemsRequest, characterSheetOf, deleteCharacterNow, discardItems, equipItem, equipRequest, giveItems, giveItemsRequest as giveToCharacterRequest, giveLastRites, restoreCharacterOf, unequipItem, unequipRequest } from './characters.js';
import { requireRole, universeContextOf } from './editorAccess.js';
import { editorCharacterListQuery } from './editorPayloads.js';
import { sendError, sendInvalidRequest, type Refusal } from './errors.js';
import { noSuchGroupMessage, takeOutOfGroup } from './groups.js';
import { UniverseTextTranslator } from './universeTextTranslator.js';

/**
 * GroupCharacterRequest: a character in the universe
 */
const groupCharacterRequest = z.object({
	characterId: z.uuid()
}) satisfies z.ZodType<GroupCharacterRequest>;

/**
 * CharacterItemsRequest for giving items, each quantity up to MAX_ITEM_QUANTITY as item selection allows
 */
const giveItemsRequest = characterItemsRequest.refine((request) => request.items.every(({ quantity }) => (quantity <= MAX_ITEM_QUANTITY)), 'Gives more of an item than allowed at once');

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
		description: 'Why a character couldn\'t be deleted, restored, taken out of their group or given items from the editor\'s Character List tab: one of the site\'s admins disabled the universe'
	},
	itemsUnavailable: {
		id: 'error.giveItemsUnavailable',
		defaultMessage: 'Some of those items can\'t be given: they were deleted or disabled, or their rulebook is off. Choose the items again.',
		description: 'Why items weren\'t given to a character from their sheet on the editor\'s Character List tab: an item chosen was deleted, disabled or had its rulebook (a book of optional rules) turned off, perhaps while the creator was choosing'
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
	router.post('/characters/:characterId/items', ...manage, giveItemsRoute);
	router.post('/characters/:characterId/items/discard', ...manage, discardRoute);
	router.post('/characters/:characterId/items/equip', ...manage, itemRoute(equipRequest, equipItem));
	router.post('/characters/:characterId/items/unequip', ...manage, itemRoute(unequipRequest, unequipItem));
	router.post('/characters/:characterId/items/give', ...manage, itemRoute(giveToCharacterRequest, giveItems));
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
 * POST /:universeId/characters/:characterId/items: adds items to what a player's character carries.
 * Characters play the live version, so the items must be enabled there with their books on, whatever
 * version the editor has open
 *
 * @param request The request, with a CharacterItemsRequest
 * @param response The response
 */
async function giveItemsRoute(request: Request, response: Response): Promise<void>
{
	const characterId = characterIdOf(request, response);

	if (characterId === undefined)
	{
		return;
	}

	const body = giveItemsRequest.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const { id: universeId, ruleset } = universeContextOf(request).universe;
	const { items } = body.data;
	let playerId: string | undefined;
	const refusal = await inTransaction(async (transaction): Promise<Refusal | undefined> =>
	{
		// Deleting and disabling items wait for the universe's lock, so none goes while it is given
		await lockUniverseShared(universeId, transaction);
		playerId = (await lockCharacters(universeId, [characterId], transaction)).get(characterId)?.playerId;

		if (playerId === undefined)
		{
			return({ status: 404, message: messages.noSuchCharacter });
		}

		const found = await loadEditorItemsIn(liveVersion(universeId), ruleset, items.map(({ itemId }) => itemId), transaction);
		const { rulebooks } = await loadRulebookSettings(liveVersion(universeId), ruleset, transaction);
		const usableIds = new Set(found
			.filter((item) => isUsable(item, rulebooks))
			.map((item) => item.id));

		if (!items.every(({ itemId }) => usableIds.has(itemId)))
		{
			return({ status: 409, message: messages.itemsUnavailable });
		}

		await giveCharacterItems(characterId, items, transaction);
		return(undefined);
	});

	if (refusal)
	{
		sendError(response, refusal.status, refusal.message, refusal.values);
		return;
	}

	if (playerId !== undefined)
	{
		characterItemChanges.publishChanged(universeId, [{ characterId, playerId }]);
	}

	response.sendStatus(204);
}

/**
 * POST /:universeId/characters/:characterId/items/discard: discards items a player's character
 * carries, as their player can, all of an item when asked for as many as they carry or more
 *
 * @param request The request, with a CharacterItemsRequest
 * @param response The response
 */
async function discardRoute(request: Request, response: Response): Promise<void>
{
	const characterId = characterIdOf(request, response);

	if (characterId === undefined)
	{
		return;
	}

	const body = characterItemsRequest.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const refusal = await discardItems(universeContextOf(request).universe, characterId, body.data.items, undefined, messages.noSuchCharacter);

	if (refusal)
	{
		sendError(response, refusal.status, refusal.message, refusal.values);
		return;
	}

	response.sendStatus(204);
}

/**
 * Makes a route that changes a player's character's items or equipment, as their player can: POST
 * /:universeId/characters/:characterId/items/equip, .../unequip and .../give. Characters play the live
 * version, so its items are used, whatever version the editor has open
 *
 * @param body The request's validator
 * @param change Makes the change, given the universe, the character, the body, undefined for any
 * player's character, and why a character who isn't there can't be changed
 * @return The route, answering 204 once the change is made
 */
function itemRoute<Body>(body: z.ZodType<Body>, change: (universe: Pick<EditableUniverseDetails, 'id' | 'ruleset'>, characterId: string, request: Body, playerId: undefined, noSuchCharacter: MessageDescriptor) => Promise<Refusal | undefined>): (request: Request, response: Response) => Promise<void>
{
	return(async (request, response) =>
	{
		const characterId = characterIdOf(request, response);

		if (characterId === undefined)
		{
			return;
		}

		const parsed = body.safeParse(request.body);

		if (!parsed.success)
		{
			sendInvalidRequest(response, parsed.error);
			return;
		}

		const refusal = await change(universeContextOf(request).universe, characterId, parsed.data, undefined, messages.noSuchCharacter);

		if (refusal)
		{
			sendError(response, refusal.status, refusal.message, refusal.values);
			return;
		}

		response.sendStatus(204);
	});
}

/**
 * POST /:universeId/groups/:groupId/leave: takes a player's character out of their group, disbanding it
 * when they are its anchor being. It isn't limited by how fast the player's characters write notices in
 * the group, so creators can always take out the character of a player who is flooding the group's chat
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
	const refusal: Refusal | undefined = ((groupId.success && (playerId !== undefined))
		? await takeOutOfGroup(playerId, universeId, groupId.data, body.data.characterId, null)
		: {
			status: 404,
			message: noSuchGroupMessage
		});

	if (refusal)
	{
		sendError(response, refusal.status, refusal.message, refusal.values);
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
