/**
 * Money as tables store it: a column for each coin, holding how many pieces of it there are
 */
import type { Pf1eMoney } from '@multiverse-kiln/shared';

/**
 * The four coin columns a table with money has
 */
export interface CoinColumns
{
	startingPlatinum: number;
	startingGold: number;
	startingSilver: number;
	startingCopper: number;
}

/**
 * Money as the coin columns store it
 *
 * @param money The money
 * @return The columns' values
 */
export function toCoinColumns(money: Pf1eMoney): CoinColumns
{
	return({
		startingPlatinum: money.pp,
		startingGold: money.gp,
		startingSilver: money.sp,
		startingCopper: money.cp
	});
}

/**
 * The money a row's coin columns hold
 *
 * @param row The row
 * @return The money
 */
export function fromCoinColumns(row: CoinColumns): Pf1eMoney
{
	return({
		pp: row.startingPlatinum,
		gp: row.startingGold,
		sp: row.startingSilver,
		cp: row.startingCopper
	});
}
