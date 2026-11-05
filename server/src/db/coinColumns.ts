/**
 * Money as tables store it: a column for each coin, holding how many pieces of it there are, and the
 * names and abbreviations a universe gives its coins, a column for each
 */
import type { Coin, Money, UniverseCoinAbbreviations, UniverseCoinNames } from '@multiverse-kiln/shared';

/**
 * The coin columns a table with starting money has
 */
export interface CoinColumns
{
	startingPlatinum: number;
	startingGold: number;
	startingSilver: number;
	startingCopper: number;
	startingCredits: number;
}

/**
 * Money as the coin columns store it
 *
 * @param money The money
 * @return The columns' values
 */
export function toCoinColumns(money: Money): CoinColumns
{
	return({
		startingPlatinum: money.pp,
		startingGold: money.gp,
		startingSilver: money.sp,
		startingCopper: money.cp,
		startingCredits: money.cr
	});
}

/**
 * The money a row's coin columns hold
 *
 * @param row The row
 * @return The money
 */
export function fromCoinColumns(row: CoinColumns): Money
{
	return({
		pp: row.startingPlatinum,
		gp: row.startingGold,
		sp: row.startingSilver,
		cp: row.startingCopper,
		cr: row.startingCredits
	});
}

/**
 * The columns of a universe's version holding the name it gives each coin, null for the engine's
 */
export interface CoinNameColumns
{
	platinumName: string | null;
	goldName: string | null;
	silverName: string | null;
	copperName: string | null;
	creditsName: string | null;
}

/**
 * The columns of a universe's version holding the abbreviation it gives each coin, null for the engine's
 */
export interface CoinAbbreviationColumns
{
	platinumAbbreviation: string | null;
	goldAbbreviation: string | null;
	silverAbbreviation: string | null;
	copperAbbreviation: string | null;
	creditsAbbreviation: string | null;
}

/**
 * The text a universe gives its coins, from a column for each coin
 *
 * @param columns Each coin with its column's value
 * @return The text, leaving out the coins with none of the universe's own
 */
function coinTexts(columns: readonly [Coin, string | null][]): Partial<Record<Coin, string>>
{
	const texts: Partial<Record<Coin, string>> = {};

	for (const [coin, text] of columns)
	{
		if (text !== null)
		{
			texts[coin] = text;
		}
	}

	return(texts);
}

/**
 * A universe's coin names as its columns store them
 *
 * @param names The names it gives its coins
 * @return The columns' values, null for each coin left out
 */
export function toCoinNameColumns(names: UniverseCoinNames): CoinNameColumns
{
	return({
		platinumName: (names.pp ?? null),
		goldName: (names.gp ?? null),
		silverName: (names.sp ?? null),
		copperName: (names.cp ?? null),
		creditsName: (names.cr ?? null)
	});
}

/**
 * The coin names a universe's columns hold
 *
 * @param row The row
 * @return The names, leaving out the coins with none of the universe's own
 */
export function fromCoinNameColumns(row: CoinNameColumns): UniverseCoinNames
{
	return(coinTexts([
		['pp', row.platinumName],
		['gp', row.goldName],
		['sp', row.silverName],
		['cp', row.copperName],
		['cr', row.creditsName]
	]));
}

/**
 * A universe's coin abbreviations as its columns store them
 *
 * @param abbreviations The abbreviations it gives its coins
 * @return The columns' values, null for each coin left out
 */
export function toCoinAbbreviationColumns(abbreviations: UniverseCoinAbbreviations): CoinAbbreviationColumns
{
	return({
		platinumAbbreviation: (abbreviations.pp ?? null),
		goldAbbreviation: (abbreviations.gp ?? null),
		silverAbbreviation: (abbreviations.sp ?? null),
		copperAbbreviation: (abbreviations.cp ?? null),
		creditsAbbreviation: (abbreviations.cr ?? null)
	});
}

/**
 * The coin abbreviations a universe's columns hold
 *
 * @param row The row
 * @return The abbreviations, leaving out the coins with none of the universe's own
 */
export function fromCoinAbbreviationColumns(row: CoinAbbreviationColumns): UniverseCoinAbbreviations
{
	return(coinTexts([
		['pp', row.platinumAbbreviation],
		['gp', row.goldAbbreviation],
		['sp', row.silverAbbreviation],
		['cp', row.copperAbbreviation],
		['cr', row.creditsAbbreviation]
	]));
}
