/**
 * Pathfinder 1E's coins, and the money field that reads and writes amounts like "1pp 2gp 2sp 4cp"
 *
 * Money is kept as the pieces of each coin, the way a purse holds them: gaining 5sp and then 5sp more is
 * 10sp, not 1gp. Only a money changer (changePf1eMoney) turns coins into others. The coins are Open
 * Game Content from the Pathfinder Roleplaying Game Core Rulebook, used under the Open Game License
 * 1.0a (client/license.html)
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
 * An amount of money: how many pieces of each coin
 */
export type Pf1eMoney = Record<Pf1eCoin, number>;

/**
 * Most pieces of one coin an amount can hold
 */
export const PF1E_MAX_COINS = 1000000000;

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
 * What reading a money field found: the coins, or why it couldn't be read
 *
 * - format: the text isn't amounts of coins, such as "12" or "2 gold"
 * - tooMuch: there are more than PF1E_MAX_COINS pieces of one coin
 */
export type Pf1eMoneyParseResult =
	| { money: Pf1eMoney }
	| { error: 'format' | 'tooMuch' };

/**
 * No money
 *
 * @return A new amount with no pieces of any coin
 */
export function emptyPf1eMoney(): Pf1eMoney
{
	return({
		pp: 0,
		gp: 0,
		sp: 0,
		cp: 0
	});
}

/**
 * Reads a money field: amounts of coins in any order, separated by spaces or commas, such as
 * "1pp 2gp 2sp 4cp". A coin written twice is added up, and an empty field is no money. Coins are
 * kept as written: "15sp" is 15 silver pieces, not 1gp 5sp
 *
 * @param text What the field holds
 * @param abbreviations The abbreviations to accept for each coin, matched ignoring capitals
 * @return The coins, or the problem with the text
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
	const money = emptyPf1eMoney();
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
		money[coin] += Number(match[1]);
		if (money[coin] > PF1E_MAX_COINS)
		{
			return({ error: 'tooMuch' });
		}
	}
	return({ money });
}

/**
 * Writes an amount for a money field, most valuable coin first, leaving out coins it has none of:
 * "1pp 302gp 4444sp 10cp", and no money is "0gp"
 *
 * @param money The coins
 * @param abbreviations Each coin's abbreviation in the player's language
 * @return The amount as text that parsePf1eMoney() reads back
 */
export function formatPf1eMoney(money: Pf1eMoney, abbreviations: Record<Pf1eCoin, string>): string
{
	const parts = PF1E_COINS
		.filter((coin) => (money[coin] > 0))
		.map((coin) => (String(money[coin]) + abbreviations[coin]));

	if (parts.length === 0)
	{
		parts.push('0' + abbreviations.gp);
	}
	return(parts.join(' '));
}

/**
 * What an amount is worth, for comparing prices
 *
 * @param money The coins
 * @return Their worth in copper pieces
 */
export function pf1eMoneyValue(money: Pf1eMoney): number
{
	return(PF1E_COINS.reduce((total, coin) => (total + (money[coin] * PF1E_COIN_VALUES[coin])), 0));
}

/**
 * Puts two amounts together, coin by coin: 5sp and 5sp is 10sp
 *
 * @param first One amount
 * @param second The other amount
 * @return A new amount holding both
 */
export function addPf1eMoney(first: Pf1eMoney, second: Pf1eMoney): Pf1eMoney
{
	return({
		pp: (first.pp + second.pp),
		gp: (first.gp + second.gp),
		sp: (first.sp + second.sp),
		cp: (first.cp + second.cp)
	});
}

/**
 * What a money changer gives for an amount: the same worth in as few coins as possible, so
 * 1pp 302gp 4444sp 10cp becomes 75pp 6gp 5sp
 *
 * @param money The coins handed over
 * @return A new amount of the same worth
 */
export function changePf1eMoney(money: Pf1eMoney): Pf1eMoney
{
	const changed = emptyPf1eMoney();
	let left = pf1eMoneyValue(money);

	for (const coin of PF1E_COINS)
	{
		changed[coin] = Math.floor(left / PF1E_COIN_VALUES[coin]);
		left -= changed[coin] * PF1E_COIN_VALUES[coin];
	}
	return(changed);
}
