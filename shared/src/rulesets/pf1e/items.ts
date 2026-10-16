/**
 * Pathfinder 1E's default items, which a universe can edit, disable or add to
 *
 * Open Game Content from the Pathfinder Roleplaying Game Core Rulebook, used under the Open Game License
 * 1.0a (client/license.html)
 */
import { defineMessages, type MessageDescriptor } from '../../localization.js';

/**
 * Each default item's name, by the item's key. The database stores each name's English text
 */
export const PF1E_DEFAULT_ITEM_NAMES: Record<string, MessageDescriptor> = defineMessages({
	dagger: {
		id: 'item.pf1e.dagger',
		defaultMessage: 'Dagger',
		description: 'Name of an item in Pathfinder: a short blade for stabbing or throwing'
	}
});
