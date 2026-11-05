/**
 * The world editor's route for a universe's items (listed in shared/src/editor.ts), and saving changes
 * to them (see editorChanges.ts)
 */
import type express from 'express';
import type { Request, Response } from 'express';
import { defineMessages, isItemType, MAX_CUSTOM_ITEMS, type ItemDisabling, type ItemSettings, type NewRef, type NumberRef } from '@multiverse-kiln/shared';

import { isCarriedItem } from '../db/characterRepo.js';
import { isClassStartingItem } from '../db/classRepo.js';
import { countCustomItems, createCustomItem, deleteCustomItem, findItemKind, listEditorItems, restoreDefaultItem, saveEditedDefaultItem, updateCustomItem } from '../db/itemRepo.js';
import { isRaceStartingItem } from '../db/raceRepo.js';
import { isStartingItem } from '../db/startingItemRepo.js';
import { deleteUniverseTextOf } from '../db/universeTextRepo.js';
import { universeContextOf } from './editorAccess.js';
import { recordRef, refuse, resolveNumberRef, type ChangeContext } from './editorChangeContext.js';
import { itemListQuery } from './editorPayloads.js';
import { sendInvalidRequest } from './errors.js';

/**
 * Reasons changes to items give in more than one place (see shared/src/localization.ts)
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
 * Adds the item route to a universe's router
 *
 * @param router The router for routes under /:universeId
 */
export function addItemRoutes(router: express.Router): void
{
	router.get('/items', listItems);
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

	const { universe, version } = universeContextOf(request);

	response.json(await listEditorItems(version, universe.ruleset, query.data));
}

/**
 * Adds an item to the universe
 *
 * @param context The save
 * @param ref The item's ref
 * @param settings Its settings
 */
export async function createItemChange(context: ChangeContext, ref: NewRef, settings: ItemSettings): Promise<void>
{
	const { universe, version, transaction } = context;
	const { name } = settings;

	if (name === null)
	{
		refuse(400, messages.itemNeedsName);
	}

	if (!isItemType(universe.ruleset, settings.type))
	{
		refuse(400, messages.unknownItemType);
	}

	if (await countCustomItems(version, transaction) >= MAX_CUSTOM_ITEMS)
	{
		refuse(409, {
			id: 'error.itemLimit',
			defaultMessage: 'A universe can have at most {max, plural, one {# item} other {# items}} of its own.',
			description: 'Why a new item wasn\'t made: the universe has as many items of its own as allowed'
		}, {
			max: MAX_CUSTOM_ITEMS
		});
	}

	recordRef(context, ref, await createCustomItem(version, universe.ruleset, { ...settings, name }, transaction));
}

/**
 * Whether an item is enabled, as the changes before this one left it
 *
 * @param context The save
 * @param itemId The item, which exists
 * @return True when it is
 */
async function isItemEnabled(context: ChangeContext, itemId: number): Promise<boolean>
{
	const { universe, version, transaction } = context;
	const [item] = (await listEditorItems(version, universe.ruleset, { ids: [itemId] }, transaction)).items;

	return(item?.enabled ?? true);
}

/**
 * Changes one of the universe's items, or stores its edited copy of a default item. Once the save has
 * saved every change, an item it disables with remove is taken from the characters carrying it, and one
 * it enables gives back what was taken (see editorDisablings.ts)
 *
 * @param context The save
 * @param id The item
 * @param settings Its new settings
 * @param whenDisabled What disabling it does to the characters carrying it
 */
export async function saveItemChange(context: ChangeContext, id: NumberRef, settings: ItemSettings, whenDisabled: ItemDisabling): Promise<void>
{
	const { universe, version, transaction } = context;
	const itemId = resolveNumberRef(context, id);
	const kind = await findItemKind(version, universe.ruleset, itemId, transaction);
	const { name } = settings;

	if (kind === undefined)
	{
		refuse(404, messages.noSuchItem);
	}

	if (!isItemType(universe.ruleset, settings.type))
	{
		refuse(400, messages.unknownItemType);
	}

	context.disablings.item(itemId, await isItemEnabled(context, itemId), (settings.enabled ? undefined : whenDisabled));

	if (kind === 'default')
	{
		await saveEditedDefaultItem(version, universe.ruleset, itemId, settings, transaction);
	}
	else if (name === null)
	{
		refuse(400, messages.itemNeedsName);
	}
	else
	{
		await updateCustomItem(version, itemId, { ...settings, name }, transaction);
	}
}

/**
 * Deletes one of the universe's own items if characters don't start with it or carry it, or restores a
 * default item the universe has edited
 *
 * @param context The save
 * @param id The item
 */
export async function removeItemChange(context: ChangeContext, id: NumberRef): Promise<void>
{
	const { universe, version, transaction } = context;
	const itemId = resolveNumberRef(context, id);
	const kind = await findItemKind(version, universe.ruleset, itemId, transaction);

	if (kind === undefined)
	{
		refuse(404, messages.noSuchItem);
	}

	// Default items are enabled, so restoring one gives back what was taken while it was disabled
	if (kind === 'default')
	{
		context.disablings.item(itemId, await isItemEnabled(context, itemId));
		await restoreDefaultItem(version, itemId, transaction);
		await deleteUniverseTextOf(version, 'item', itemId, transaction);
		return;
	}

	// Saving the starting equipment and making a character wait for the universe's lock too, so the
	// item can't be added to either before it is deleted
	if (await isStartingItem(version, itemId, transaction) || await isRaceStartingItem(version, itemId, transaction) || await isClassStartingItem(version, itemId, transaction))
	{
		refuse(409, {
			id: 'error.itemInStartingEquipment',
			defaultMessage: 'Characters start with this item, so it can\'t be deleted. Take it out of the starting equipment of the universe and of every race and class first.',
			description: 'Why an item couldn\'t be deleted: it is in the equipment characters of the universe, or of one of its races or classes, start with'
		});
	}

	if (await isCarriedItem(itemId, transaction))
	{
		refuse(409, {
			id: 'error.itemCarried',
			defaultMessage: 'Characters carry this item, so it can\'t be deleted. Disable it instead.',
			description: 'Why an item the universe added couldn\'t be deleted: players\' characters have it; disabling it only stops new characters being given it'
		});
	}

	await deleteCustomItem(version, itemId, transaction);
	await deleteUniverseTextOf(version, 'item', itemId, transaction);
}
