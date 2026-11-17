/**
 * The rulebooks each ruleset's races, classes, themes and items come from, and which of them a universe
 * uses (see Rulebooks in STRUCTURE-OVERVIEW.md)
 */
import type { RulesetSettings } from './editor.js';
import type { MessageDescriptor } from './localization.js';
import { PF1E_RULEBOOK_NAMES, PF1E_RULEBOOKS } from './rulesets/pf1e/rulebooks.js';
import { SF1E_RULEBOOK_NAMES, SF1E_RULEBOOKS } from './rulesets/sf1e/rulebooks.js';
import type { Ruleset } from './universes.js';

/**
 * Every ruleset's core rulebook, which is always on
 */
export const CORE_RULEBOOK = 'core';

/**
 * Each ruleset's books, in the order the Ruleset tab lists them, the core rulebook first
 */
export const RULESET_RULEBOOKS: Record<Ruleset, readonly string[]> = {
	pf1e: PF1E_RULEBOOKS,
	sf1e: SF1E_RULEBOOKS
};

/**
 * Each ruleset's book names, by the book's key
 */
export const RULEBOOK_NAMES: Record<Ruleset, Record<string, MessageDescriptor>> = {
	pf1e: PF1E_RULEBOOK_NAMES,
	sf1e: SF1E_RULEBOOK_NAMES
};

/**
 * Which books a universe uses, saved with its ruleset's settings
 */
export interface RulebookSettings
{
	/**
	 * The optional books turned on, in the order RULESET_RULEBOOKS lists them. The core rulebook is
	 * always on, so it is never listed
	 */
	rulebooks: string[];

	/**
	 * The optional books turned off whose races' and classes' characters can't play until the book is on
	 * again, as the editor chose when turning it off
	 */
	barredRulebooks: string[];
}

/**
 * The books a universe can turn on and off
 *
 * @param ruleset The universe's ruleset
 * @return Every book but the core rulebook, in the order the Ruleset tab lists them
 */
export function optionalRulebooks(ruleset: Ruleset): string[]
{
	return(RULESET_RULEBOOKS[ruleset].filter((rulebook) => (rulebook !== CORE_RULEBOOK)));
}

/**
 * Whether what a book brings shows in a universe
 *
 * @param rulebooks The optional books the universe has on
 * @param rulebook The book, or null for something the universe added, which belongs to no book
 * @return True for the core rulebook, a book that is on, and null
 */
export function isRulebookOn(rulebooks: readonly string[], rulebook: string | null): boolean
{
	return((rulebook === null) || (rulebook === CORE_RULEBOOK) || rulebooks.includes(rulebook));
}

/**
 * Whether a race, class, theme or item can be chosen or given: its own Enabled box is checked, and its
 * book is on
 *
 * @param option Whether it is enabled, and its book (null for one the universe added)
 * @param rulebooks The optional books the universe has on
 * @return True when it is usable
 */
export function isUsable(option: { enabled: boolean; rulebook: string | null }, rulebooks: readonly string[]): boolean
{
	return(option.enabled && isRulebookOn(rulebooks, option.rulebook));
}

/**
 * Whether the characters of a book's races and classes can't play because the book is off
 *
 * @param settings The universe's books
 * @param rulebook The book, or null for something the universe added
 * @return True when the book is off and was turned off without letting its characters keep playing
 */
export function isRulebookBarred(settings: RulebookSettings, rulebook: string | null): boolean
{
	return(!isRulebookOn(settings.rulebooks, rulebook) && (rulebook !== null) && settings.barredRulebooks.includes(rulebook));
}

/**
 * A universe's ruleset settings with other books
 *
 * @param ruleset The settings
 * @param rulebooks The books
 * @return The settings, with the books in place of theirs
 */
export function withRulebooks(ruleset: RulesetSettings, rulebooks: RulebookSettings): RulesetSettings
{
	switch (ruleset.ruleset)
	{
		case 'pf1e':
			return({
				ruleset: ruleset.ruleset,
				settings: {
					...ruleset.settings,
					...rulebooks
				}
			});

		case 'sf1e':
			return({
				ruleset: ruleset.ruleset,
				settings: {
					...ruleset.settings,
					...rulebooks
				}
			});
	}
}

/**
 * A universe's books as they are saved: only its ruleset's optional books, each once and in the order
 * the Ruleset tab lists them, and only books that are off barred
 *
 * @param ruleset The universe's ruleset
 * @param settings The books as sent
 * @return The books to save
 */
export function normalizedRulebooks(ruleset: Ruleset, settings: RulebookSettings): RulebookSettings
{
	const optional = optionalRulebooks(ruleset);
	const rulebooks = optional.filter((rulebook) => settings.rulebooks.includes(rulebook));

	return({
		rulebooks,
		barredRulebooks: optional.filter((rulebook) => (!rulebooks.includes(rulebook) && settings.barredRulebooks.includes(rulebook)))
	});
}
