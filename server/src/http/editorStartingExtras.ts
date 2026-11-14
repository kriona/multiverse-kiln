/**
 * Checks the editor's routes make on what characters start with and where: the universe's own
 * settings, and each race's and class's
 */
import { defineMessages } from '@multiverse-kiln/shared';

import { loadEditorItemsIn } from '../db/itemRepo.js';
import { findAreaIdsIn } from '../db/areaRepo.js';
import { refuse, type ChangeContext } from './editorChangeContext.js';

/**
 * Why starting settings were refused (see shared/src/localization.ts)
 */
export const startingMessages = defineMessages({
	unusableStartingArea: {
		id: 'error.unusableStartingArea',
		defaultMessage: 'The starting area must be an area of this universe other than the lobby.',
		description: 'Why a starting area (the universe\'s, a race\'s or a class\'s) was refused: the area chosen for characters to start in is the lobby, or was deleted, perhaps by another editor'
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
	 * Areas characters would start in
	 */
	areaIds?: readonly string[];

	/**
	 * Items characters would start with
	 */
	itemIds?: readonly number[];
}

/**
 * Refuses starting settings that name an area that isn't one of the universe's, or an item the universe
 * can't use. A starting area below the lobby region is refused once the save's changes are made, so one
 * save can move the lobby and the starting areas past each other
 *
 * @param context The save
 * @param references The areas and items the settings name
 */
export async function checkStartingReferences(context: ChangeContext, references: StartingReferences): Promise<void>
{
	const { universe, version, transaction } = context;
	const { areaIds = [], itemIds = [] } = references;

	if (areaIds.length > 0)
	{
		const foundAreaIds = await findAreaIdsIn(version, areaIds, transaction);

		if (!areaIds.every((areaId) => foundAreaIds.has(areaId)))
		{
			refuse(400, startingMessages.unusableStartingArea);
		}

		context.places.checkLobby();
	}

	if (itemIds.length > 0)
	{
		const usableItemIds = new Set((await loadEditorItemsIn(version, universe.ruleset, itemIds, transaction)).map((item) => item.id));

		if (!itemIds.every((itemId) => usableItemIds.has(itemId)))
		{
			refuse(400, startingMessages.unusableStartingItem);
		}
	}
}
