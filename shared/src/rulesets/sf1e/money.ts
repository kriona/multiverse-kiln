/**
 * Starfinder 1E's money: credits, the one currency
 *
 * Open Game Content from the Starfinder Roleplaying Game Core Rulebook, used under the Open Game License
 * 1.0a (client/license.html)
 */
import { defineMessages, type MessageDescriptor } from '../../localization.js';

/**
 * The coins: only credits
 */
export const SF1E_COINS = ['cr'] as const;

export type Sf1eCoin = typeof SF1E_COINS[number];

/**
 * Each coin's abbreviation, written after an amount: "250cr"
 */
export const SF1E_COIN_ABBREVIATIONS: Record<Sf1eCoin, MessageDescriptor> = defineMessages({
	cr: {
		id: 'sf1e.coin.cr',
		defaultMessage: 'cr',
		description: 'Abbreviation of credits, the money of Starfinder, written after a number with no space: "250cr". Players type it into money fields, so keep it short and without spaces or digits'
	}
});

/**
 * Each coin's name, unless a universe gives it one of its own
 */
export const SF1E_COIN_NAMES: Record<Sf1eCoin, MessageDescriptor> = defineMessages({
	cr: {
		id: 'sf1e.coinName.cr',
		defaultMessage: 'credits',
		description: 'Credits, the money of Starfinder, written as it reads in the middle of a sentence: labels capitalize its first letter. Shown on a character\'s sheet when the pointer rests on the coin\'s abbreviation, unless the universe names the coin itself, and in the editor\'s Coins table on its Ruleset tab and its Translations and Audit tabs'
	}
});
