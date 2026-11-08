/**
 * Money in every ruleset, and the money field that reads and writes amounts like "1pp 2gp 2sp 4cp" or
 * "250cr"
 *
 * Money is kept as the pieces of each coin, the way a purse holds them: gaining 5sp and then 5sp more is
 * 10sp, not 1gp. Only a money changer (changePf1eMoney) turns coins into others
 */
import { DISALLOWED_TEXT_CHARACTERS } from './constants.js';
import type { MessageDescriptor } from './localization.js';
import { PF1E_COIN_ABBREVIATIONS, PF1E_COIN_NAMES, PF1E_COINS } from './rulesets/pf1e/money.js';
import { SF1E_COIN_ABBREVIATIONS, SF1E_COIN_NAMES, SF1E_COINS } from './rulesets/sf1e/money.js';
import type { Ruleset } from './universes.js';

/**
 * Every ruleset's coins. The database has a column for each wherever it stores money
 */
export const COINS = [...PF1E_COINS, ...SF1E_COINS] as const;

export type Coin = typeof COINS[number];

/**
 * Whether text is a coin's key, such as a coin's abbreviation's thingId in universe text
 *
 * @param text The text
 * @return True for one of COINS
 */
export function isCoin(text: string): text is Coin
{
	return(COINS.some((coin) => (coin === text)));
}

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
 * Each coin's name as it reads mid-sentence, e.g. "gold pieces"
 */
export const COIN_NAMES: Record<Coin, MessageDescriptor> = {
	...PF1E_COIN_NAMES,
	...SF1E_COIN_NAMES
};

/**
 * The abbreviations a money field accepts for each of a ruleset's coins, e.g. the player's language's
 * and English's
 */
export type CoinAbbreviations = Partial<Record<Coin, readonly string[]>>;

/**
 * The abbreviations a universe gives its ruleset's coins in place of the engine's, by coin, such as "cr"
 * for gold pieces it calls crowns. A coin left out keeps the engine's abbreviation, which is engine text;
 * one the universe gives is universe text, translated like the rest of its text
 */
export type UniverseCoinAbbreviations = Partial<Record<Coin, string>>;

/**
 * The names a universe gives its ruleset's coins in place of the engine's, by coin, such as "bronze
 * kits" for copper pieces. Like UniverseCoinAbbreviations, a coin left out keeps the engine's name, and
 * one the universe gives is universe text. A name is written as it reads mid-sentence, and a label
 * capitalizes its first letter. It is never written after an amount, so it has no singular or plural
 * forms
 */
export type UniverseCoinNames = Partial<Record<Coin, string>>;

/**
 * Most characters in a name a universe gives a coin, or in its translation
 */
export const MAX_COIN_NAME_LENGTH = 30;

/**
 * Most characters in an abbreviation a universe gives a coin, or in its translation
 */
export const MAX_COIN_ABBREVIATION_LENGTH = 10;

/**
 * Whether text can be a coin's abbreviation: something a money field reads back after an amount, so
 * 1 to MAX_COIN_ABBREVIATION_LENGTH characters without spaces, digits, commas or disallowed characters
 *
 * @param text The abbreviation, trimmed
 * @return True when it can be one
 */
export function isValidCoinAbbreviation(text: string): boolean
{
	return((text.length > 0) && (text.length <= MAX_COIN_ABBREVIATION_LENGTH) && !/[\d\s,]/.test(text) && !DISALLOWED_TEXT_CHARACTERS.test(text));
}

/**
 * Each of a ruleset's coins' abbreviation as players see it: the universe's, or the engine's
 *
 * @param ruleset The universe's ruleset
 * @param universeAbbreviations The abbreviations the universe gives its coins, in the language shown
 * @param engineAbbreviation The engine's abbreviation of a coin in the language shown
 * @return The abbreviations, by coin
 */
export function shownCoinAbbreviations(ruleset: Ruleset, universeAbbreviations: UniverseCoinAbbreviations, engineAbbreviation: (coin: Coin) => string): Partial<Record<Coin, string>>
{
	return(Object.fromEntries(RULESET_COINS[ruleset].map((coin) => [coin, (universeAbbreviations[coin] ?? engineAbbreviation(coin))])));
}

/**
 * The first of a ruleset's coins shown with the same abbreviation as a more valuable one, ignoring
 * capitals, which a money field couldn't tell apart
 *
 * @param ruleset The universe's ruleset
 * @param shown Each coin's abbreviation as players see it (shownCoinAbbreviations())
 * @return The coin, or undefined when every coin's abbreviation differs
 */
export function duplicateCoinAbbreviation(ruleset: Ruleset, shown: Partial<Record<Coin, string>>): Coin | undefined
{
	const seen = new Set<string>();

	for (const coin of RULESET_COINS[ruleset])
	{
		const abbreviation = (shown[coin] ?? '').toLocaleLowerCase();

		if (seen.has(abbreviation))
		{
			return(coin);
		}
		seen.add(abbreviation);
	}

	return(undefined);
}

/**
 * The abbreviations a money field reads for each of a ruleset's coins: the one it is shown with, then
 * the engine's (such as the player's language's and English's) unless another coin is shown with it.
 * So "2gp" still reads as gold pieces in a universe that calls them "cr", but not once it shows silver
 * pieces as "gp"
 *
 * @param ruleset The universe's ruleset
 * @param shown Each coin's abbreviation as players see it (shownCoinAbbreviations())
 * @param engine The engine's abbreviations of each coin
 * @return The abbreviations to accept, by coin
 */
export function acceptedCoinAbbreviations(ruleset: Ruleset, shown: Partial<Record<Coin, string>>, engine: CoinAbbreviations): CoinAbbreviations
{
	const coins = RULESET_COINS[ruleset];
	const shownByOthers = (coin: Coin) => new Set(coins
		.filter((other) => (other !== coin))
		.map((other) => (shown[other] ?? '').toLocaleLowerCase()));

	return(Object.fromEntries(coins.map((coin) =>
	{
		const taken = shownByOthers(coin);
		const fallbacks = (engine[coin] ?? []).filter((abbreviation) => !taken.has(abbreviation.toLocaleLowerCase()));

		return([coin, [...((shown[coin] === undefined) ? [] : [shown[coin]]), ...fallbacks]]);
	})));
}

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
 * @param abbreviations The abbreviations to accept for each of the ruleset's coins, matched ignoring
 * capitals; one given for two coins reads as the more valuable
 * @return The coins, or the problem with the text
 */
export function parseMoney(text: string, ruleset: Ruleset, abbreviations: CoinAbbreviations): MoneyParseResult
{
	const coinByAbbreviation = new Map<string, Coin>();

	for (const coin of RULESET_COINS[ruleset])
	{
		for (const abbreviation of (abbreviations[coin] ?? []))
		{
			const key = abbreviation.toLocaleLowerCase();

			// An abbreviation two coins have is the more valuable coin's
			if (!coinByAbbreviation.has(key))
			{
				coinByAbbreviation.set(key, coin);
			}
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
	return(moneyPieces(money, ruleset)
		.map(([coin, count]) => (String(count) + (abbreviations[coin] ?? '')))
		.join(' '));
}

/**
 * The coins an amount is written with, most valuable first, leaving out coins it has none of; no money
 * is none of ZERO_MONEY_COINS
 *
 * @param money The coins, only the ruleset's
 * @param ruleset The universe's ruleset
 * @return Each coin with how many pieces of it there are
 */
export function moneyPieces(money: Money, ruleset: Ruleset): [Coin, number][]
{
	const pieces = RULESET_COINS[ruleset]
		.filter((coin) => (money[coin] > 0))
		.map((coin): [Coin, number] => [coin, money[coin]]);

	return(((pieces.length === 0) ? [[ZERO_MONEY_COINS[ruleset], 0]] : pieces));
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
