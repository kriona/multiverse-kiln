/**
 * Checks the editor's routes make on what characters start with and where: the universe's own
 * settings, and each race's and class's
 */
import { defineMessages, type MessageDescriptor } from '@multiverse-kiln/shared';

import type { Executor } from '../db/client.js';
import { loadEditorItems } from '../db/itemRepo.js';
import { listZones } from '../db/zoneRepo.js';
import type { UniverseContext } from './editorAccess.js';

/**
 * Why starting settings were refused (see shared/src/localization.ts)
 */
export const startingMessages = defineMessages({
	unusableStartingZone: {
		id: 'error.unusableStartingZone',
		defaultMessage: 'The starting zone must be a zone of this universe other than the lobby.',
		description: 'Why a starting zone (the universe\'s, a race\'s or a class\'s) was refused: the zone chosen for characters to start in is the lobby, or was deleted, perhaps by another editor'
	},
	unusableStartingItem: {
		id: 'error.unusableStartingItem',
		defaultMessage: 'The starting equipment holds an item this universe doesn\'t have.',
		description: 'Why starting equipment (the universe\'s, a race\'s or a class\'s) was refused: one of its items was deleted, perhaps by another editor'
	}
});

/**
 * What starting settings name, to check against the universe
 */
export interface StartingReferences
{
	/**
	 * Zones characters would start in
	 */
	zoneIds?: readonly string[];

	/**
	 * Items characters would start with
	 */
	itemIds?: readonly number[];
}

/**
 * Why starting settings can't be saved: a zone that isn't one of the universe's or is its lobby, or
 * an item the universe can't use
 *
 * @param universe The universe
 * @param references The zones and items the settings name
 * @param executor The database, or a transaction
 * @return The reason, or undefined when they can be saved
 */
export async function findStartingProblem(universe: UniverseContext['universe'], references: StartingReferences, executor: Executor): Promise<MessageDescriptor | undefined>
{
	const { zoneIds = [], itemIds = [] } = references;

	if (zoneIds.length > 0)
	{
		const usableZoneIds = new Set((await listZones(universe.id, executor))
			.map((zone) => zone.id)
			.filter((zoneId) => (zoneId !== universe.lobbyZoneId)));

		if (!zoneIds.every((zoneId) => usableZoneIds.has(zoneId)))
		{
			return(startingMessages.unusableStartingZone);
		}
	}

	if (itemIds.length > 0)
	{
		const usableItemIds = new Set((await loadEditorItems(universe.id, universe.ruleset, executor)).map((item) => item.id));

		if (!itemIds.every((itemId) => usableItemIds.has(itemId)))
		{
			return(startingMessages.unusableStartingItem);
		}
	}

	return(undefined);
}
