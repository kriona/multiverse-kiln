/**
 * The world editor's routes for a universe's items (listed in shared/src/editor.ts)
 */
import type express from 'express';
import type { Request, Response } from 'express';
import { canEditWorld, defineMessages, isItemType, MAX_CUSTOM_ITEMS, type CreatedPayload } from '@multiverse-kiln/shared';

import { countCustomItems, createCustomItem, deleteCustomItem, findItemKind, listEditorItems, restoreDefaultItem, saveEditedDefaultItem, updateCustomItem } from '../db/itemRepo.js';
import { isStartingItem } from '../db/startingItemRepo.js';
import { inTransaction } from '../db/transactions.js';
import { lockUniverse } from '../db/universeRepo.js';
import { requireRole, universeContextOf } from './editorAccess.js';
import { itemIdParameter, itemListQuery, itemSettings } from './editorPayloads.js';
import { sendError, sendInvalidRequest } from './errors.js';

/**
 * Reasons the item routes give in more than one place (see shared/src/localization.ts)
 */
const messages = defineMessages({
	noSuchItem: {
		id: 'error.noSuchItem',
		defaultMessage: 'The item doesn\'t exist.',
		description: 'Why a request about an item failed: it was deleted, perhaps by another editor'
	},
	itemNeedsName: {
		id: 'error.itemNeedsName',
		defaultMessage: 'An item needs a name.',
		description: 'Why an item the universe added couldn\'t be saved: its name was left out'
	},
	unknownItemType: {
		id: 'error.unknownItemType',
		defaultMessage: 'The universe\'s ruleset has no such type of item.',
		description: 'Why an item couldn\'t be saved: the type chosen for it isn\'t one of the game rules\' item types'
	}
});

/**
 * Adds the item routes to a universe's router
 *
 * @param router The router for routes under /:universeId
 */
export function addItemRoutes(router: express.Router): void
{
	router.get('/items', listItems);
	router.post('/items', requireRole(canEditWorld), createItemRoute);
	router.put('/items/:itemId', requireRole(canEditWorld), saveItem);
	router.delete('/items/:itemId', requireRole(canEditWorld), deleteItem);
}

/**
 * GET /:universeId/items: a page of the universe's items, filtered
 *
 * @param request The request
 * @param response The response
 */
async function listItems(request: Request, response: Response): Promise<void>
{
	const query = itemListQuery.safeParse(request.query);

	if (!query.success)
	{
		sendInvalidRequest(response, query.error);
		return;
	}

	const { universe } = universeContextOf(request);

	response.json(await listEditorItems(universe.id, universe.ruleset, query.data));
}

/**
 * POST /:universeId/items: adds an item to the universe
 *
 * @param request The request
 * @param response The response
 */
async function createItemRoute(request: Request, response: Response): Promise<void>
{
	const body = itemSettings.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const { universe } = universeContextOf(request);
	const { name, type } = body.data;

	if (name === null)
	{
		sendError(response, 400, messages.itemNeedsName);
		return;
	}

	if (!isItemType(universe.ruleset, type))
	{
		sendError(response, 400, messages.unknownItemType);
		return;
	}

	const itemId = await inTransaction(async (transaction) =>
	{
		await lockUniverse(universe.id, transaction);

		if (await countCustomItems(universe.id, transaction) >= MAX_CUSTOM_ITEMS)
		{
			return(undefined);
		}

		return(createCustomItem(universe.id, universe.ruleset, { ...body.data, name }, transaction));
	});

	if (itemId === undefined)
	{
		sendError(response, 409, {
			id: 'error.itemLimit',
			defaultMessage: 'A universe can have at most {max, plural, one {# item} other {# items}} of its own.',
			description: 'Why a new item wasn\'t made: the universe has as many items of its own as allowed'
		}, { max: MAX_CUSTOM_ITEMS });
		return;
	}

	const payload: CreatedPayload<number> = { id: itemId };

	response.status(201).json(payload);
}

/**
 * PUT /:universeId/items/:itemId: changes one of the universe's items, or stores its edited copy of a default item
 *
 * @param request The request
 * @param response The response
 */
async function saveItem(request: Request, response: Response): Promise<void>
{
	const itemId = itemIdParameter.safeParse(request.params.itemId);
	const body = itemSettings.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const { universe } = universeContextOf(request);
	const kind = (itemId.success ? await findItemKind(universe.id, universe.ruleset, itemId.data) : undefined);

	if (!itemId.success || (kind === undefined))
	{
		sendError(response, 404, messages.noSuchItem);
		return;
	}

	const { name, type } = body.data;

	if (!isItemType(universe.ruleset, type))
	{
		sendError(response, 400, messages.unknownItemType);
		return;
	}

	if (kind === 'default')
	{
		await saveEditedDefaultItem(universe.id, universe.ruleset, itemId.data, body.data);
	}
	else if (name === null)
	{
		sendError(response, 400, messages.itemNeedsName);
		return;
	}
	else
	{
		await updateCustomItem(universe.id, itemId.data, { ...body.data, name });
	}

	response.sendStatus(204);
}

/**
 * DELETE /:universeId/items/:itemId: deletes one of the universe's own items if characters don't start
 * with it, or restores a default item the universe has edited
 *
 * @param request The request
 * @param response The response
 */
async function deleteItem(request: Request, response: Response): Promise<void>
{
	const itemId = itemIdParameter.safeParse(request.params.itemId);
	const { universe } = universeContextOf(request);
	const kind = (itemId.success ? await findItemKind(universe.id, universe.ruleset, itemId.data) : undefined);

	if (!itemId.success || (kind === undefined))
	{
		sendError(response, 404, messages.noSuchItem);
		return;
	}

	if (kind === 'default')
	{
		await restoreDefaultItem(universe.id, itemId.data);
		response.sendStatus(204);
		return;
	}

	const deleted = await inTransaction(async (transaction) =>
	{
		// Saving the starting equipment waits for the universe's lock too, so the item can't be added to it before it is deleted
		await lockUniverse(universe.id, transaction);

		if (await isStartingItem(universe.id, itemId.data, transaction))
		{
			return(false);
		}

		await deleteCustomItem(universe.id, itemId.data, transaction);

		return(true);
	});

	if (!deleted)
	{
		sendError(response, 409, {
			id: 'error.itemInStartingEquipment',
			defaultMessage: 'Characters start with this item, so it can\'t be deleted. Take it out of the starting equipment first.',
			description: 'Why an item couldn\'t be deleted: it is in the equipment every character of the universe starts with'
		});
		return;
	}

	response.sendStatus(204);
}
