/**
 * Money as tables store it: a column for each coin, holding how many pieces of it there are
 */
import type { Money } from '@multiverse-kiln/shared';

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
