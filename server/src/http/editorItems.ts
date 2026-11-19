/**
 * The world editor's route for a universe's items (listed in shared/src/editor.ts), and saving changes
 * to them (see editorChanges.ts)
 */
import type express from 'express';
import type { Request, Response } from 'express';
import { canEditWorld, defineMessages, isItemEquips, isItemKind, MAX_CUSTOM_ITEMS, type ItemDisabling, type ItemSettings, type NewRef, type NumberRef, type Ruleset } from '@multiverse-kiln/shared';

import { isCarriedItem } from '../db/characterRepo.js';
import { isClassStartingItem } from '../db/classRepo.js';
import { countCustomItems, createCustomItem, deleteCustomItem, findDefaultItemIds, findItem, listEditorItems, restoreDefaultItem, saveEditedDefaultItem, updateCustomItem } from '../db/itemRepo.js';
import { isRaceStartingItem } from '../db/raceRepo.js';
import { isStartingItem } from '../db/startingItemRepo.js';
import { deleteUniverseTextOf } from '../db/universeTextRepo.js';
import { requireRole, universeContextOf } from './editorAccess.js';
import { recordRef, refuse, resolveNumberRef, type ChangeContext } from './editorChangeContext.js';
import { itemListQuery } from './editorPayloads.js';
import { savedRulebooks } from './editorRulebooks.js';
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
		defaultMessage: 'The universe\'s ruleset has no such kind or type of item.',
		description: 'Why an item couldn\'t be saved: the kind (such as weapons) or a type (such as light blades) chosen for it isn\'t one of the game rules\', or a type isn\'t of its kind'
	},
	unknownItemEquips: {
		id: 'error.unknownItemEquips',
		defaultMessage: 'The universe\'s ruleset has nowhere like that to equip an item.',
		description: 'Why an item couldn\'t be saved: where it equips (such as one hand or the head), chosen in the item editor\'s "Equips to" field, isn\'t one of the game rules\''
	},
	invalidItemLooksLike: {
		id: 'error.invalidItemLooksLike',
		defaultMessage: 'An item can only look like one of the game rules\' own items, and only an item the universe added can choose one.',
		description: 'Why an item couldn\'t be saved: the item chosen in the item editor\'s "Looks like" field (whose drawing the item uses on characters\' avatars) isn\'t one of the ruleset\'s default items, or the item being saved is a default item, which always uses its own drawing'
	}
});

/**
 * The IDs of the universe's ruleset's default items, read once per save and kept on the context
 *
 * @param context The save
 * @return The IDs
 */
async function defaultItemIdsOf(context: ChangeContext): Promise<ReadonlySet<number>>
{
	context.defaultItemIds ??= new Set((await findDefaultItemIds(context.universe.ruleset, context.transaction)).values());

	return(context.defaultItemIds);
}

/**
 * Refuses an item's "Looks like" unless it is none, or a default item of the universe's ruleset chosen
 * for an item the universe added
 *
 * @param context The save
 * @param custom Whether the universe added the item
 * @param settings The item's settings
 */
async function checkItemLooksLike(context: ChangeContext, custom: boolean, settings: ItemSettings): Promise<void>
{
	const { looksLikeItemId } = settings;

	if ((looksLikeItemId !== null) && (!custom || !(await defaultItemIdsOf(context)).has(looksLikeItemId)))
	{
		refuse(400, messages.invalidItemLooksLike);
	}
}

/**
 * Refuses an item's kind, types or place to equip that the universe's ruleset doesn't have
 *
 * @param ruleset The universe's ruleset
 * @param settings The item's settings
 */
function checkItemSettings(ruleset: Ruleset, settings: ItemSettings): void
{
	if (!isItemKind(ruleset, settings))
	{
		refuse(400, messages.unknownItemType);
	}

	if (!isItemEquips(ruleset, settings.equips))
	{
		refuse(400, messages.unknownItemEquips);
	}
}

/**
 * Adds the item route to a universe's router
 *
 * @param router The router for routes under /:universeId
 */
export function addItemRoutes(router: express.Router): void
{
	router.get('/items', requireRole(canEditWorld), listItems);
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

	checkItemSettings(universe.ruleset, settings);
	await checkItemLooksLike(context, true, settings);

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
 * Changes one of the universe's items, or stores its edited copy of a default item. Once the save has
 * saved every change, an item it disables with remove is taken from the characters carrying it, and one
 * it enables gives back what was taken, and an item that equips somewhere else, or became or stopped
 * being a shield or a weapon, is unequipped (see editorDisablings.ts)
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
	const item = await findItem(version, universe.ruleset, itemId, transaction);
	const { name } = settings;

	if (item === undefined)
	{
		refuse(404, messages.noSuchItem);
	}

	checkItemSettings(universe.ruleset, settings);
	await checkItemLooksLike(context, (item.kind === 'custom'), settings);
	context.disablings.item({ ...item, id: itemId }, await savedRulebooks(context), { whenDisabled: (settings.enabled ? undefined : whenDisabled) });
	context.disablings.itemEquipping(universe.ruleset, { ...item, id: itemId });

	if (item.kind === 'default')
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
	const item = await findItem(version, universe.ruleset, itemId, transaction);

	if (item === undefined)
	{
		refuse(404, messages.noSuchItem);
	}

	// Default items are enabled, so restoring one gives back what was taken while it was disabled
	if (item.kind === 'default')
	{
		context.disablings.item({ ...item, id: itemId }, await savedRulebooks(context));
		context.disablings.itemEquipping(universe.ruleset, { ...item, id: itemId });
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
