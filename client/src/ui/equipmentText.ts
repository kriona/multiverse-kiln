import { HELD_EQUIPMENT_NAMES, unequippedByRemoval, type EquippedItem, type Ruleset } from '@multiverse-kiln/shared';

import { formatList, t } from '../localization';
import { slotText } from './itemNames';

/**
 * What a dialog that takes some of an item from a character (Discard, Give) says it unequips, from the
 * equipped ones the character would have more of than they carry
 *
 * @param ruleset The universe's ruleset
 * @param equipment The character's equipment
 * @param itemId The item
 * @param remaining How many of it the character carries afterward
 * @return The sentence, or an empty string when nothing is unequipped
 */
export function unequipNote(ruleset: Ruleset, equipment: readonly EquippedItem[], itemId: number, remaining: number): string
{
	const unequipped = unequippedByRemoval(ruleset, equipment, itemId, remaining);

	if (unequipped.length === 0)
	{
		return('');
	}

	return(t({
		id: 'characterSheet.unequipNote',
		defaultMessage: 'This unequips it from {slots}.',
		description: 'In the dialogs that discard an item a character carries or give it to another character, when they would no longer carry as many as they have equipped; {slots} lists the equipment slots it is taken from, such as "Off hand and Main hand"'
	}, {
		slots: formatList(unequipped.map((equipped) => (equipped.bothHands ? t(HELD_EQUIPMENT_NAMES.bothHands) : slotText(equipped.slot, ruleset))))
	}));
}
