/**
 * Starfinder 1E's rulebooks (see Rulebooks in STRUCTURE-OVERVIEW.md). Every default race, class, theme and
 * item comes from the Core Rulebook for now
 */
import { defineMessages, type MessageDescriptor } from '../../localization.js';

/**
 * The books, in the order the Ruleset tab lists them: the Core Rulebook, which is always on, first
 */
export const SF1E_RULEBOOKS = ['core'] as const;

export type Sf1eRulebook = typeof SF1E_RULEBOOKS[number];

/**
 * Each book's name
 */
export const SF1E_RULEBOOK_NAMES: Record<Sf1eRulebook, MessageDescriptor> = defineMessages({
	core: {
		id: 'sf1e.rulebook.core',
		defaultMessage: 'Starfinder Core Rulebook',
		description: 'Name of the main rulebook of Starfinder First Edition, on the editor\'s Ruleset tab, as the title of its Contents dialog, on the Audit tab, and as the book an item comes from in the Inspect dialog. Use the title of the book\'s official translated edition where there is one, such as the German "Starfinder Grundregelwerk"'
	}
});
