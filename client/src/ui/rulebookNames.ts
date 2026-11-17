import { RULEBOOK_NAMES, type Ruleset } from '@multiverse-kiln/shared';

import { t } from '../localization';

/**
 * A book's name, in the player's language
 *
 * @param ruleset The universe's ruleset
 * @param rulebook The book's key
 * @return The name, or the key for a book the ruleset doesn't have
 */
export function rulebookName(ruleset: Ruleset, rulebook: string): string
{
	const name = RULEBOOK_NAMES[ruleset][rulebook];

	return((name ? t(name) : rulebook));
}
