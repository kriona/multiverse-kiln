/**
 * Pathfinder 1E's coins, and the money field that reads and writes amounts like "1pp 2gp 2sp 4cp"
 *
 * Amounts are stored as whole copper pieces. The coins are Open Game Content from the Pathfinder
 * Roleplaying Game Core Rulebook, used under the Open Game License 1.0a (client/license.html)
 */
import { defineMessages, type MessageDescriptor } from '../../localization.js';

/**
 * The coins, most valuable first
 */
export const PF1E_COINS = ['pp', 'gp', 'sp', 'cp'] as const;

export type Pf1eCoin = typeof PF1E_COINS[number];

/**
 * What each coin is worth in copper pieces
 */
export const PF1E_COIN_VALUES: Record<Pf1eCoin, number> = {
	pp: 1000,
	gp: 100,
	sp: 10,
	cp: 1
};

/**
 * The coins an amount is written in. Platinum can be typed, but amounts are shown in gold, the coin
 * prices are given in
 */
const FORMATTED_COINS: readonly Pf1eCoin[] = ['gp', 'sp', 'cp'];

/**
 * Most copper pieces an amount can be: 10 million gold pieces
 */
export const PF1E_MAX_MONEY = 1000000000;

/**
 * Each coin's abbreviation, written after an amount: "2gp"
 */
export const PF1E_COIN_ABBREVIATIONS: Record<Pf1eCoin, MessageDescriptor> = defineMessages({
	pp: {
		id: 'pf1e.coin.pp',
		defaultMessage: 'pp',
		description: 'Abbreviation of platinum pieces, the most valuable coin in Pathfinder, written after a number with no space: "1pp". Players type it into money fields, so keep it short and without spaces or digits'
	},
	gp: {
		id: 'pf1e.coin.gp',
		defaultMessage: 'gp',
		description: 'Abbreviation of gold pieces, the coin prices are given in in Pathfinder, written after a number with no space: "2gp". Players type it into money fields, so keep it short and without spaces or digits'
	},
	sp: {
		id: 'pf1e.coin.sp',
		defaultMessage: 'sp',
		description: 'Abbreviation of silver pieces, a coin in Pathfinder worth a tenth of a gold piece, written after a number with no space: "2sp". Players type it into money fields, so keep it short and without spaces or digits'
	},
	cp: {
		id: 'pf1e.coin.cp',
		defaultMessage: 'cp',
		description: 'Abbreviation of copper pieces, the least valuable coin in Pathfinder, written after a number with no space: "4cp". Players type it into money fields, so keep it short and without spaces or digits'
	}
});

/**
 * The abbreviations a money field accepts for each coin, e.g. the player's language's and English's
 */
export type Pf1eCoinAbbreviations = Record<Pf1eCoin, readonly string[]>;

/**
 * What reading a money field found: the amount in copper pieces, or why it couldn't be read
 *
 * - format: the text isn't amounts of coins, such as "12" or "2 gold"
 * - tooMuch: the amount is more than PF1E_MAX_MONEY
 */
export type Pf1eMoneyParseResult =
	| { copper: number }
	| { error: 'format' | 'tooMuch' };

/**
 * Reads a money field: amounts of coins in any order, separated by spaces or commas, such as
 * "1pp 2gp 2sp 4cp". A coin written twice is added up, and an empty field is no money
 *
 * @param text What the field holds
 * @param abbreviations The abbreviations to accept for each coin, matched ignoring capitals
 * @return The amount in copper pieces, or the problem with the text
 */
export function parsePf1eMoney(text: string, abbreviations: Pf1eCoinAbbreviations): Pf1eMoneyParseResult
{
	const coinByAbbreviation = new Map<string, Pf1eCoin>();

	for (const coin of PF1E_COINS)
	{
		for (const abbreviation of abbreviations[coin])
		{
			coinByAbbreviation.set(abbreviation.toLocaleLowerCase(), coin);
		}
	}

	const spaced = text.replaceAll(',', ' ');
	// One amount of a coin with the spaces around it, "12gp" or "3 sp", starting where the last one ended
	const amountPattern = /\s*(\d+)\s*([^\d\s]+)\s*/y;
	let copper = 0;
	let position = 0;

	// Only spaces left after the last amount ends the field
	while (spaced.slice(position).trim() !== '')
	{
		amountPattern.lastIndex = position;

		const match = amountPattern.exec(spaced);

		if (match === null)
		{
			return({ error: 'format' });
		}
		position = amountPattern.lastIndex;

		const coin = coinByAbbreviation.get(match[2].toLocaleLowerCase());

		if (coin === undefined)
		{
			return({ error: 'format' });
		}
		copper += Number(match[1]) * PF1E_COIN_VALUES[coin];
		if (copper > PF1E_MAX_MONEY)
		{
			return({ error: 'tooMuch' });
		}
	}
	return({ copper });
}

/**
 * Writes an amount for a money field in gold, silver and copper, leaving out coins it has none of:
 * 1224 copper pieces is "12gp 2sp 4cp", and no money is "0gp"
 *
 * @param copper The amount in copper pieces
 * @param abbreviations Each coin's abbreviation in the player's language
 * @return The amount as text that parsePf1eMoney() reads back
 */
export function formatPf1eMoney(copper: number, abbreviations: Record<Pf1eCoin, string>): string
{
	const parts: string[] = [];
	let left = copper;

	for (const coin of FORMATTED_COINS)
	{
		const count = Math.floor(left / PF1E_COIN_VALUES[coin]);

		if (count > 0)
		{
			parts.push(String(count) + abbreviations[coin]);
			left -= count * PF1E_COIN_VALUES[coin];
		}
	}
	if (parts.length === 0)
	{
		parts.push('0' + abbreviations.gp);
	}
	return(parts.join(' '));
}

/**
 * Whether an amount of money is one the game can store: a whole number of copper pieces from 0 to
 * PF1E_MAX_MONEY
 *
 * @param copper The amount, from untrusted input
 * @return True when it is allowed
 */
export function isValidPf1eMoney(copper: unknown): copper is number
{
	return(Number.isSafeInteger(copper) && ((copper as number) >= 0) && ((copper as number) <= PF1E_MAX_MONEY));
}
