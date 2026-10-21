/**
 * Money in every ruleset, and the money field that reads and writes amounts like "1pp 2gp 2sp 4cp" or
 * "250cr"
 *
 * Money is kept as the pieces of each coin, the way a purse holds them: gaining 5sp and then 5sp more is
 * 10sp, not 1gp. Only a money changer (changePf1eMoney) turns coins into others
 */
import type { MessageDescriptor } from './localization.js';
import { PF1E_COIN_ABBREVIATIONS, PF1E_COINS } from './rulesets/pf1e/money.js';
import { SF1E_COIN_ABBREVIATIONS, SF1E_COINS } from './rulesets/sf1e/money.js';
import type { Ruleset } from './universes.js';

/**
 * Every ruleset's coins. The database has a column for each wherever it stores money
 */
export const COINS = [...PF1E_COINS, ...SF1E_COINS] as const;

export type Coin = typeof COINS[number];

/**
 * An amount of money: how many pieces of each coin. A universe only uses its ruleset's coins
 * (RULESET_COINS), and has no pieces of the others
 */
export type Money = Record<Coin, number>;

/**
 * Most pieces of one coin an amount can hold
 */
export const MAX_COINS = 1000000000;

/**
 * Each ruleset's coins, most valuable first
 */
export const RULESET_COINS: Record<Ruleset, readonly Coin[]> = {
	pf1e: PF1E_COINS,
	sf1e: SF1E_COINS
};

/**
 * The coin each ruleset writes no money in: "0gp"
 */
export const ZERO_MONEY_COINS: Record<Ruleset, Coin> = {
	pf1e: 'gp',
	sf1e: 'cr'
};

/**
 * Each coin's abbreviation, written after an amount: "2gp"
 */
export const COIN_ABBREVIATIONS: Record<Coin, MessageDescriptor> = {
	...PF1E_COIN_ABBREVIATIONS,
	...SF1E_COIN_ABBREVIATIONS
};

/**
 * The abbreviations a money field accepts for each of a ruleset's coins, e.g. the player's language's
 * and English's
 */
export type CoinAbbreviations = Partial<Record<Coin, readonly string[]>>;

/**
 * What reading a money field found: the coins, or why it couldn't be read
 *
 * - format: the text isn't amounts of the ruleset's coins, such as "12" or "2 gold"
 * - tooMuch: there are more than MAX_COINS pieces of one coin
 */
export type MoneyParseResult =
	| { money: Money }
	| { error: 'format' | 'tooMuch' };

/**
 * No money
 *
 * @return A new amount with no pieces of any coin
 */
export function emptyMoney(): Money
{
	return(Object.fromEntries(COINS.map((coin) => [coin, 0])) as Money);
}

/**
 * Whether an amount holds only a ruleset's coins
 *
 * @param money The amount
 * @param ruleset The ruleset
 * @return True when it has no pieces of another ruleset's coins
 */
export function isRulesetMoney(money: Money, ruleset: Ruleset): boolean
{
	const coins = RULESET_COINS[ruleset];

	return(COINS.every((coin) => (coins.includes(coin) || (money[coin] === 0))));
}

/**
 * Reads a money field: amounts of a ruleset's coins in any order, separated by spaces or commas, such
 * as "1pp 2gp 2sp 4cp". A coin written twice is added up, and an empty field is no money. Coins are kept
 * as written: "15sp" is 15 silver pieces, not 1gp 5sp
 *
 * @param text What the field holds
 * @param ruleset The universe's ruleset, whose coins the field accepts
 * @param abbreviations The abbreviations to accept for each of the ruleset's coins, matched ignoring capitals
 * @return The coins, or the problem with the text
 */
export function parseMoney(text: string, ruleset: Ruleset, abbreviations: CoinAbbreviations): MoneyParseResult
{
	const coinByAbbreviation = new Map<string, Coin>();

	for (const coin of RULESET_COINS[ruleset])
	{
		for (const abbreviation of (abbreviations[coin] ?? []))
		{
			coinByAbbreviation.set(abbreviation.toLocaleLowerCase(), coin);
		}
	}

	const spaced = text.replaceAll(',', ' ');
	// One amount of a coin with the spaces around it, "12gp" or "3 sp", starting where the last one ended
	const amountPattern = /\s*(\d+)\s*([^\d\s]+)\s*/y;
	const money = emptyMoney();
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
		if (money[coin] > MAX_COINS)
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
 * @param money The coins, only the ruleset's
 * @param ruleset The universe's ruleset
 * @param abbreviations The abbreviation of each of the ruleset's coins in the player's language
 * @return The amount as text that parseMoney() reads back
 */
export function moneyText(money: Money, ruleset: Ruleset, abbreviations: Partial<Record<Coin, string>>): string
{
	const parts = RULESET_COINS[ruleset]
		.filter((coin) => (money[coin] > 0))
		.map((coin) => (String(money[coin]) + (abbreviations[coin] ?? '')));

	if (parts.length === 0)
	{
		parts.push('0' + (abbreviations[ZERO_MONEY_COINS[ruleset]] ?? ''));
	}
	return(parts.join(' '));
}

/**
 * Puts amounts together, coin by coin: 5sp and 5sp is 10sp. Each coin is capped at MAX_COINS
 *
 * @param amounts The amounts
 * @return A new amount holding them all
 */
export function addMoney(amounts: readonly Money[]): Money
{
	const total = emptyMoney();

	for (const amount of amounts)
	{
		for (const coin of COINS)
		{
			total[coin] = Math.min(total[coin] + amount[coin], MAX_COINS);
		}
	}
	return(total);
}
