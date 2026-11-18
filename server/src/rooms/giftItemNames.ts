import type { KeptChatMessage, OptionName } from '@multiverse-kiln/shared';

import { loadLiveItemNames } from '../db/itemRepo.js';
import { findUniverse } from '../db/universeRepo.js';
import { UniverseTextTranslator } from '../http/universeTextTranslator.js';

/**
 * Names the item in a gave notice; returns any other message as it is
 *
 * @param message A chat message
 * @return The message, with a gave notice's item named
 */
export type GiftItemNamer = (message: KeptChatMessage) => KeptChatMessage;

/**
 * The IDs of the items the gave notices among some chat messages give
 *
 * @param messages The messages
 * @return The IDs, each once
 */
function giftItemIds(messages: readonly KeptChatMessage[]): number[]
{
	return([...new Set(messages.flatMap((message) => (((message.notice === 'gave') && (message.details?.itemId !== undefined)) ? [message.details.itemId] : [])))]);
}

/**
 * Loads what the items the gave notices among a chat's messages give are called now, in the languages a
 * window wants universe text in, for the chat's history as the window is sent it: the universe's name
 * for an item, translated, or a default item's key. However many notices there are, it looks the
 * universe up, then the items' names and their translations, once each
 *
 * @param universeId The chat's universe
 * @param messages The chat's messages
 * @param languages The languages the window wants universe text in, most wanted first (windowLanguages())
 * @return Names the items in the gave notices among those messages. A notice whose item is since
 * deleted, or that has no item ID, keeps the name it holds, as does every notice when the universe is gone
 */
export async function loadGiftItemNames(universeId: string, messages: readonly KeptChatMessage[], languages: readonly string[]): Promise<GiftItemNamer>
{
	const itemIds = giftItemIds(messages);
	const universe = ((itemIds.length === 0) ? undefined : await findUniverse(universeId));

	if (!universe)
	{
		return((message) => message);
	}

	const [names, translator] = await Promise.all([
		loadLiveItemNames([universe], itemIds),
		UniverseTextTranslator.load(universe, languages, [{ kind: 'item', thingIds: itemIds }])
	]);
	const current = (names.get(universe.id) ?? new Map<number, OptionName>());

	return((message) =>
	{
		const itemId = ((message.notice === 'gave') ? message.details?.itemId : undefined);
		const item = ((itemId === undefined) ? undefined : current.get(itemId));

		if (!message.details || (itemId === undefined) || !item)
		{
			return(message);
		}

		return({
			...message,
			details: {
				...message.details,
				item: translator.name('item', itemId, item)
			}
		});
	});
}
